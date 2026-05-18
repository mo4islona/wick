import type { VisibleRange } from '../types';
import { DEFAULT_X_SETTLE_MS } from './config';
import { type AnimationTime, resolveAnimationTime } from './time';
import type { RetargetOptions, Transition, TransitionFactory } from './transition';

export interface VisibleRangeSpringOptions {
  initial: VisibleRange;
  /**
   * Approximate settle time in milliseconds. Used to derive ω = 4.6 /
   * (settleMs / 1000); the spring's position reaches within ~1% of the
   * target after `settleMs` from a cold start.
   *
   * X has no expand/contract distinction — both sides of the visible range
   * use the same natural frequency. Stream-tick targets advance forward,
   * gesture targets can move either way, and a single ω keeps the visual
   * symmetric and predictable.
   */
  settleMs: number;
}

/**
 * Critically-damped spring tracking a {@link VisibleRange} target. The `from`
 * and `to` bounds are two independent scalar springs running at the same
 * natural frequency, so they reach the target together.
 *
 * Why spring instead of `Animator<VisibleRange>` with linear easing: every
 * `setTarget` while the animator was already in flight restarted the curve
 * from the current position with `(target − current) / duration` velocity —
 * a step change in velocity at retarget time. On streaming feeds where the
 * X target shifts on every tick, that step was visible as a "kick" at the
 * start of each slide; on wheel-zoom sequences it produced discrete stepping
 * through zoom levels.
 *
 * The spring instead carries the current velocity at retarget time and
 * pulls toward the new target, so motion stays velocity-continuous through
 * any number of mid-flight target changes. Critically damped (`c = 2ω`)
 * guarantees the fastest convergence and no overshoot. The closed-form
 * solution `x(t) = target + (a + b·t)·e^(−ωt)` (with `a = x₀ − target` and
 * `b = v₀ + ω·a`) is integrated analytically per `tick`, so the simulation
 * is stable for any frame interval and any settle time.
 */
export class VisibleRangeSpring implements Transition<VisibleRange> {
  #x0: VisibleRange;
  #v0From = 0;
  #v0To = 0;
  #target: VisibleRange;
  /**
   * Baseline natural frequency, derived from `settleMs` at construction or
   * via {@link setSettleMs}. Used as the fallback when a `retarget` call
   * doesn't supply a per-call `expandMs` override.
   */
  #omegaBase: number;
  /**
   * Active natural frequency for the current animation. Set on each
   * `retarget` from either the per-call `expandMs` (gesture) or the
   * baseline (streaming). Stays in effect until the next retarget.
   */
  #omega: number;
  #instant: boolean;
  #t0: number = -1;
  #cached: VisibleRange;

  constructor(opts: VisibleRangeSpringOptions) {
    this.#x0 = { from: opts.initial.from, to: opts.initial.to };
    this.#target = { from: opts.initial.from, to: opts.initial.to };
    this.#cached = { from: opts.initial.from, to: opts.initial.to };
    // `settleMs <= 0` is a snap-only config (`animations: false`); fold
    // every `retarget` into `snap` and clamp omega so the math stays finite
    // even when the snap path is bypassed.
    this.#instant = opts.settleMs <= 0;
    this.#omegaBase = this.#instant ? Number.MAX_SAFE_INTEGER : 4.6 / (opts.settleMs / 1000);
    this.#omega = this.#omegaBase;
  }

  get current(): VisibleRange {
    return this.#cached;
  }

  get target(): VisibleRange {
    return this.#target;
  }

