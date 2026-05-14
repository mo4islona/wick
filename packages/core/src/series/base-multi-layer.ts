import { Animator, easeOutCubic } from '../animation';
import { DEFAULT_LINE_ENTRY, DEFAULT_LINE_SMOOTH } from '../animation-constants';
import { TimeSeriesStore } from '../data/store';
import type { TimePoint, TimePointInput } from '../types';
import { normalizeTime, normalizeTimePointArray } from '../utils/time';
import { computeEntranceProgress, resolveMs } from './shared-animation';
import { renderedStackPercentTop, renderedStackTop, sumStack } from './stack-math';
import type { SeriesRenderer } from './types';

/** Per-frame anchor cap: long-idle gaps (backgrounded tab) advance at most
 * this much on the resume frame, to avoid the displayed value snapping to
 * the new target. */
const FRAME_CAP_MS = 16;

const numLerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Shape of the options that {@link BaseMultiLayerSeries} reads directly from
 * its concrete subclass. Each subclass narrows its own options type and
 * returns this projection via {@link BaseMultiLayerSeries.getCommonOptions}.
 */
export interface CommonSeriesOptions {
  colors: string[];
  stacking: 'off' | 'normal' | 'percent';
  entryMs?: number | false;
  smoothMs?: number | false;
}

/** Minimum shape for a per-point entrance animation entry. */
export interface EntryBase {
  startTime: number;
}

/**
 * Abstract base for multi-layer time-series renderers (Bar, Line). Concentrates
 * the bookkeeping that those renderers share in full: multi-store ownership,
 * entrance-animation state, live-value smoothing, tooltip snapshots, stacked
 * totals, and lifecycle. Concrete subclasses supply only their options accessor,
 * entry factory, theming, and the actual drawing primitives.
 */
