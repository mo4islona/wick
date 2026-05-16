import { DEFAULT_LINE_ENTRY, DEFAULT_LINE_PULSE, DEFAULT_LINE_SMOOTH } from '../animation-constants';
import { decimateLineData } from '../data/decimation';
import type { TimeSeriesStore } from '../data/store';
import type { ChartTheme } from '../theme/types';
import type { LineSeriesOptions, TimePoint } from '../types';
import { hexToRgba } from '../utils/color';
import { lerp } from '../utils/math';
import { BaseMultiLayerSeries, type CommonSeriesOptions } from './base-multi-layer';
import { resolveMs } from './shared-animation';
import type { OverlayRenderContext, SeriesRenderContext } from './types';

const DEFAULT_OPTIONS: LineSeriesOptions = {
  colors: ['#2962FF'],
  strokeWidth: 1,
  area: { visible: true },
  pulse: true,
  stacking: 'off',
};

/**
 * Normalize caller-supplied line options onto the new shape. Deprecated
 * aliases (`areaFill`, `enterAnimation`, `enterMs`) are folded into their
 * renamed counterparts so the rest of the renderer only reads the canonical
 * fields.
 */
function normalizeLineOptions(input?: Partial<LineSeriesOptions>): Partial<LineSeriesOptions> {
  if (!input) return {};

  const out: Partial<LineSeriesOptions> = { ...input };
  if ((input as { areaFill?: boolean }).areaFill !== undefined && input.area === undefined) {
    out.area = { visible: !!(input as { areaFill?: boolean }).areaFill };
  }
  if (input.enterAnimation !== undefined && input.entryAnimation === undefined) {
    out.entryAnimation = input.enterAnimation;
  }
  if (input.enterMs !== undefined && input.entryMs === undefined) {
    out.entryMs = input.enterMs;
  }

  return out;
}

export class LineRenderer extends BaseMultiLayerSeries<TimePoint> {
  private options: LineSeriesOptions;
  private areaGradientCache = new Map<string, { gradient: CanvasGradient; bottomY: number; color: string }>();

  constructor(layerCount: number, options?: Partial<LineSeriesOptions>) {
    super(layerCount);
    this.options = { ...DEFAULT_OPTIONS, ...normalizeLineOptions(options) };
  }

  /** Back-compat: first store. */
  get store(): TimeSeriesStore<TimePoint> {
    return this.stores[0];
  }

  updateOptions(options: Partial<LineSeriesOptions>): void {
    this.options = { ...this.options, ...normalizeLineOptions(options) };
  }

  getStacking(): string {
    return this.options.stacking;
  }

  protected getCommonOptions(): CommonSeriesOptions {
    return this.options;
  }

  applyTheme(theme: ChartTheme, prev: ChartTheme): void {
    if (this.stores.length === 1) {
      // Single-layer: update color only if it matches the previous theme default
      if (this.getColor() === prev.line.color) {
        this.updateOptions({ colors: [theme.line.color] });
      }
    } else {
      this.updateOptions({
        colors: theme.seriesColors.slice(0, this.stores.length),
      });
    }

    // Stroke width follows theme unless the user pinned it with an explicit
    // option. Same "matches previous theme default" guard as the color path.
    if (this.options.strokeWidth === prev.line.width) {
      this.updateOptions({ strokeWidth: theme.line.width });
    }
  }

  /** Resolved pulse period in ms. 0 disables the pulse entirely. */
  private resolvedPulseMs(): number {
    return resolveMs(this.options.pulseMs, DEFAULT_LINE_PULSE);
  }

  protected resolvedEntryMs(): number {
    return resolveMs(this.options.entryMs, DEFAULT_LINE_ENTRY);
  }

  protected resolvedSmoothMs(): number {
    return resolveMs(this.options.smoothMs, DEFAULT_LINE_SMOOTH);
  }

  protected isEntryEnabled(): boolean {
    return (this.options.entryAnimation ?? 'grow') !== 'none';
  }

