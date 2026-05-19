import type { YRange } from '../types';
import type { RetargetOptions, Transition } from './transition';

/** Default ω if engine ever calls `retarget` bare (engine always supplies). */
const FALLBACK_MS = 250;
const FALLBACK_OMEGA = 4.6 / (FALLBACK_MS / 1000);

/**
 * Critically-damped spring tracking a {@link YRange} target. The min and
 * max bounds are two independent scalar springs; each one's natural
 * frequency is selected per {@link retarget} call based on the direction
 * that bound is moving:
 *
 * - **Outward** (new target is *outside* the current bound — new extreme
 *   enters the window): the bound uses the call's `expandMs`. Reaction is
 *   fast so the entering value doesn't render off-canvas.
 * - **Inward** (new target is *inside* the current bound — extreme has
 *   left the window): the bound uses the call's `contractMs`. Slower so
 *   the chart holds the wider range and doesn't visibly reflow each time
 *   a high/low scrolls out of view.
 *
 * Why spring instead of `Animator<YRange>` with an easing curve: every
 * `retarget` while the animator was already in flight restarted the cubic
 * ease from the current position, which means each retarget produced a fresh
 * acceleration ramp on top of the existing motion — visible as a "decel /
 * re-accel" twitch on streaming feeds where Y target shifts on every tick.
 * The spring instead keeps the current velocity at retarget time and just
 * pulls toward the new target, so motion stays velocity-continuous through
 * any number of mid-flight target changes.
 *
 * Critically damped (`c = 2ω`) guarantees the fastest convergence and no
 * overshoot of the target. The closed-form solution
 * `x(t) = target + (a + b·t)·e^(−ωt)` (with `a = x₀ − target` and
 * `b = v₀ + ω·a`) is integrated analytically per `tick`, so the simulation
 * is stable for any frame interval and any settle time.
 *
 * The engine is the single source of truth for the per-call durations —
 * this curve has no stored baseline.
 */
export class YRangeSpring implements Transition<YRange> {
  #x0: YRange;
  #v0Min = 0;
  #v0Max = 0;
  #target: YRange;
  /** Per-side ω selected at the most recent retarget call. Sample uses
   *  these — sides can run at different speeds during the same chase. */
  #omegaMin = FALLBACK_OMEGA;
  #omegaMax = FALLBACK_OMEGA;
  #t0: number = -1;
  #cached: YRange;

  constructor(opts: { initial: YRange }) {
    this.#x0 = { min: opts.initial.min, max: opts.initial.max };
    this.#target = { min: opts.initial.min, max: opts.initial.max };
    this.#cached = { min: opts.initial.min, max: opts.initial.max };
  }

  get current(): YRange {
    return this.#cached;
  }

  get target(): YRange {
    return this.#target;
  }

  get animating(): boolean {
    const eps = this.#eps();
    const minOmega = Math.min(this.#omegaMin, this.#omegaMax);

    return (
      Math.abs(this.#cached.min - this.#target.min) > eps ||
      Math.abs(this.#cached.max - this.#target.max) > eps ||
      Math.abs(this.#v0Min) > eps * minOmega ||
      Math.abs(this.#v0Max) > eps * minOmega
    );
  }

  retarget(value: YRange, opts: RetargetOptions = {}): void {
    const now = opts.now ?? performance.now();
    const expandMs = opts.expandMs ?? FALLBACK_MS;
    const contractMs = opts.contractMs ?? FALLBACK_MS;
    const omegaExpand = 4.6 / (expandMs / 1000);
    const omegaContract = 4.6 / (contractMs / 1000);

    if (this.#t0 < 0) {
      this.#target = { min: value.min, max: value.max };
      this.#omegaMin = omegaExpand;
      this.#omegaMax = omegaExpand;
      this.#t0 = now;

      return;
    }

    // Sample current position and velocity at `now` (using the per-side
    // ω that was active for the previous target), then start a fresh
    // spring per side with direction-aware ω for the new target.
    const { x, vMin, vMax } = this.#sample(now);
    this.#x0 = x;
    this.#v0Min = vMin;
    this.#v0Max = vMax;

    // Min spring is *expanding* if the new target moves min DOWN
    // (range opens up below the current bound); contracting if min moves
    // UP toward the centre of the range.
    this.#omegaMin = value.min < x.min ? omegaExpand : omegaContract;

    // Max spring is expanding if target.max moves UP; contracting if it
    // moves DOWN.
    this.#omegaMax = value.max > x.max ? omegaExpand : omegaContract;

    this.#target = { min: value.min, max: value.max };
    this.#t0 = now;
    this.#cached = x;
  }

  /** Land at `value` immediately. Velocity is reset to zero. */
  snap(value: YRange, opts: { now?: number } = {}): void {
    const now = opts.now ?? performance.now();
    this.#x0 = { min: value.min, max: value.max };
    this.#target = { min: value.min, max: value.max };
    this.#v0Min = 0;
    this.#v0Max = 0;
    this.#t0 = now;
    this.#cached = { min: value.min, max: value.max };
  }

  /** Advance the analytic solution to `now`. Returns `true` while still
   *  perceptibly moving (animating); `false` when settled within ε of target. */
  tick(now: number): boolean {
    if (this.#t0 < 0) {
      this.#t0 = now;

      return false;
    }

    const { x, vMin, vMax } = this.#sample(now);
    this.#cached = x;
    const eps = this.#eps();
    const minOmega = Math.min(this.#omegaMin, this.#omegaMax);
    if (
      Math.abs(x.min - this.#target.min) < eps &&
      Math.abs(x.max - this.#target.max) < eps &&
      Math.abs(vMin) < eps * minOmega &&
      Math.abs(vMax) < eps * minOmega
    ) {
      this.#cached = { min: this.#target.min, max: this.#target.max };
      this.#x0 = { min: this.#target.min, max: this.#target.max };
      this.#v0Min = 0;
      this.#v0Max = 0;
      this.#t0 = now;

      return false;
    }

    return true;
  }

  #sample(now: number): { x: YRange; vMin: number; vMax: number } {
    const t = Math.max(0, (now - this.#t0) / 1000);
    const decayMin = Math.exp(-this.#omegaMin * t);
    const decayMax = Math.exp(-this.#omegaMax * t);

    const aMin = this.#x0.min - this.#target.min;
    const bMin = this.#v0Min + this.#omegaMin * aMin;
    const xMin = this.#target.min + (aMin + bMin * t) * decayMin;
    const vMin = (bMin - this.#omegaMin * (aMin + bMin * t)) * decayMin;

    const aMax = this.#x0.max - this.#target.max;
    const bMax = this.#v0Max + this.#omegaMax * aMax;
    const xMax = this.#target.max + (aMax + bMax * t) * decayMax;
    const vMax = (bMax - this.#omegaMax * (aMax + bMax * t)) * decayMax;

    return { x: { min: xMin, max: xMax }, vMin, vMax };
  }

  #eps(): number {
    const range = Math.max(this.#target.max - this.#target.min, 1);

    return range * 1e-4;
  }
}
