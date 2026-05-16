import type { YRange } from '../types';
import { DEFAULT_HERMITE_CONTRACT, DEFAULT_HERMITE_EXPAND } from './config';
import { type AnimationTime, resolveAnimationTime } from './time';
import type { RetargetOptions, Transition, TransitionFactory } from './transition';

export interface YRangeHermiteOptions {
  initial: YRange;
  /** Duration (ms) for *outward* bound motion — when a side moves away from
   *  the centre to reach a new extreme. */
  expandMs: number;
  /** Duration (ms) for *inward* bound motion — contracting toward the
   *  centre after a recent extreme leaves the visible window. */
  contractMs: number;
}

/**
 * Velocity-matched cubic Hermite animator for {@link YRange}. Direct
 * alternative to {@link YRangeSpring} with the same {@link Transition}
 * contract — switchable at chart construction so the spring vs Hermite
 * trade-off can be evaluated A/B without code changes elsewhere.
 *
 * Each `retarget` starts a new cubic Hermite segment per side
 *
 * ```
 *   x(t) = h00(t)·p0 + h10(t)·D·v0 + h01(t)·p1 + h11(t)·D·v1
 * ```
 *
 * with `p0` = current position at retarget, `v0` = current velocity at
 * retarget (units/sec), `p1` = new target, `v1 = 0` (settle to rest),
 * `D` = duration in seconds, and `t = elapsed / D ∈ [0, 1]`. The basis
 * functions `h00 = 2t³−3t²+1`, `h10 = t³−2t²+t`, `h01 = −2t³+3t²`,
 * `h11 = t³−t²` are the standard cubic Hermite blends.
 *
 * Why this exists alongside Spring: Hermite has a *bounded* duration —
 * after `D` ms each side is exactly at the target with velocity zero, no
 * exponential tail. That's predictable for animations whose end-state
 * matters (axis labels can settle in a known time). Spring has no
 * deadline — convergence is asymptotic. For rapid continuous retargets
 * (the streaming-Y case), Spring is usually smoother because its physics
 * naturally absorbs velocity changes; for one-shot moves with a clear end
 * (zoom, programmatic fit), Hermite is more controlled.
 *
 * Per-side direction-aware duration: same semantics as Spring — outward
 * moves use `expandMs`, inward moves use `contractMs`. Sides may run at
 * different durations during the same retarget.
 */
export class YRangeHermite implements Transition {
  #x0: YRange;
  #v0Min = 0;
  #v0Max = 0;
  #target: YRange;
  #t0: number = -1;
  /** Per-side active duration in seconds. */
  #durMin: number;
  #durMax: number;
  #expandMs: number;
  #contractMs: number;
  #cached: YRange;

  constructor(opts: YRangeHermiteOptions) {
    this.#x0 = { min: opts.initial.min, max: opts.initial.max };
    this.#target = { min: opts.initial.min, max: opts.initial.max };
    this.#cached = { min: opts.initial.min, max: opts.initial.max };
    this.#expandMs = opts.expandMs;
    this.#contractMs = opts.contractMs;
    this.#durMin = opts.expandMs / 1000;
    this.#durMax = opts.expandMs / 1000;
  }

  get current(): YRange {
    return this.#cached;
  }

  get target(): YRange {
    return this.#target;
  }