  get animating(): boolean {
    const eps = this.#eps();

    return (
      Math.abs(this.#cached.from - this.#target.from) > eps ||
      Math.abs(this.#cached.to - this.#target.to) > eps ||
      Math.abs(this.#v0From) > eps * this.#omega ||
      Math.abs(this.#v0To) > eps * this.#omega
    );
  }

  /** Update the baseline natural frequency. Subsequent `retarget` calls
   *  without a per-call `expandMs` will use this value. Existing position
   *  and velocity are preserved. */
  setSettleMs(settleMs: number): void {
    if (this.#instant || settleMs <= 0) return;
    this.#omegaBase = 4.6 / (settleMs / 1000);
  }

  retarget(value: VisibleRange, opts: RetargetOptions = {}): void {
    if (this.#instant) {
      this.snap(value, opts);

      return;
    }
    const now = opts.now ?? performance.now();
    // RetargetOptions carries expandMs/contractMs for Y semantics. For X we
    // collapse to a single per-call override: use `expandMs` if supplied,
    // otherwise fall back to the baseline (streaming cadence target). The
    // override is one-shot — `#omegaBase` is NOT modified, so the next
    // streaming retarget reads the cadence-tuned baseline again.
    const omega = opts.expandMs !== undefined ? 4.6 / (opts.expandMs / 1000) : this.#omegaBase;

    if (this.#t0 < 0) {
      this.#target = { from: value.from, to: value.to };
      this.#omega = omega;
      this.#t0 = now;

      return;
    }

    // Sample current position and velocity at `now` (using the ω that was
    // active for the previous target), then start a fresh spring with the
    // new target while carrying velocity over.
    const { x, vFrom, vTo } = this.#sample(now);
    this.#x0 = x;
    this.#v0From = vFrom;
    this.#v0To = vTo;
    this.#omega = omega;
    this.#target = { from: value.from, to: value.to };
    this.#t0 = now;
    this.#cached = x;
  }

  /** Land at `value` immediately. Velocity is reset to zero. */
  snap(value: VisibleRange, opts: { now?: number } = {}): void {
    const now = opts.now ?? performance.now();
    this.#x0 = { from: value.from, to: value.to };
    this.#target = { from: value.from, to: value.to };
    this.#v0From = 0;
    this.#v0To = 0;
    this.#t0 = now;
    this.#cached = { from: value.from, to: value.to };
  }

  /** Advance the analytic solution to `now`. Returns `true` while still
   *  perceptibly moving (animating); `false` when settled within ε of target. */
  tick(now: number): boolean {
    if (this.#instant) return false;

    if (this.#t0 < 0) {
      this.#t0 = now;

      return false;
    }

    const { x, vFrom, vTo } = this.#sample(now);
    this.#cached = x;
    const eps = this.#eps();
    if (
      Math.abs(x.from - this.#target.from) < eps &&
      Math.abs(x.to - this.#target.to) < eps &&
      Math.abs(vFrom) < eps * this.#omega &&
      Math.abs(vTo) < eps * this.#omega
    ) {
      this.#cached = { from: this.#target.from, to: this.#target.to };
      this.#x0 = { from: this.#target.from, to: this.#target.to };
      this.#v0From = 0;
      this.#v0To = 0;
      this.#t0 = now;

      return false;
    }

    return true;
  }

  #sample(now: number): { x: VisibleRange; vFrom: number; vTo: number } {
    const t = Math.max(0, (now - this.#t0) / 1000);
    const decay = Math.exp(-this.#omega * t);

    const aFrom = this.#x0.from - this.#target.from;
    const bFrom = this.#v0From + this.#omega * aFrom;
    const xFrom = this.#target.from + (aFrom + bFrom * t) * decay;
    const vFrom = (bFrom - this.#omega * (aFrom + bFrom * t)) * decay;

    const aTo = this.#x0.to - this.#target.to;
    const bTo = this.#v0To + this.#omega * aTo;
    const xTo = this.#target.to + (aTo + bTo * t) * decay;
    const vTo = (bTo - this.#omega * (aTo + bTo * t)) * decay;

    return { x: { from: xFrom, to: xTo }, vFrom, vTo };
  }

  #eps(): number {
    const range = Math.max(this.#target.to - this.#target.from, 1);

    return range * 1e-4;
  }
}

// =============================================================================
// Factory
// =============================================================================

export interface XSpringOpts {
  /**
   * Settle time (ms). Spring reaches ~99% of the target after this many ms.
   * Default {@link DEFAULT_X_SETTLE_MS}.
   */
  settleMs?: AnimationTime;
}

/**
 * Critically-damped spring X transition. Asymptotic approach, no fixed
 * deadline; velocity-continuous through any mid-flight retarget. Used for
 * the streaming X slide AND user gesture targets so a wheel-zoom series
 * feels continuous instead of stepping through discrete snaps.
 */
export function xSpring(opts: XSpringOpts = {}): TransitionFactory<VisibleRange> {
  const settleMs = resolveAnimationTime(opts.settleMs, DEFAULT_X_SETTLE_MS);

  return ({ initial }) => new VisibleRangeSpring({ initial, settleMs });
}
