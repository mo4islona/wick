/**
 * Per-axis tick-set holder.
 *
 * Post Phase-2 step 3 the tracker no longer owns opacity state — axis tick
 * fades drive off the engine's `state.tickOpacity` map, populated by
 * `bridge.emitDataTick({ tickFade })` events the chart emits in
 * `renderMain` whenever the current tick set diffs against the previous.
 * What the tracker still owns:
 *  - the current tick array (so multiple surfaces — canvas grid, DOM axis
 *    labels — agree on which values are alive this frame),
 *  - the previous tick array (so {@link computeTickFadeDiff} can compute
 *    entering / exiting without the caller stashing it themselves),
 *  - the "armed" flag separating first-paint snap-in from later eased
 *    fades (initial layout settles over a few transient niceTickValues
 *    sets; arming after the first quiescent frame is what stops those
 *    transient sets from flickering through a long opening fade).
 */
export interface TickEntry {
  /** Tick value (time or price). */
  readonly value: number;
  /** Current opacity in [0, 1]. */
  readonly opacity: number;
}

export interface TickTrackerSnapshot {
  /** Every tick the tracker still considers alive — current ones at their
   *  resolved opacity (1.0 once any pending fade-in settles) and fading-out
   *  ones above 0. */
  readonly entries: readonly TickEntry[];
  /** True while at least one entry hasn't reached its target opacity. */
  readonly isAnimating: boolean;
}

const EMPTY_SNAPSHOT: TickTrackerSnapshot = { entries: [], isAnimating: false };

/** Strict-equal element-wise compare for the idempotent `setCurrentTicks`
 *  short-circuit. The legacy tracker accepted multiple identical calls per
 *  frame (chart's renderMain + each React axis component); we preserve
 *  that here so the second call doesn't shift the just-set current value
 *  into the previous slot. */
function sameTicks(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export class AxisTickTracker {
  #current: readonly number[] = [];
  #previous: readonly number[] = [];
  /**
   * `false` during the initial mount phase: the chart emits any tickFade
   * diff with `duration: 0` (engine zero-duration guard → snap), so the
   * very first niceTickValues sets land at full opacity with no fade.
   * Armed by the chart after the first quiescent frame.
   */
  #armed = false;

  /**
   * Record the latest tick set. Idempotent: a call whose argument is
   * element-wise equal to the current set returns without shifting the
   * "previous" slot — every chart-driven surface (renderMain, React
   * YAxis / TimeAxis effect, Svelte / Vue equivalents) can call this on
   * every render without colliding.
   */
  setCurrentTicks(currentTicks: readonly number[]): void {
    if (sameTicks(currentTicks, this.#current)) return;
    this.#previous = this.#current;
    this.#current = currentTicks.slice();
  }

  getCurrentTicks(): readonly number[] {
    return this.#current;
  }

  getPreviousTicks(): readonly number[] {
    return this.#previous;
  }

  /** Whether subsequent tick-set changes should fade-in or snap. */
  markArmed(): void {
    this.#armed = true;
  }

  get isArmed(): boolean {
    return this.#armed;
  }

  /**
   * Join the held tick set with the engine's `state.tickOpacity` to build a
   * renderer-ready snapshot. Current ticks default to opacity 1 when the
   * engine hasn't seen them yet (fresh mount, or unarmed snap-in);
   * exiting ticks from the previous set surface only when the engine still
   * holds a non-zero opacity for them.
   */
  snapshot(tickOpacity: ReadonlyMap<number, number>): TickTrackerSnapshot {
    if (this.#current.length === 0 && this.#previous.length === 0) {
      return EMPTY_SNAPSHOT;
    }

    const entries: TickEntry[] = [];
    let isAnimating = false;
    const currentSet = new Set(this.#current);

    for (const value of this.#current) {
      const opacity = tickOpacity.get(value) ?? 1;
      entries.push({ value, opacity });
      if (opacity < 1) isAnimating = true;
    }

    for (const value of this.#previous) {
      if (currentSet.has(value)) continue;
      const opacity = tickOpacity.get(value);
      if (opacity === undefined || opacity <= 0) continue;
      entries.push({ value, opacity });
      isAnimating = true;
    }

    return { entries, isAnimating };
  }

  /** Drop all tracked ticks. Use after dataset swap so stale values don't linger. */
  reset(): void {
    this.#current = [];
    this.#previous = [];
    this.#armed = false;
  }
}

/**
 * Diff a new tick set against the previous one. Used by the chart to build
 * the `tickFade` claim on its `bridge.emitDataTick` / `bridge.emitVisibility`
 * events: `entering` ticks fade `0 → 1`, `exiting` ticks fade `1 → 0`.
 *
 * Co-located with the tracker so callers reach for one import. The chart
 * passes `prev = tracker.getCurrentTicks()` before calling `setCurrentTicks(next)`
 * so this helper sees the BEFORE/AFTER pair.
 */
export function computeTickFadeDiff(
  current: readonly number[],
  previous: readonly number[],
): { entering: readonly number[]; exiting: readonly number[] } {
  if (sameTicks(current, previous)) {
    return { entering: [], exiting: [] };
  }

  const curSet = new Set(current);
  const prevSet = new Set(previous);
  const entering: number[] = [];
  const exiting: number[] = [];
  for (const v of current) {
    if (!prevSet.has(v)) entering.push(v);
  }
  for (const v of previous) {
    if (!curSet.has(v)) exiting.push(v);
  }

  return { entering, exiting };
}