  get hasPulse(): boolean {
    return this.options.pulse && this.resolvedPulseMs() > 0 && this.stores.some((s) => s.isVisible() && s.length > 0);
  }

  get overlayNeedsAnimation(): boolean {
    // `hasPulse` already factors in `pulseMs > 0`, so a disabled pulse
    // halts the overlay RAF loop immediately — no 60 Hz tick for nothing.
    return this.hasPulse;
  }

  hasOverlayContentInRange(from: number, _to: number): boolean {
    // Only gate on the left bound. A zoom-in can briefly narrow `to` past
    // `last.time`; if we stopped the overlay loop there, the pulse would
    // vanish for a frame and flicker back once auto-scroll caught up. The
    // pulse is canvas-clipped (chart.ts restricts the overlay layer to the
    // chart rect), so drawing at an off-canvas X is harmless.
    for (let li = 0; li < this.stores.length; li++) {
      if (!this.stores[li].isVisible()) continue;

      const last = this.stores[li].last();
      if (last && last.time >= from) return true;
    }

    return false;
  }

  render(ctx: SeriesRenderContext): void {
    this.tickAnimations(performance.now());

    if (this.options.stacking === 'off') {
      this.renderOff(ctx);
    } else {
      this.renderStacked(ctx, this.options.stacking === 'percent');
    }
  }

  /**
   * Bitmap coordinates for the trailing endpoint of a layer — i.e. where the
   * last visible point should be drawn *right now*. Accounts for live-tracking
   * smoothing on Y (via {@link BaseMultiLayerSeries.effectiveValue}) and the
   * `'grow'` entrance animation, which lerps (X, Y) from the penultimate
   * point to the new point over the engine-driven entry progress.
   *
   * Shared between `renderOff` (last `lineTo` of the polyline) and `drawOverlay`
   * (pulse dot) so the pulse glides in sync with the trailing segment instead
   * of teleporting to the raw last.time while the line still unfurls.
   */
  private trailingEndpoint(
    ctx: SeriesRenderContext | OverlayRenderContext,
    layerIndex: number,
  ): { x: number; y: number } | null {
    const store = this.stores[layerIndex];
    const last = store.last();
    if (!last) return null;

    const { timeScale, yScale } = ctx;
    const lastRawX = timeScale.timeToBitmapX(last.time);
    const lastRawY = yScale.valueToBitmapY(this.effectiveValue(ctx, layerIndex, last.time, last.value));

    const style = this.options.entryAnimation ?? 'grow';
    if (style !== 'grow') {
      return { x: lastRawX, y: lastRawY };
    }

    const progress = this.entranceProgress(ctx, layerIndex, last.time);
    if (progress >= 1) {
      return { x: lastRawX, y: lastRawY };
    }

    const all = store.getAll();
    if (all.length < 2) return { x: lastRawX, y: lastRawY };

    const penultimate = all[all.length - 2];
    // Skip the lerp when the penultimate value is non-finite — otherwise the
    // overlay pulse would consume an interpolated `(NaN, ...)` endpoint.
    // Anchor to the raw last instead so the dot stays at the new point.
    if (!Number.isFinite(penultimate.value)) return { x: lastRawX, y: lastRawY };
    const penulX = timeScale.timeToBitmapX(penultimate.time);
    const penulY = yScale.valueToBitmapY(penultimate.value);

    return {
      x: lerp(penulX, lastRawX, progress),
      y: lerp(penulY, lastRawY, progress),
    };
  }

