/**
 * ViewportEngine — single-responsibility state machine for the chart's X / Y
 * viewport animations.
 *
 * Inputs are push signals from the chart (`onPointAppended`,
 * `onSeriesVisibilityChanged`, `onPanZoom`, `onProgrammaticZoom`,
 * `onAxisReconfig`, `onDataReplaced`, `snap`). Targets are pulled on demand
 * via the two callbacks the chart supplies at construction time —
 * `computeXTarget` and `computeYTarget` — so the engine itself stays free of
 * series / data-store knowledge.
 *
 * **Implicit ordering contract:** the chart must mutate its own series /
 * dataInterval / chartWidth state BEFORE calling any `on*` signal. Otherwise,
 * the callback reads stale data, and the engine targets the previous frame's
 * state.
 *
 * Internals: one `Animator<VisibleRange>` (linear easing) for X and a
 * pluggable `Transition` (Hermite / Spring / Snap) for Y. No event queue,
 * no slot priority — every `on*` retargets immediately, so chart code must
 * order calls so higher-priority intents (gestures, axis snaps) come AFTER
 * any lower-priority streaming retargets that may be in flight.
 */

import type { VisibleRange, YRange } from '../types';
import { Animator } from './animator';
import { easeLinear } from './easing';
import type { Milliseconds } from './time';
import type { Transition } from './transition';

/**
 * Per-frame engine snapshot — same shape returned by the legacy
 * `AnimationEngine.tick()` so existing consumers (chart render loop,
 * `chart.getAnimationState()` public API, series overlay hooks) keep working.
 */
export interface AnimationState {
  readonly yRange: YRange;
  readonly xRange: VisibleRange;
  readonly animating: boolean;
}

export interface PanZoomOptions {
  /** Final logical X range the user is committing to. */
  xTarget: VisibleRange;
  /**
   * When `true`, also recompute the Y target via the injected callback —
   * the visible-data window changed so the auto-fit Y should follow.
   * Set `false` (or omit) for pan / zoom modes that keep Y fixed.
   */
  yAuto?: boolean;
}

export interface ProgrammaticZoomOptions {
  /** Final logical X range. */
  xTarget: VisibleRange;
  /**
   * When `true`, X eases over `dataTickMs` (used by `fitContent` so the
   * viewport slides into the new window alongside the Y re-fit). When
   * omitted / `false`, X snaps instantly (used by `setVisibleRange`,
   * where consumers read `chart.getVisibleRange()` synchronously after
   * and expect the new target immediately).
   */
  xEase?: boolean;
}

export interface SnapTarget {
  x?: VisibleRange;
  y?: YRange;
}

export interface ViewportEngineOptions {
  initial: { yRange: YRange; xRange: VisibleRange };
  /** Pre-constructed Y transition (Hermite / Spring / Snap). */
  yTransition: Transition;
  /**
   * Streaming retarget duration for X (linear ease). When a function is
   * supplied, the engine queries it per emit — used by chart-side cadence
   * smoothing (EMA of inter-tick wall) to keep the X slide in lockstep with
   * a jittery producer.
   */
  dataTickMs: Milliseconds | (() => Milliseconds);
  /** Outward Y settle duration baked into streaming retargets. */
  yStickyExpandMs: Milliseconds;
  /** Inward Y settle duration baked into streaming retargets (sticky). */
  yStickyContractMs: Milliseconds;
  /** Symmetric Y duration used during gestures (overrides sticky). */
  yGestureMs: Milliseconds;
  /** X retarget duration on gestures. Often `0` = snap. */
  xGestureMs: Milliseconds;
  /** Cross-fade duration applied to Y on visibility toggles. */
  yVisibilityMs: Milliseconds;
  /**
   * Compute the next logical X target. Returning `null` skips the X
   * retarget (warm-up hold, visible window already covers the new data).
   */
  computeXTarget(): VisibleRange | null;
  /**
   * Compute the Y target that matches `xTarget`. Returning `null` skips
   * the Y retarget — used when no series carries data or every bound is
   * pinned by axis config.
   */
  computeYTarget(args: { xTarget: VisibleRange }): YRange | null;
  /** Fires once when an idle engine receives a new signal; host restarts RAF. */
  onWake?: () => void;
}

export interface ViewportEngine {
  /**
   * New data point appended — recompute both targets and retarget.
   *
   * Every `on*` signal accepts an optional `now` so the caller can capture
   * `performance.now()` once and pass it both here and to a subsequent
   * `tick(now)`. Keeping the emit's start wall equal to the tick's wall
   * matters for zero-duration retargets — without it the animator could
   * round its start time slightly later than the tick and skip the first
   * frame of the new ease.
   */
  onPointAppended(now?: number): void;
  /** Series visibility toggled — Y target only (X is untouched). */
  onSeriesVisibilityChanged(now?: number): void;
  /** User gesture committed a new X range. */
  onPanZoom(opts: PanZoomOptions, now?: number): void;
  /** Bulk data swap — snap both axes to the new target. */
  onDataReplaced(now?: number): void;
  /**
   * Axis / padding / layer-visibility reconfig — Y target recomputes and
   * snaps instantly. X is untouched. Used when the chart's Y bounds, padding,
   * or per-layer visibility changed but no data and no X window did.
   */
  onAxisReconfig(now?: number): void;
  /**
   * Programmatic zoom (`setVisibleRange`, `fitContent`) — X snaps to the
   * supplied logical range; Y is recomputed for that window and eases on
   * the sticky-Y baseline (fast expand / slow contract) so the axis re-fit
   * isn't a jarring jump.
   */
  onProgrammaticZoom(opts: ProgrammaticZoomOptions, now?: number): void;
  /** Instant-apply specific X / Y values without easing. */
  snap(target: SnapTarget, now?: number): void;