  get animating(): boolean {
    if (this.#t0 < 0) return false;

    // We don't know "now" here — the host calls animating between ticks,
    // so we approximate: animating iff position is not yet at target. The
    // tick path snaps current to exact target at end-of-segment.
    const eps = this.#eps();

    return Math.abs(this.#cached.min - this.#target.min) > eps || Math.abs(this.#cached.max - this.#target.max) > eps;
  }

  setSettleMs(opts: { expandMs?: number; contractMs?: number }): void {
    if (opts.expandMs !== undefined) this.#expandMs = opts.expandMs;
    if (opts.contractMs !== undefined) this.#contractMs = opts.contractMs;
  }

  retarget(value: YRange, opts: RetargetOptions = {}): void {
    const now = opts.now ?? performance.now();
    const expandMs = opts.expandMs ?? this.#expandMs;
    const contractMs = opts.contractMs ?? this.#contractMs;

    if (this.#t0 < 0) {
      this.#target = { min: value.min, max: value.max };
      this.#durMin = (value.min < this.#cached.min ? expandMs : contractMs) / 1000;
      this.#durMax = (value.max > this.#cached.max ? expandMs : contractMs) / 1000;
      this.#t0 = now;

      return;
    }

    const { x, vMin, vMax } = this.#sample(now);
    this.#x0 = x;
    this.#v0Min = vMin;
    this.#v0Max = vMax;
    this.#durMin = (value.min < x.min ? expandMs : contractMs) / 1000;
    this.#durMax = (value.max > x.max ? expandMs : contractMs) / 1000;
    this.#target = { min: value.min, max: value.max };
    this.#t0 = now;
    this.#cached = x;
  }

  snap(value: YRange, opts: { now?: number } = {}): void {
    const now = opts.now ?? performance.now();
    this.#x0 = { min: value.min, max: value.max };
    this.#target = { min: value.min, max: value.max };
    this.#v0Min = 0;
    this.#v0Max = 0;
    this.#t0 = now;
    this.#cached = { min: value.min, max: value.max };
  }

  tick(now: number): boolean {
    if (this.#t0 < 0) {
      this.#t0 = now;

      return false;
    }

    // Fast-path: a snap (or a retarget where x0 already matched value)
    // leaves x0 === target, so there is nothing to animate. Without this,
    // tick on a freshly-snapped animator would still report animating
    // for the full segment duration even though `cached` is already at
    // the target — which trips host-side viewportChange emit gates.
    if (
      this.#x0.min === this.#target.min &&
      this.#x0.max === this.#target.max &&
      this.#v0Min === 0 &&
      this.#v0Max === 0
    ) {
      return false;
    }

    const { x } = this.#sample(now);
    this.#cached = x;
    const elapsed = (now - this.#t0) / 1000;
    if (elapsed >= this.#durMin && elapsed >= this.#durMax) {
      // Both sides past their segment duration — lock to exact target.
      this.#cached = { min: this.#target.min, max: this.#target.max };
      this.#x0 = { min: this.#target.min, max: this.#target.max };
      this.#v0Min = 0;
      this.#v0Max = 0;

      return false;
    }

    return true;
  }

  #sample(now: number): { x: YRange; vMin: number; vMax: number } {
    const elapsed = Math.max(0, (now - this.#t0) / 1000);

    const tMin = this.#durMin > 0 ? Math.min(1, elapsed / this.#durMin) : 1;
    const tMax = this.#durMax > 0 ? Math.min(1, elapsed / this.#durMax) : 1;

    const xMin = this.#hermitePos(this.#x0.min, this.#v0Min, this.#target.min, tMin, this.#durMin);
    const vMin = tMin >= 1 ? 0 : this.#hermiteVel(this.#x0.min, this.#v0Min, this.#target.min, tMin, this.#durMin);

    const xMax = this.#hermitePos(this.#x0.max, this.#v0Max, this.#target.max, tMax, this.#durMax);
    const vMax = tMax >= 1 ? 0 : this.#hermiteVel(this.#x0.max, this.#v0Max, this.#target.max, tMax, this.#durMax);

    return { x: { min: xMin, max: xMax }, vMin, vMax };
  }

  #hermitePos(p0: number, v0: number, p1: number, t: number, dur: number): number {
    if (t >= 1) return p1;

    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;

    // v1 = 0, so h11 term vanishes.
    return h00 * p0 + h10 * dur * v0 + h01 * p1;
  }

  #hermiteVel(p0: number, v0: number, p1: number, t: number, dur: number): number {
    if (dur <= 0) return 0;

    const t2 = t * t;
    const dh00 = 6 * t2 - 6 * t;
    const dh10 = 3 * t2 - 4 * t + 1;
    const dh01 = -6 * t2 + 6 * t;

    // v1 = 0, so dh11 term vanishes.
    return (dh00 * p0 + dh10 * dur * v0 + dh01 * p1) / dur;
  }

  #eps(): number {
    const range = Math.max(this.#target.max - this.#target.min, 1);

    return range * 1e-4;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Per-instance baseline timings for {@link hermite}. The chart applies per-
 * call overrides (user gesture short-ease, visibility-toggle sync) via the
 * `expandMs` / `contractMs` arguments to `retarget()`; these defaults govern
 * everything else — normal streaming retargets, programmatic fit, etc.
 */
export interface HermiteOpts {
  /** Outward (expanding) settle time. Default 250 ms. */
  expand?: AnimationTime;
  /** Inward (contracting) settle time. Default 2500 ms. */
  contract?: AnimationTime;
}

/**
 * Default Y transition. Velocity-matched cubic Hermite with a fixed
 * per-segment deadline: after `expand` / `contract` ms each side is exactly
 * at the target. Direction-aware — outward moves use `expand`, inward moves
 * use `contract`.
 *
 * Lives in its own module so the Hermite math isn't pulled into bundles
 * that only use spring or snap.
 */
export function hermite(opts: HermiteOpts = {}): TransitionFactory {
  const expandMs = resolveAnimationTime(opts.expand, DEFAULT_HERMITE_EXPAND);
  const contractMs = resolveAnimationTime(opts.contract, DEFAULT_HERMITE_CONTRACT);

  return ({ initial }) => new YRangeHermite({ initial, expandMs, contractMs });
}
