/**
 * Per-axis tick-set holder with self-managed fade.
 *
 * Each tick value gets its own {@link Animator}: entering ticks ramp `0 → 1`,
 * exiting ticks ramp `1 → 0` and are removed once they settle at zero.
 * Callers drive the clock with {@link tick} once per frame, then read the
 * current opacity table via {@link snapshot}.
 *
 * Pre-arming (initial mount, dataset swap) the tracker uses duration `0` so
 * the very first nice-tick sets snap into place without an opening fade —
 * transient tick churn during layout settling should not look animated.
 */

import { Animator } from '../animation/animator';
import { DEFAULT_AXIS_TICK_FADE } from '../animation-constants';

export interface TickEntry {
  /** Tick value (time or price). */
  readonly value: number;
  /** Current opacity in [0, 1]. */
  readonly opacity: number;
}

export interface TickTrackerSnapshot {
  /**
   * Every tick the tracker still considers alive — current ones at their
   * resolved opacity (1.0 once any pending fade-in settles) and fading-out
   * ones above 0.
   */
  readonly entries: readonly TickEntry[];
  /** True while at least one entry hasn't reached its target opacity. */
  readonly isAnimating: boolean;
}

const EMPTY_SNAPSHOT: TickTrackerSnapshot = { entries: [], isAnimating: false };

const opacityLerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Strict-equal element-wise compare for the idempotent `setCurrentTicks`
 * short-circuit. Chart's `renderMain` + each framework axis component can
 * all call `setCurrentTicks` per render frame — the no-op path avoids
 * resetting animator targets that haven't changed.
 */
function sameTicks(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export interface AxisTickTrackerOptions {
  /** Cross-fade duration in ms once {@link markArmed} has flipped. Defaults to {@link DEFAULT_AXIS_TICK_FADE}. */
  fadeMs?: number;
}

export class AxisTickTracker {
  #current: readonly number[] = [];
  #previous: readonly number[] = [];
  readonly #animators = new Map<number, Animator<number>>();
  #fadeMs: number;
  /**
   * `false` during the initial mount phase: `setCurrentTicks` snaps each
   * entering/exiting animator to its target (duration `0`) so the very
   * first niceTickValues sets land at full opacity with no fade. The
   * chart's renderMain flips this once the chart has reached a settled
   * frame.
   */
  #armed = false;

  constructor(opts: AxisTickTrackerOptions = {}) {
    this.#fadeMs = opts.fadeMs ?? DEFAULT_AXIS_TICK_FADE;
  }

  /**
   * Record the latest tick set. Diffs against the current set and either
   * starts a `0 → 1` fade-in for new values or a `1 → 0` fade-out for
   * dropped ones. Idempotent on element-wise equal arrays.
   *
   * Callers must invoke {@link tick} every frame to advance the animators —
   * `snapshot()` reads the current state but does not advance time.
   */
  setCurrentTicks(next: readonly number[]): void {
    if (sameTicks(next, this.#current)) return;

    const duration = this.#armed ? this.#fadeMs : 0;
    const nextSet = new Set(next);
    const currSet = new Set(this.#current);

    for (const value of next) {
      if (currSet.has(value)) continue;
      let anim = this.#animators.get(value);
      if (anim === undefined) {
        anim = new Animator<number>({ initial: 0, duration: this.#fadeMs, lerp: opacityLerp });
        this.#animators.set(value, anim);
      }
      anim.setTarget(1, { duration });
    }

    for (const value of this.#current) {
      if (nextSet.has(value)) continue;
      const anim = this.#animators.get(value);
      if (anim === undefined) continue;
      anim.setTarget(0, { duration });
    }

    this.#previous = this.#current;
    this.#current = next.slice();
  }

  /**
   * Advance each tracked animator against `now`. Animators that settle
   * at zero are dropped from the map; non-zero settled animators stay so
   * a subsequent re-entering tick can pick them up without a flicker.
   * Returns `true` while any animator is still in flight.
   */
  tick(now: number): boolean {
    let animating = false;
    for (const [value, anim] of this.#animators) {
      const stillAnimating = anim.tick(now);
      if (stillAnimating) {
        animating = true;
        continue;
      }
      if (anim.current === 0) this.#animators.delete(value);
    }

    return animating;
  }

  /**
   * Build a renderer-ready snapshot from the tracker's own animator state.
   * No external opacity map is consulted — `setCurrentTicks` + `tick(now)`
   * are the only inputs.
   */
  snapshot(): TickTrackerSnapshot {
    if (this.#animators.size === 0) return EMPTY_SNAPSHOT;

    const entries: TickEntry[] = [];
    let isAnimating = false;
    for (const [value, anim] of this.#animators) {
      const opacity = anim.current;
      if (opacity <= 0) continue;

      entries.push({ value, opacity });
      if (anim.animating) isAnimating = true;
    }

    return { entries, isAnimating };
  }

  getCurrentTicks(): readonly number[] {
    return this.#current;
  }

  getPreviousTicks(): readonly number[] {
    return this.#previous;
  }

  /**
   * Reconfigure the cross-fade duration. Chart calls this after resolving
   * `animations.axis.tickFadeMs` so the tracker honors the user's config
   * without plumbing options through the scale constructors.
   */
  setFadeMs(ms: number): void {
    this.#fadeMs = ms;
  }

  /** Whether subsequent tick-set changes should fade-in or snap. */
  markArmed(): void {
    this.#armed = true;
  }

  get isArmed(): boolean {
    return this.#armed;
  }

  /** Drop all tracked ticks. Use after dataset swap so stale values don't linger. */
  reset(): void {
    this.#current = [];
    this.#previous = [];
    this.#animators.clear();
    this.#armed = false;
  }
}

/**
 * Diff a new tick set against a previous one. Exported as a pure helper
 * for callers that need to classify entering / exiting outside the
 * tracker's own animator logic (e.g. tests, custom render paths).
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