  /** Each layer drawn independently */
  private renderOff(ctx: SeriesRenderContext): void {
    const { scope, timeScale, yScale } = ctx;
    const { context } = scope;
    const range = timeScale.getRange();
    const { verticalPixelRatio } = scope;
    const hasStroke = this.options.strokeWidth > 0;
    const lineWidth = Math.max(1, Math.round(this.options.strokeWidth * verticalPixelRatio));
    const style = this.options.entryAnimation ?? 'grow';

    for (let li = 0; li < this.stores.length; li++) {
      if (!this.stores[li].isVisible()) continue;

      let data = this.stores[li].getVisibleData(range.from, range.to);
      const pixelWidth = scope.mediaSize.width;
      if (data.length > pixelWidth * 2) {
        data = decimateLineData(data, Math.round(pixelWidth * 1.5));
      }
      if (data.length < 2) continue;

      const color = this.options.colors[li % this.options.colors.length];

      // Trailing-segment entrance: the new segment appears to unfurl from the
      // penultimate point to the new one. 'grow' interpolates both axes (via
      // {@link trailingEndpoint}), 'fade' keeps geometry fixed and ramps stroke
      // alpha. Sharing `trailingEndpoint` with the overlay pulse keeps the dot
      // in sync with the line head instead of teleporting during entrance.
      const last = data[data.length - 1];
      const progress = this.entranceProgress(ctx, li, last.time);
      const trailingFade = style === 'fade' && progress < 1;
      const endpoint = this.trailingEndpoint(ctx, li) ?? {
        x: timeScale.timeToBitmapX(last.time),
        y: yScale.valueToBitmapY(this.effectiveValue(ctx, li, last.time, last.value)),
      };
      const trailingX = endpoint.x;
      const trailingY = endpoint.y;

      // Line — break the path at any non-finite value (null / NaN / Infinity /
      // undefined). A naive single-path draw would either stroke through NaN
      // coordinates or leak the area-fill polygon across gaps, so we collect
      // finite *runs* and render each independently: stroke = one subpath per
      // run, fill = one closed polygon per run anchored to the chart bottom.
      if (trailingFade) {
        context.save();
        context.globalAlpha = progress;
      }

      const bodyEnd = data.length - 1;
      const runs: { x: number; y: number }[][] = [];
      let current: { x: number; y: number }[] | null = null;
      for (let i = 0; i < bodyEnd; i++) {
        const v = data[i].value;
        if (!Number.isFinite(v)) {
          current = null;
          continue;
        }
        if (!current) {
          current = [];
          runs.push(current);
        }
        current.push({ x: timeScale.timeToBitmapX(data[i].time), y: yScale.valueToBitmapY(v) });
      }
      // Attach the trailing endpoint only if it's finite AND the last data
      // point is finite. A poisoned last value would produce a NaN trailing
      // endpoint; skip it instead of contaminating the polygon.
      const lastValue = data[bodyEnd]?.value;
      const trailingFinite = Number.isFinite(trailingX) && Number.isFinite(trailingY) && Number.isFinite(lastValue);
      if (trailingFinite) {
        if (current) {
          current.push({ x: trailingX, y: trailingY });
        } else {
          runs.push([{ x: trailingX, y: trailingY }]);
        }
      }

      // Stroke — one beginPath covering all multi-point runs. Breaks render
      // as gaps. Single-finite-point runs (a finite value sandwiched
      // between two non-finite neighbors, or the trailing endpoint alone
      // after a poisoned penultimate) are handled separately below — they
      // can't be stroked as a segment but must not vanish.
      if (hasStroke && runs.some((run) => run.length >= 2)) {
        context.beginPath();
        for (const run of runs) {
          if (run.length < 2) continue;
          context.moveTo(run[0].x, run[0].y);
          for (let j = 1; j < run.length; j++) context.lineTo(run[j].x, run[j].y);
        }
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.stroke();
      }

      // Orphaned single-finite-point runs → visible dots. Without this, a
      // finite point sandwiched between two NaN neighbors would silently
      // disappear, which is worse than the original "crash on NaN" bug.
      if (hasStroke) {
        const orphanRadius = Math.max(1, lineWidth / 2);
        let dotPathOpen = false;
        for (const run of runs) {
          if (run.length !== 1) continue;
          if (!dotPathOpen) {
            context.beginPath();
            dotPathOpen = true;
          }
          context.moveTo(run[0].x + orphanRadius, run[0].y);
          context.arc(run[0].x, run[0].y, orphanRadius, 0, Math.PI * 2);
        }
        if (dotPathOpen) {
          context.fillStyle = color;
          context.fill();
        }
      }

      // Area fill — one closed polygon per run, each dropped to the chart
      // baseline. Without per-run polygons, a single shared path would bleed
      // fill across the gaps.
      if (this.options.area.visible) {
        const bottomY = scope.bitmapSize.height;
        const cacheKey = String(li);
        const cached = this.areaGradientCache.get(cacheKey);
        let grad: CanvasGradient;
        if (cached && cached.bottomY === bottomY && cached.color === color) {
          grad = cached.gradient;
        } else {
          grad = context.createLinearGradient(0, 0, 0, bottomY);
          grad.addColorStop(0, hexToRgba(color, 0.12));
          grad.addColorStop(1, hexToRgba(color, 0.01));
          this.areaGradientCache.set(cacheKey, { gradient: grad, bottomY, color });
        }
        context.fillStyle = grad;
        for (const run of runs) {
          if (run.length < 2) continue;
          context.beginPath();
          context.moveTo(run[0].x, run[0].y);
          for (let j = 1; j < run.length; j++) context.lineTo(run[j].x, run[j].y);
          // Close the polygon: drop from the last point to the baseline, run
          // back to the first point's x on the baseline, and closePath snaps
          // the final edge back up to (first.x, first.y).
          context.lineTo(run[run.length - 1].x, bottomY);
          context.lineTo(run[0].x, bottomY);
          context.closePath();
          context.fill();
        }
      }
      if (trailingFade) context.restore();
    }
  }