export abstract class BaseMultiLayerSeries<TData extends TimePoint, TEntry extends EntryBase>
  implements SeriesRenderer
{
  protected readonly stores: TimeSeriesStore<TData>[];
  /**
   * Per-layer animator that smooths the displayed last-value toward the actual
   * `store.last().value` so high-frequency `updateLastPoint` ticks read as a
   * smooth slide rather than a jump. New points (different `time`) snap
   * instantly — no cross-point interpolation. `null` per layer until the
   * first render seeds it. */
  #liveTrackAnimators: Array<Animator<number> | null>;
  /** Per-layer `time` of the point currently held by the layer's animator. */
  #lastSeededTimes: number[];
  /** Render timestamp of the previous frame, used as the animator's setTarget
   * anchor; clamped to {@link FRAME_CAP_MS} so a long backgrounded-tab gap
   * does not snap the displayed value on resume. */
  #lastRenderTime = 0;
  /** Per-layer entrance animations keyed by the point's `time`. */
  protected entries: Array<Map<number, TEntry>>;

  /** Per-layer smoothed last value. Read by tests via cast — exposed as a
   * derived view of the live-track animators' `current`. `null` for layers
   * whose animator has not been seeded yet (no data). */
  protected get displayedLastValues(): Array<number | null> {
    return this.#liveTrackAnimators.map((a) => a?.current ?? null);
  }

  /** Read-only view used by {@link effectiveValue} to gate the substitution. */
  protected get lastSeededTimes(): readonly number[] {
    return this.#lastSeededTimes;
  }

  constructor(layerCount: number) {
    this.stores = Array.from({ length: layerCount }, () => new TimeSeriesStore<TData>());
    this.#liveTrackAnimators = new Array(layerCount).fill(null);
    this.#lastSeededTimes = new Array(layerCount).fill(Number.NaN);
    this.entries = Array.from({ length: layerCount }, () => new Map());
  }

  // --- Subclass hooks -------------------------------------------------------

  /** Return the subset of options that the base class needs to read. */
  protected abstract getCommonOptions(): CommonSeriesOptions;

  /**
   * Build an entrance-animation entry for a newly appended point. Called
   * BEFORE the point is appended to the store, so subclasses can peek the
   * penultimate point via `this.stores[layerIndex].last()`. Return `null` to
   * opt out of animation (e.g. when style is `'none'` or duration is `0`).
   */
  protected abstract createEntry(layerIndex: number, time: number, now: number): TEntry | null;

  // --- SeriesRenderer interface (abstract — subclass provides) --------------

  abstract render(ctx: import('./types').SeriesRenderContext): void;
  abstract applyTheme(theme: import('../theme/types').ChartTheme, prev: import('../theme/types').ChartTheme): void;
  // biome-ignore lint/suspicious/noExplicitAny: each renderer narrows this in its concrete signature
  abstract updateOptions(options: any): void;

  // --- Color accessors ------------------------------------------------------

  getColor(): string {
    return this.getCommonOptions().colors[0];
  }

  getColors(): string[] {
    return this.getCommonOptions().colors;
  }

  // --- Data ingest ----------------------------------------------------------

  setData(data: unknown, layerIndex = 0): void {
    const store = this.stores[layerIndex];
    if (!store) return;

    const normalized = normalizeTimePointArray((data ?? []) as TimePointInput[]) as unknown as TData[];
    store.setData(normalized);
    // Bulk loads don't animate — clear any in-flight entries for this layer.
    this.entries[layerIndex]?.clear();
  }

  appendPoint(point: unknown, layerIndex = 0): void {
    const store = this.stores[layerIndex];
    if (!store) return;

    const p = point as TimePointInput;
    const time = normalizeTime(p.time);

    // Build the entry BEFORE append so `createEntry` can peek penultimate.
    const entry = this.createEntry(layerIndex, time, performance.now());
    store.append({ ...p, time } as unknown as TData);
    if (entry) this.entries[layerIndex]?.set(time, entry);
  }

  updateLastPoint(point: unknown, layerIndex = 0): void {
    const store = this.stores[layerIndex];
    if (!store) return;

    const p = point as TimePointInput;
    store.updateLast({ ...p, time: normalizeTime(p.time) } as unknown as TData);
  }

  keepLast(count: number, layerIndex = 0): void {
    const store = this.stores[layerIndex];
    if (!store || count < 0) return;

    const drop = store.length - count;
    if (drop <= 0) return;

    // Purge entrance-animation entries for the points being dropped — entries
    // are keyed by `time` (`base-multi-layer.ts` line 59), so the lookup is
    // safe across the slice operation that follows.
    const head = store.getAll().slice(0, drop);
    const entries = this.entries[layerIndex];
    if (entries) {
      for (const pt of head) {
        entries.delete(pt.time);
      }
    }

    store.trimStart(drop);
  }

  // --- Layer model ----------------------------------------------------------

  getLayerCount(): number {
    return this.stores.length;
  }

  setLayerVisible(index: number, visible: boolean): void {
    this.stores[index]?.setVisible(visible);
  }

  isLayerVisible(index: number): boolean {
    return this.stores[index]?.isVisible() ?? true;
  }

  getLayerColors(): string[] {
    return this.getColors();
  }

  // --- Lifecycle ------------------------------------------------------------

  onDataChanged(listener: () => void): () => void {
    for (const s of this.stores) s.on('update', listener);

    return () => {
      for (const s of this.stores) s.off('update', listener);
    };
  }

  dispose(): void {
    for (const s of this.stores) s.removeAllListeners();
    for (const m of this.entries) m.clear();
    for (let li = 0; li < this.#liveTrackAnimators.length; li++) {
      this.#liveTrackAnimators[li] = null;
      this.#lastSeededTimes[li] = Number.NaN;
    }
    this.#lastRenderTime = 0;
  }

  /**
   * Drop all in-flight per-point entrance animations across every layer.
   * Displayed-last smoothing is intentionally preserved.
   */
  cancelEntranceAnimations(): void {
    for (const m of this.entries) m.clear();
  }

  /** True while any entrance is active OR any layer's live-track animator is mid-flight. */
  get needsAnimation(): boolean {
    for (const m of this.entries) if (m.size > 0) return true;

    for (const a of this.#liveTrackAnimators) {
      if (a?.animating) return true;
    }

    return false;
  }

  // --- Animation primitives -------------------------------------------------

  /**
   * Advance smoothed last-value per layer. Seeds directly on first render or
   * when the last point's time changes; otherwise retargets the layer's
   * {@link Animator} toward the actual value. Must run at the top of every
   * render pass (and drawOverlay) so snapshots see fresh state regardless of
   * which pass ticks first.
   */
  protected advanceLiveTracking(now: number): void {
    if (now === this.#lastRenderTime) return;

    const smoothMs = resolveMs(this.getCommonOptions().smoothMs, DEFAULT_LINE_SMOOTH);

    // Anchor `setTarget` on the previous frame so the first tick at the new
    // `now` shows non-zero progress. Clamp to one frame so a long backgrounded-
    // tab gap doesn't let the animator advance past ~half the curve on resume.
    const dt = this.#lastRenderTime ? Math.min(now - this.#lastRenderTime, FRAME_CAP_MS) : 0;
    const anchorNow = now - dt;

    for (let li = 0; li < this.stores.length; li++) {
      const actualLast = this.stores[li].last();
      if (!actualLast) {
        this.#liveTrackAnimators[li] = null;
        this.#lastSeededTimes[li] = Number.NaN;
        continue;
      }

      const isNewPoint = this.#lastSeededTimes[li] !== actualLast.time;
      const animator = this.#liveTrackAnimators[li];
      if (animator === null || isNewPoint || smoothMs <= 0) {
        this.#liveTrackAnimators[li] = new Animator<number>({
          initial: actualLast.value,
          duration: smoothMs > 0 ? smoothMs : 0,
          easing: easeOutCubic,
          lerp: numLerp,
        });
        this.#lastSeededTimes[li] = actualLast.time;
        continue;
      }

      animator.setTarget(actualLast.value, { duration: smoothMs, now: anchorNow });
      animator.tick(now);
    }

    this.#lastRenderTime = now;
  }

  protected entranceProgress(layerIndex: number, time: number, now: number): number {
    const duration = resolveMs(this.getCommonOptions().entryMs, DEFAULT_LINE_ENTRY);

    return computeEntranceProgress(this.entries[layerIndex], time, now, duration);
  }

  /** The effective Y-value to render for (layer, time) — substitutes smoothed value for the live last point. */
  protected effectiveValue(layerIndex: number, time: number, rawValue: number): number {
    if (this.#lastSeededTimes[layerIndex] !== time) return rawValue;
    const displayed = this.#liveTrackAnimators[layerIndex]?.current;
    if (displayed === undefined) return rawValue;

    return displayed;
  }

  // --- Data queries ---------------------------------------------------------

  getLastValue(): number | null {
    for (let i = this.stores.length - 1; i >= 0; i--) {
      const last = this.stores[i].last();
      if (last) return last.value;
    }

    return null;
  }

  getDataAtTime(time: number, interval: number): TData | null {
    return this.stores[0]?.findNearest(time, interval) ?? null;
  }

  getLayerSnapshots(
    time: number,
    interval: number,
  ): { layerIndex: number; time: number; value: number; color: string }[] | null {
    if (this.stores.length <= 1) return null;

    const colors = this.getColors();
    const results: { layerIndex: number; time: number; value: number; color: string }[] = [];
    for (let li = 0; li < this.stores.length; li++) {
      if (!this.stores[li].isVisible()) continue;

      const data = this.stores[li].getVisibleData(time - interval, time + interval);
      if (data.length === 0) continue;

      let closest = data[0];
      let minDist = Math.abs(data[0].time - time);
      // Midpoint tie → later point wins. Matches `TimeSeriesStore.findNearest`
      // so single-layer (getDataAtTime) and multi-layer snapshots agree on
      // the same sample at exactly-between cursor times.
      for (let i = 1; i < data.length; i++) {
        const dist = Math.abs(data[i].time - time);
        if (dist <= minDist) {
          minDist = dist;
          closest = data[i];
        }
      }

      results.push({
        layerIndex: li,
        time: closest.time,
        value: closest.value,
        color: colors[li % colors.length],
      });
    }

    return results.length > 0 ? results : null;
  }

  getStackedLastValue(): { value: number; isLive: boolean } | null {
    if (this.stores.length <= 1) {
      const last = this.stores[0]?.last();

      return last ? { value: last.value, isLive: true } : null;
    }

    // Stacked renderers draw the top edge as the cumulative sum of visible
    // layers at the *last shared time*. Mirrors renderStacked's cumulative
    // construction but evaluated at a single time point.
    let lastTime = -Infinity;
    for (const s of this.stores) {
      if (!s.isVisible()) continue;

      const l = s.last();
      if (l && l.time > lastTime) lastTime = l.time;
    }
    if (lastTime === -Infinity) return null;

    const stacking = this.getCommonOptions().stacking;
    if (stacking === 'off') {
      // Non-stacked multi-layer: there's no single "top" — report the last
      // value of the last visible layer. Callers that want per-layer values
      // should use getLayerLastSnapshots.
      for (let i = this.stores.length - 1; i >= 0; i--) {
        if (!this.stores[i].isVisible()) continue;

        const last = this.stores[i].last();
        if (last) return { value: last.value, isLive: true };
      }

      return null;
    }

    const values: number[] = [];
    for (const s of this.stores) {
      if (!s.isVisible()) continue;

      const l = s.last();
      values.push(l && l.time === lastTime ? l.value : 0);
    }

    const totals = sumStack(values);
    const value = stacking === 'percent' ? renderedStackPercentTop(totals) : renderedStackTop(totals);

    return { value, isLive: true };
  }

  getLayerLastSnapshots(): { layerIndex: number; time: number; value: number; color: string }[] | null {
    if (this.stores.length <= 1) return null;

    const colors = this.getColors();
    const results: { layerIndex: number; time: number; value: number; color: string }[] = [];
    for (let li = 0; li < this.stores.length; li++) {
      if (!this.stores[li].isVisible()) continue;

      const last = this.stores[li].last();
      if (!last) continue;

      results.push({
        layerIndex: li,
        time: last.time,
        value: last.value,
        color: colors[li % colors.length],
      });
    }

    return results.length > 0 ? results : null;
  }

  getTotalLength(): number {
    let total = 0;
    for (const s of this.stores) total += s.length;

    return total;
  }

  getValueRange(from: number, to: number): { min: number; max: number } | null {
    const stacking = this.getCommonOptions().stacking;
    if (stacking === 'percent') {
      return { min: 0, max: 100 };
    }
    if (this.stores.length <= 1) {
      return null; // single store — chart handles it via entry.store
    }

    const layers = this.stores.map((s) => (s.isVisible() ? s.getVisibleData(from, to) : []));

    if (stacking === 'off') {
      // Union of all layers' individual ranges. Skip non-finite values so
      // null / NaN / ±Infinity / undefined don't corrupt the range.
      let min = Infinity;
      let max = -Infinity;
      for (const data of layers) {
        for (const d of data) {
          if (!Number.isFinite(d.value)) continue;
          if (d.value < min) min = d.value;
          if (d.value > max) max = d.value;
        }
      }

      return min < Infinity ? { min, max } : null;
    }

    // Normal stacking: compute stacked totals. Non-finite values are treated
    // as 0 for the stack — don't crash the range because one layer has a gap.
    const timeMap = new Map<number, number[]>();
    for (let li = 0; li < layers.length; li++) {
      for (const d of layers[li]) {
        let arr = timeMap.get(d.time);
        if (!arr) {
          arr = new Array(layers.length).fill(0);
          timeMap.set(d.time, arr);
        }
        arr[li] = Number.isFinite(d.value) ? d.value : 0;
      }
    }

    let min = 0;
    let max = 0;
    for (const values of timeMap.values()) {
      let posSum = 0;
      let negSum = 0;
      for (const v of values) {
        if (v > 0) posSum += v;
        else negSum += v;
      }
      if (posSum > max) max = posSum;
      if (negSum < min) min = negSum;
    }

    return max > min ? { min, max } : null;
  }
}
