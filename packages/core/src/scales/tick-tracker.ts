/**
 * Per-axis fade tracker for tick values. Both the canvas grid lines and the
 * DOM axis labels read from the same tracker so their opacity is identical
 * frame-for-frame — a new tick appears on the grid and its label at the same
 * pixel-level alpha, and so does a leaving tick.
 *
 * The tracker is value-keyed (not array-index) so that pans/zooms which
 * shift the tick set still produce stable per-tick identity: a tick that
 * stays in range across two `setCurrentTicks()` calls keeps its current
 * opacity instead of being treated as a fresh fade-in.
 */
export interface TickEntry {
  /** Tick value (time or price). */
  readonly value: number;
  /** Current opacity in [0, 1]. */
  readonly opacity: number;
}

export interface TickTrackerSnapshot {
  /** Every tick the tracker still considers alive — current ones at full alpha and fading-out ones above 0. */
  readonly entries: readonly TickEntry[];
  /** True while at least one entry hasn't reached its target opacity. */
  readonly isAnimating: boolean;
}

interface TrackedTick {
  opacity: number;
  target: 0 | 1;
}

const EMPTY_SNAPSHOT: TickTrackerSnapshot = { entries: [], isAnimating: false };

export interface AxisTickTrackerOptions {
  /** Fade duration in ms. Default 250 — matches DEFAULT_AXIS_TICK_FADE / streamTick. */
  fadeMs?: number;
}

export class AxisTickTracker {
  #map = new Map<number, TrackedTick>();
  #fadeMs: number;
  #lastTickAt: number | null = null;
  /**
   * `false` during the initial mount phase: any tick added via
   * {@link setCurrentTicks} is seeded at full opacity (no fade-in), and
   * tick-out departures snap instantly to 0. This covers the case where
   * the chart's Y/X range is still settling on first paint — niceTickValues
   * returns slightly different sets across the first few frames, and we
   * don't want each transient set to flicker through a fade.
   *
   * The tracker arms itself the first time {@link tick} sees a fully settled
   * state (every entry has reached its target). From that point on,
   * pan/zoom/data-swap churn produces proper fade-in/out.
   */
  #armed = false;

  constructor(options: AxisTickTrackerOptions = {}) {
    this.#fadeMs = options.fadeMs ?? 250;
  }

  /**
   * Tell the tracker which ticks are currently in range. While the tracker
   * is in its initial (un-armed) phase, newcomers are seeded at full opacity
   * and departures are snapped to 0 — the first paint should not fade in
   * from black. Once the tracker has been armed (after the first settled
   * frame), changes animate: new values fade in 0→1 and departures fade out
   * 1→0.
   */
  setCurrentTicks(currentTicks: readonly number[]): void {
    const initialOpacity = this.#armed ? 0 : 1;

    const seen = new Set<number>();
    for (const value of currentTicks) {
      seen.add(value);
      const entry = this.#map.get(value);
      if (entry) {
        entry.target = 1;
        // While not armed, snap to full opacity rather than easing in from
        // wherever a previous frame left things.
        if (!this.#armed) entry.opacity = 1;
      } else {
        this.#map.set(value, { opacity: initialOpacity, target: 1 });
      }
    }

    for (const [value, entry] of this.#map) {
      if (!seen.has(value)) {
        entry.target = 0;
        if (!this.#armed) {
          // Drop transient out-of-range ticks instantly during the initial
          // settling phase so they don't stack into a multi-tick fade-out
          // on the very first user-visible frame.
          this.#map.delete(value);
        }
      }
    }
  }

  /**
   * Advance every tick's opacity toward its target. Returns
   *   - `moved`: at least one opacity changed this frame (caller should
   *     notify any downstream surface — DOM labels — to re-read state)
   *   - `animating`: at least one tick still hasn't reached its target
   *     (caller should schedule another frame).
   *
   * The distinction matters when `dt` is large enough to one-shot from 0 to 1
   * in a single step: the tracker is now settled (`animating=false`) but the
   * caller still needs to refresh its read since opacities did change.
   */
  tick(now: number): { moved: boolean; animating: boolean } {
    if (this.#lastTickAt === null) {
      this.#lastTickAt = now;

      return { moved: false, animating: this.#computeAnimating() };
    }
    const dt = Math.max(0, now - this.#lastTickAt);
    this.#lastTickAt = now;
    if (this.#fadeMs <= 0) {
      let moved = false;
      for (const [value, entry] of this.#map) {
        if (entry.opacity !== entry.target) moved = true;
        entry.opacity = entry.target;
        if (entry.opacity <= 0) this.#map.delete(value);
      }

      return { moved, animating: false };
    }

    const step = dt / this.#fadeMs;
    let moved = false;
    let animating = false;
    for (const [value, entry] of this.#map) {
      if (entry.opacity === entry.target) continue;
      moved = true;
      if (entry.target === 1) {
        entry.opacity = Math.min(1, entry.opacity + step);
      } else {
        entry.opacity = Math.max(0, entry.opacity - step);
      }
      if (entry.opacity !== entry.target) animating = true;
      // Prune fully-faded entries — they no longer need a DOM node or grid line.
      else if (entry.target === 0) this.#map.delete(value);
    }

    return { moved, animating };
  }

  /**
   * Switch the tracker from snap-mode to fade-mode. The caller (chart render
   * loop) invokes this once the entire chart has reached a settled state —
   * viewport animation done, no series entrance animations in flight, no
   * tracker fades in progress. Until then, tick churn from the initial
   * mount (fitToData, `setVisibleRange`, streaming-pre-roll) all snaps so
   * users don't see a long opening fade.
   */
  markArmed(): void {
    this.#armed = true;
  }

  /** Whether subsequent `setCurrentTicks` will fade newcomers (`true`) or snap them in (`false`). */
  get isArmed(): boolean {
    return this.#armed;
  }

  /** Read-only view for renderers. */
  snapshot(): TickTrackerSnapshot {
    if (this.#map.size === 0) return EMPTY_SNAPSHOT;

    const entries: TickEntry[] = [];
    let isAnimating = false;
    for (const [value, entry] of this.#map) {
      entries.push({ value, opacity: entry.opacity });
      if (entry.opacity !== entry.target) isAnimating = true;
    }

    return { entries, isAnimating };
  }

  /** Drop all tracked ticks. Use after dataset swap so stale values don't linger. */
  reset(): void {
    this.#map.clear();
    this.#lastTickAt = null;
    this.#armed = false;
  }

  #computeAnimating(): boolean {
    for (const entry of this.#map.values()) {
      if (entry.opacity !== entry.target) return true;
    }

    return false;
  }
}