  /** Advance against `now`; returns the per-frame state. */
  tick(now: number): AnimationState;
  /** Last-tick value (no advance). */
  getAnimationState(): AnimationState;
  /** Latest target value. Equals `current` when settled. */
  getTarget(): { x: VisibleRange; y: YRange };
  /** Wall-clock the visible range will reach target. Equals `now` when settled. */
  getSettleAt(): number;
  /** Whether any axis is still in flight. */
  readonly animating: boolean;
  /**
   * Most recently committed X target, or `null` if no X retarget has fired
   * yet. Autoscroll consults this when deciding tail re-engagement so the
   * choice sees the *logical* destination, not the in-flight visual.
   */
  readonly lastXTarget: VisibleRange | null;

  /**
   * Sub-threshold X filter — emitted X retargets ignore deltas below this
   * value. Set by chart callers that want to suppress micro-jitter during
   * streaming.
   */
  setXThreshold(threshold: number | null): void;
}

const rangeLerp = (from: VisibleRange, to: VisibleRange, t: number): VisibleRange => ({
  from: from.from + (to.from - from.from) * t,
  to: from.to + (to.to - from.to) * t,
});

const rangeEquals = (a: VisibleRange, b: VisibleRange): boolean => a.from === b.from && a.to === b.to;

class ViewportEngineImpl implements ViewportEngine {
  readonly #xAnimator: Animator<VisibleRange>;
  readonly #yTransition: Transition;
  readonly #computeX: () => VisibleRange | null;
  readonly #computeY: (args: { xTarget: VisibleRange }) => YRange | null;
  readonly #dataTickMsOpt: Milliseconds | (() => Milliseconds);
  readonly #yExpandMs: Milliseconds;
  readonly #yContractMs: Milliseconds;
  readonly #yGestureMs: Milliseconds;
  readonly #xGestureMs: Milliseconds;
  readonly #yVisibilityMs: Milliseconds;
  readonly #onWake: (() => void) | undefined;
  /** Last call's projected wall-clock arrival; equals current `now` when settled. */
  #settleAt = 0;
  #xThreshold: number | null = null;
  #lastXTarget: VisibleRange | null = null;
  /** Per-frame `animating` snapshot — updated by `tick` so `get animating()` is O(1). */
  #lastAnimating = false;