  /** Stacked area rendering */
  private renderStacked(ctx: SeriesRenderContext, percent: boolean): void {
    const { scope, timeScale, yScale } = ctx;
    const { context } = scope;
    const range = timeScale.getRange();
    const { verticalPixelRatio } = scope;
    const hasStroke = this.options.strokeWidth > 0;
    const lineWidth = Math.max(1, Math.round(this.options.strokeWidth * verticalPixelRatio));

    // Collect per-layer data
    const pixelWidth = scope.mediaSize.width;
    const layers = this.stores.map((s) => {
      let data = s.getVisibleData(range.from, range.to);
      if (data.length > pixelWidth * 2) {
        data = decimateLineData(data, Math.round(pixelWidth * 1.5));
      }
      return data;
    });
    // Get all unique times, sorted
    const timeSet = new Set<number>();
    for (const layer of layers) {
      for (const d of layer) timeSet.add(d.time);
    }
    const times = Array.from(timeSet).sort((a, b) => a - b);
    if (times.length < 2) return;

    // Build value maps for fast lookup. Use effectiveValue so the last point
    // of each layer smoothly chases updateLastPoint even in stacked mode —
    // otherwise the stacked head would jump on every live tick.
    const valueMaps: Map<number, number>[] = layers.map((layer, li) => {
      const m = new Map<number, number>();
      for (const d of layer) m.set(d.time, this.effectiveValue(ctx, li, d.time, d.value));
      return m;
    });

    // Compute stacked Y values per time: cumulative[li][ti].
    // `?? 0` catches missing keys but not `NaN` / `±Infinity` — those are
    // live values stored in the map via `effectiveValue` when the source
    // data carried a poisoned point. Substitute 0 for any non-finite entry
    // so a single bad point doesn't poison the cumulative sum and NaN-out
    // every layer at that slot.
    const cumulative: number[][] = Array.from({ length: this.stores.length }, () => new Array(times.length).fill(0));
    for (let ti = 0; ti < times.length; ti++) {
      const t = times[ti];
      let total = 0;
      if (percent) {
        for (let li = 0; li < this.stores.length; li++) {
          if (!this.stores[li].isVisible()) continue;
          const v = valueMaps[li].get(t);
          if (Number.isFinite(v)) total += v as number;
        }
      }
      let running = 0;
      for (let li = 0; li < this.stores.length; li++) {
        const visible = this.stores[li].isVisible();
        const v = visible ? valueMaps[li].get(t) : 0;
        const raw = Number.isFinite(v) ? (v as number) : 0;
        running += percent && total > 0 ? (raw / total) * 100 : raw;
        cumulative[li][ti] = running;
      }
    }

    // Per-layer entrance progress on the layer's last data time. Stacked geometry
    // owns its own draw loop, so we can't reuse renderOff's trailingEndpoint —
    // we lerp the trailing segment's geometry directly off the cumulative arrays.
    //
    // Animation only fires when (a) the appended point is the rightmost time in
    // the visible `times` window AND (b) the previous time in `times` is the
    // layer's penultimate point. Anywhere else, lerping `xy[length-1]` would
    // distort an already-superseded segment or pull an off-screen point into
    // the on-screen tail.
    const style = this.options.entryAnimation ?? 'grow';
    const timeIdx = new Map<number, number>();
    for (let i = 0; i < times.length; i++) timeIdx.set(times[i], i);
    const lastVisibleIdx = times.length - 1;
    const layerProgress: number[] = new Array(this.stores.length).fill(1);
    for (let li = 0; li < this.stores.length; li++) {
      if (!this.stores[li].isVisible()) continue;

      const last = this.stores[li].last();
      if (!last) continue;

      const progress = this.entranceProgress(ctx, li, last.time);
      if (progress >= 1) continue;

      const toIdx = timeIdx.get(last.time);
      if (toIdx !== lastVisibleIdx) continue;

      // Penultimate point time must occupy the immediately-previous slot in
      // the times list — otherwise lerping the tail would re-shape a stable
      // earlier segment instead of just unfurling the new tip.
      const all = this.stores[li].getAll();
      if (all.length < 2) continue;
      const penultimateTime = all[all.length - 2].time;
      const fromIdx = timeIdx.get(penultimateTime);
      if (fromIdx !== toIdx - 1) continue;

      layerProgress[li] = progress;
    }

    // Lerp the last entry of an XY array between the prior point and the
    // current last by `progress` — mirrors renderOff's trailing-endpoint
    // interpolation. The gating above guarantees `xy[length-2]` is the layer's
    // penultimate.
    const applyGrowLerp = (xy: [number, number][], progress: number): void => {
      if (progress >= 1 || xy.length < 2) return;

      const lastIdx = xy.length - 1;
      const prev = xy[lastIdx - 1];
      const last = xy[lastIdx];
      xy[lastIdx] = [lerp(prev[0], last[0], progress), lerp(prev[1], last[1], progress)];
    };

    // Draw from top layer to bottom so lower layers fill correctly
    for (let li = this.stores.length - 1; li >= 0; li--) {
      if (!this.stores[li].isVisible()) continue;

      const color = this.options.colors[li % this.options.colors.length];
      const upperProg = layerProgress[li];
      // Lower edge mirrors the below layer's progress only when that layer is
      // visible — hidden layers contribute 0 to cumulative, so their entrance
      // must not shift this layer's drawn boundary.
      const lowerProg = li > 0 && this.stores[li - 1].isVisible() ? layerProgress[li - 1] : 1;

      // Upper edge = this layer's cumulative
      const upperXY: [number, number][] = [];
      for (let ti = 0; ti < times.length; ti++) {
        upperXY.push([timeScale.timeToBitmapX(times[ti]), yScale.valueToBitmapY(cumulative[li][ti])]);
      }
      if (style === 'grow') applyGrowLerp(upperXY, upperProg);

      // Lower edge = previous layer's cumulative (or zero line)
      const lowerXY: [number, number][] = [];
      for (let ti = 0; ti < times.length; ti++) {
        const base = li > 0 ? cumulative[li - 1][ti] : 0;
        lowerXY.push([timeScale.timeToBitmapX(times[ti]), yScale.valueToBitmapY(base)]);
      }
      if (style === 'grow') applyGrowLerp(lowerXY, lowerProg);

      const useFade = style === 'fade' && upperProg < 1;
      if (useFade) {
        context.save();
        context.globalAlpha = upperProg;
      }

      // Fill area between upper and lower
      if (this.options.area.visible) {
        context.beginPath();
        context.moveTo(upperXY[0][0], upperXY[0][1]);
        for (let i = 1; i < upperXY.length; i++) {
          context.lineTo(upperXY[i][0], upperXY[i][1]);
        }
        for (let i = lowerXY.length - 1; i >= 0; i--) {
          context.lineTo(lowerXY[i][0], lowerXY[i][1]);
        }
        context.closePath();
        context.fillStyle = hexToRgba(color, 0.25);
        context.fill();
      }

      // Stroke the upper edge
      if (hasStroke) {
        context.beginPath();
        context.moveTo(upperXY[0][0], upperXY[0][1]);
        for (let i = 1; i < upperXY.length; i++) {
          context.lineTo(upperXY[i][0], upperXY[i][1]);
        }
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.stroke();
      }

      if (useFade) context.restore();
    }
  }

