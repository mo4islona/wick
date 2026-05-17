import type { VisibleRange } from '../types';
import type { RetargetOptions, Transition } from './transition';

/** Default ω if engine ever calls `retarget` bare (engine always supplies). */
const FALLBACK_MS = 200;
const FALLBACK_OMEGA = 4.6 / (FALLBACK_MS / 1000);

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
 *
 * X has no expand/contract distinction — both sides of the visible range
 * use the same natural frequency. The engine always supplies the active
 * settle time per call via `RetargetOptions.expandMs`; this curve has no
 * stored baseline. Per-call `expandMs <= 0` folds the retarget into a snap.
 */
export class VisibleRangeSpring implements Transition<VisibleRange> {
  #x0: VisibleRange;
  #v0From = 0;
  #v0To = 0;
  #target: VisibleRange;
  /** Active natural frequency for the current animation. Set on each
   *  `retarget` from the per-call `expandMs`. */
  #omega = FALLBACK_OMEGA;
  #t0: number = -1;
  #cached: VisibleRange;

  constructor(opts: { initial: VisibleRange }) {
    this.#x0 = { from: opts.initial.from, to: opts.initial.to };
    this.#target = { from: opts.initial.from, to: opts.initial.to };
    this.#cached = { from: opts.initial.from, to: opts.initial.to };
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

  retarget(value: VisibleRange, opts: RetargetOptions = {}): void {
    const expandMs = opts.expandMs ?? FALLBACK_MS;
    if (expandMs <= 0) {
      this.snap(value, opts);

      return;
    }

    const now = opts.now ?? performance.now();
    const omega = 4.6 / (expandMs / 1000);

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