  constructor(opts: ViewportEngineOptions) {
    this.#xAnimator = new Animator<VisibleRange>({
      initial: { from: opts.initial.xRange.from, to: opts.initial.xRange.to },
      duration: 0,
      lerp: rangeLerp,
      equals: rangeEquals,
      easing: easeLinear,
    });
    this.#yTransition = opts.yTransition;
    this.#computeX = opts.computeXTarget;
    this.#computeY = opts.computeYTarget;
    this.#dataTickMsOpt = opts.dataTickMs;
    this.#yExpandMs = opts.yStickyExpandMs;
    this.#yContractMs = opts.yStickyContractMs;
    this.#yGestureMs = opts.yGestureMs;
    this.#xGestureMs = opts.xGestureMs;
    this.#yVisibilityMs = opts.yVisibilityMs;
    this.#onWake = opts.onWake;
  }

  // --- Helpers -------------------------------------------------------------

  #dataTickMs(): Milliseconds {
    return typeof this.#dataTickMsOpt === 'function' ? this.#dataTickMsOpt() : this.#dataTickMsOpt;
  }

  /**
   * Retarget X with the supplied duration. Honors `#xThreshold` (filters
   * sub-threshold drift) and updates `#lastXTarget` only when the retarget
   * actually fires — autoscroll consults that field, so we must not
   * advertise an X destination the animator didn't accept.
   */
  #retargetX(target: VisibleRange, duration: Milliseconds, now: number): void {
    if (this.#xThreshold !== null && this.#xThreshold > 0 && this.#lastXTarget !== null) {
      const delta = Math.abs(target.to - this.#lastXTarget.to);
      if (delta < this.#xThreshold) return;
    }
    this.#xAnimator.setTarget(target, { duration, now });
    this.#lastXTarget = { from: target.from, to: target.to };
  }

  #snapX(target: VisibleRange): void {
    this.#xAnimator.snap({ from: target.from, to: target.to });
    this.#lastXTarget = { from: target.from, to: target.to };
  }

  /** Fire `onWake` once when an idle engine receives a new retarget. */
  #wake(wasIdle: boolean): void {
    if (wasIdle) this.#onWake?.();
  }

  // --- Inputs --------------------------------------------------------------

  onPointAppended(now?: number): void {
    const newX = this.#computeX();
    const yWindow = newX ?? this.#xAnimator.target;
    const newY = this.#computeY({ xTarget: yWindow });
    if (newX === null && newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    const dataTickMs = this.#dataTickMs();

    if (newX !== null) this.#retargetX(newX, dataTickMs, startWall);
    if (newY !== null) {
      this.#yTransition.retarget(newY, {
        now: startWall,
        expandMs: this.#yExpandMs,
        contractMs: this.#yContractMs,
      });
    }
    this.#settleAt = startWall + dataTickMs;
    this.#wake(wasIdle);
  }

  onSeriesVisibilityChanged(now?: number): void {
    const newY = this.#computeY({ xTarget: this.#xAnimator.target });
    if (newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    this.#yTransition.retarget(newY, {
      now: startWall,
      expandMs: this.#yVisibilityMs,
      contractMs: this.#yVisibilityMs,
    });
    this.#settleAt = startWall + this.#yVisibilityMs;
    this.#wake(wasIdle);
  }

  onPanZoom(opts: PanZoomOptions, now?: number): void {
    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;

    this.#retargetX(opts.xTarget, this.#xGestureMs, startWall);

    if (opts.yAuto) {
      const yTarget = this.#computeY({ xTarget: opts.xTarget });
      if (yTarget !== null) {
        this.#yTransition.retarget(yTarget, {
          now: startWall,
          expandMs: this.#yGestureMs,
          contractMs: this.#yGestureMs,
        });
      }
    }
    this.#settleAt = startWall + Math.max(this.#xGestureMs, this.#yGestureMs);
    this.#wake(wasIdle);
  }

  onAxisReconfig(now?: number): void {
    const newY = this.#computeY({ xTarget: this.#xAnimator.target });
    if (newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    this.#yTransition.snap(newY, { now: startWall });
    this.#settleAt = startWall;
    this.#wake(wasIdle);
  }

  onProgrammaticZoom(opts: ProgrammaticZoomOptions, now?: number): void {
    const newY = this.#computeY({ xTarget: opts.xTarget });
    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;

    if (opts.xEase === true) {
      const dataTickMs = this.#dataTickMs();
      this.#retargetX(opts.xTarget, dataTickMs, startWall);
      if (newY !== null) {
        this.#yTransition.retarget(newY, {
          now: startWall,
          expandMs: this.#yExpandMs,
          contractMs: this.#yContractMs,
        });
      }
      this.#settleAt = startWall + dataTickMs;
      this.#wake(wasIdle);

      return;
    }

    this.#snapX(opts.xTarget);
    if (newY !== null) {
      this.#yTransition.retarget(newY, {
        now: startWall,
        expandMs: this.#yExpandMs,
        contractMs: this.#yContractMs,
      });
      this.#settleAt = startWall + this.#yExpandMs;
    } else {
      this.#settleAt = startWall;
    }
    this.#wake(wasIdle);
  }

  onDataReplaced(now?: number): void {
    const newX = this.#computeX();
    const newY = this.#computeY({ xTarget: newX ?? this.#xAnimator.target });
    if (newX === null && newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    if (newX !== null) this.#snapX(newX);
    if (newY !== null) this.#yTransition.snap(newY, { now: startWall });
    this.#settleAt = startWall;
    this.#wake(wasIdle);
  }

  snap(target: SnapTarget, now?: number): void {
    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    if (target.x !== undefined) this.#snapX(target.x);
    if (target.y !== undefined) this.#yTransition.snap(target.y, { now: startWall });
    this.#settleAt = startWall;
    this.#wake(wasIdle);
  }

  // --- Outputs -------------------------------------------------------------

  tick(now: number): AnimationState {
    this.#xAnimator.tick(now);
    this.#yTransition.tick(now);
    const animating = this.#xAnimator.animating || this.#yTransition.animating;
    this.#lastAnimating = animating;

    return {
      xRange: this.#xAnimator.current,
      yRange: this.#yTransition.current,
      animating,
    };
  }

  getAnimationState(): AnimationState {
    return {
      xRange: this.#xAnimator.current,
      yRange: this.#yTransition.current,
      animating: this.#xAnimator.animating || this.#yTransition.animating,
    };
  }

  getTarget(): { x: VisibleRange; y: YRange } {
    return { x: this.#xAnimator.target, y: this.#yTransition.target };
  }

  getSettleAt(): number {
    return this.#settleAt;
  }

  get animating(): boolean {
    return this.#xAnimator.animating || this.#yTransition.animating;
  }

  get lastXTarget(): VisibleRange | null {
    return this.#lastXTarget;
  }

  setXThreshold(threshold: number | null): void {
    this.#xThreshold = threshold;
  }
}

export function createViewportEngine(opts: ViewportEngineOptions): ViewportEngine {
  return new ViewportEngineImpl(opts);
}