  /**
   * Overlay hook: draws crosshair nearest-point dots and last-point pulse dots.
   * Chart invokes this during the overlay pass for any renderer that implements it.
   */
  drawOverlay(ctx: OverlayRenderContext): void {
    this.tickAnimations(performance.now());

    const { scope, timeScale, yScale, crosshair, dataInterval } = ctx;
    const size = scope;
    const pulseMs = this.resolvedPulseMs();
    // Closed-form pulse phase ∈ [0, 1). One full cycle per `pulseMs * 2π`
    // wall-clock window — kept inline here (rather than routed through the
    // viewport engine) so the renderer carries no cross-module state for a
    // value derivable from `performance.now()`.
    const pulsePhase = pulseMs > 0 ? (performance.now() / (pulseMs * 2 * Math.PI)) % 1 : 0;

    // Crosshair nearest-point dots
    if (crosshair) {
      const colors = this.options.colors;
      const stacking = this.options.stacking;
      const r = 4 * size.horizontalPixelRatio;

      const layerValues: number[] = [];
      const layerTimes: (number | null)[] = [];
      for (let li = 0; li < this.stores.length; li++) {
        const closest = this.stores[li].findNearest(crosshair.time, dataInterval);
        if (!closest) {
          layerValues.push(0);
          layerTimes.push(null);
        } else {
          layerValues.push(closest.value);
          layerTimes.push(closest.time);
        }
      }

      const displayValues: number[] = [];
      if (stacking === 'off') {
        for (const v of layerValues) displayValues.push(v);
      } else {
        // Hidden layers must contribute 0 so overlay dots align with the rendered stack.
        let total = 0;
        if (stacking === 'percent') {
          for (let li = 0; li < layerValues.length; li++) {
            if (this.stores[li].isVisible()) total += layerValues[li];
          }
        }
        let running = 0;
        for (let li = 0; li < layerValues.length; li++) {
          const v = this.stores[li].isVisible() ? layerValues[li] : 0;
          running += stacking === 'percent' && total > 0 ? (v / total) * 100 : v;
          displayValues.push(running);
        }
      }

      for (let li = 0; li < this.stores.length; li++) {
        const t = layerTimes[li];
        if (t === null) continue;
        if (!this.stores[li].isVisible()) continue;

        const color = colors[li % colors.length];
        const px = timeScale.timeToBitmapX(t);
        const py = yScale.valueToBitmapY(displayValues[li]);

        scope.context.beginPath();
        scope.context.arc(px, py, r + 3 * size.horizontalPixelRatio, 0, Math.PI * 2);
        const glowColor = color.startsWith('#')
          ? color + '40'
          : /^rgb\(/i.test(color)
            ? color.replace(/^rgb\((.*)\)$/i, 'rgba($1, 0.25)')
            : color.replace(/[\d.]+\)\s*$/, '0.25)');
        scope.context.fillStyle = glowColor;
        scope.context.fill();

        scope.context.beginPath();
        scope.context.arc(px, py, r, 0, Math.PI * 2);
        scope.context.fillStyle = color;
        scope.context.fill();
      }
    }

    // Pulse dots for line series (runs on overlay, not main layer).
    // Keep live-tracking in sync with the overlay pass — otherwise the pulse dot
    // would lag the smoothed line head by a frame.
    // `pulseMs <= 0` at the chart level (`animations.points.pulseMs: false`
    // or `animations: false`) disables the halo entirely; per-series `pulse`
    // still controls whether the dot is ever drawn.
    if (this.hasPulse && pulseMs > 0) {
      const stacking = this.options.stacking;
      for (let li = 0; li < this.stores.length; li++) {
        if (!this.stores[li].isVisible()) continue;

        const color = this.options.colors[li % this.options.colors.length];

        if (stacking === 'off') {
          // `trailingEndpoint` returns the interpolated (x, y) during a 'grow'
          // entrance so the dot glides from penultimate toward the new point in
          // lockstep with the line's trailing segment.
          const endpoint = this.trailingEndpoint(ctx, li);
          if (!endpoint) continue;

          this.drawPulse({
            ctx: scope.context,
            x: endpoint.x,
            y: endpoint.y,
            color,
            pixelRatio: size.horizontalPixelRatio,
            phase: pulsePhase,
          });
          continue;
        }

        // Stacked: pulse Y must match renderStacked's cumulative at this layer's
        // last time. During a 'grow' entrance the pulse also lerps in lockstep
        // with the rendered trailing segment.
        const last = this.stores[li].last();
        if (!last) continue;

        const t = last.time;
        const percent = stacking === 'percent';

        // Mirror renderStacked: every layer's value at time `queryT` goes through
        // effectiveValue so smoothing applied to a peer layer's last point also
        // reflects in this layer's cumulative offset.
        const cumulativeAt = (queryT: number): number => {
          const valueAt = (lj: number): number => {
            const point = lj === li && queryT === t ? last : this.stores[lj].findNearest(queryT, 0);
            if (!point || point.time !== queryT) return 0;

            return this.effectiveValue(ctx, lj, queryT, point.value);
          };
          let total = 0;
          if (percent) {
            for (let lj = 0; lj < this.stores.length; lj++) {
              if (!this.stores[lj].isVisible()) continue;

              total += valueAt(lj);
            }
          }
          let running = 0;
          for (let lj = 0; lj <= li; lj++) {
            if (!this.stores[lj].isVisible()) continue;

            const v = valueAt(lj);
            running += percent && total > 0 ? (v / total) * 100 : v;
          }
          return running;
        };

        let pulseX = timeScale.timeToBitmapX(t);
        let pulseY = yScale.valueToBitmapY(cumulativeAt(t));

        const appendStyle = this.options.entryAnimation ?? 'grow';
        if (appendStyle === 'grow') {
          const progress = this.entranceProgress(ctx, li, t);
          if (progress < 1) {
            // Penultimate point's time → fromTime for the grow lerp. Skip the
            // animation when the layer has < 2 points or when the penultimate
            // shares a time with the last (degenerate).
            const all = this.stores[li].getAll();
            const penultimate = all.length >= 2 ? all[all.length - 2] : null;
            if (penultimate !== null && penultimate.time !== t) {
              const prevX = timeScale.timeToBitmapX(penultimate.time);
              const prevY = yScale.valueToBitmapY(cumulativeAt(penultimate.time));
              pulseX = lerp(prevX, pulseX, progress);
              pulseY = lerp(prevY, pulseY, progress);
            }
          }
        }

        this.drawPulse({
          ctx: scope.context,
          x: pulseX,
          y: pulseY,
          color,
          pixelRatio: size.horizontalPixelRatio,
          phase: pulsePhase,
        });
      }
    }
  }

  private drawPulse({
    ctx,
    x,
    y,
    color,
    pixelRatio,
    phase,
  }: {
    ctx: CanvasRenderingContext2D;
    x: number;
    y: number;
    color: string;
    pixelRatio: number;
    /** Engine-driven pulse phase ∈ [0, 1). `Math.abs(Math.sin(phase·2π))` ramps the halo at one full visible cycle per period. */
    phase: number;
  }): void {
    const dotRadius = 3 * pixelRatio;
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(phase * 2 * Math.PI));
    const glowRadius = dotRadius + 4 * pixelRatio * pulse;

    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, pulse * 0.3);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
