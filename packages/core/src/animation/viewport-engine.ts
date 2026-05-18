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
 * Internals: one pluggable {@link Transition} per axis (Hermite / Spring /
 * Snap on Y, Spring / Snap on X). No event queue, no slot priority — every
 * `on*` retargets immediately. Per-call durations come from the engine's
 * grouped `y` / `x` opts; the curves themselves carry no baseline.
 */

import type { VisibleRange, YRange } from '../types';
import type { Milliseconds } from './time';
import type { Transition, TransitionFactory } from './transition';

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
   * When `true`, X eases to the new target (used by `fitContent` so the
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

export interface ViewportEngineYOptions {
  /** Y curve factory (hermite / spring / snap). */
  curve: TransitionFactory<YRange>;
  /** Outward settle time — bound expanding to a new extreme. */
  settleMs: Milliseconds;
  /** Inward settle time — bound contracting after extreme leaves window (sticky-Y). */
  stickyMs: Milliseconds;
  /** One-shot override during a user gesture. */
  gestureMs: Milliseconds;
  /** One-shot override on `onSeriesVisibilityChanged`. */
  toggleMs: Milliseconds;
}

export interface ViewportEngineXOptions {
  /** X curve factory (spring / snap). */
  curve: TransitionFactory<VisibleRange>;
  /**
   * Streaming baseline settle time. The cadence EMA mutates this at runtime
   * via {@link ViewportEngine.setXSettleMs} so the spring tracks the producer
   * cadence; the engine re-reads the latest value on every streaming retarget.
   */
  settleMs: Milliseconds;
  /** One-shot override during a user gesture or programmatic zoom. */
  gestureMs: Milliseconds;
}

export interface ViewportEngineOptions {
  initial: { yRange: YRange; xRange: VisibleRange };
  y: ViewportEngineYOptions;
  x: ViewportEngineXOptions;
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

  /**
   * Update the X spring's baseline settle time. Used by cadence-driven
   * adaptation: the chart measures inter-tick wall-clock and tunes the
   * spring so it never quite settles between data ticks. The next streaming
   * retarget picks up the new baseline.
   */
  setXSettleMs(settleMs: number): void;
}

/**
 * Gesture lock-out window. After a user pan/zoom, `onPointAppended` is
 * blocked for this many milliseconds so the next stream tick doesn't fight
 * the gesture's destination. With spring-based X, the lockout is shorter
 * than the spring's settle time on purpose — once the lockout passes, the
 * spring smoothly absorbs the next stream tick as a fresh retarget with
 * carried velocity.
 */
const X_GESTURE_LOCKOUT_MS = 100;

interface YState {
  readonly transition: Transition<YRange>;
  settleMs: Milliseconds;
  stickyMs: Milliseconds;
  gestureMs: Milliseconds;
  toggleMs: Milliseconds;
}

interface XState {
  readonly transition: Transition<VisibleRange>;
  settleMs: Milliseconds;
  gestureMs: Milliseconds;
  /** Sub-threshold filter — emitted retargets ignore deltas below this. */
  threshold: number | null;
  /** Most recently committed X target. Autoscroll consults this to see the
   *  logical destination, not the in-flight visual. */
  lastTarget: VisibleRange | null;
  /**
   * Wall-time deadline after which `onPointAppended` is allowed to retarget
   * again. While a gesture is active, the chart streams should not fight the
   * user's wheel/pinch destination — blocking the body of `onPointAppended`
   * keeps X and Y in lockstep with the gesture target until the lock-out
   * expires.
   */
  gestureUntil: number;
}

class ViewportEngineImpl implements ViewportEngine {
  readonly #y: YState;
  readonly #x: XState;
  readonly #computeX: () => VisibleRange | null;
  readonly #computeY: (args: { xTarget: VisibleRange }) => YRange | null;
  readonly #onWake: (() => void) | undefined;
  /** Per-frame `animating` snapshot — updated by `tick` so `get animating()`
   *  is O(1). Spans both axes; lives at the engine root rather than in
   *  XState/YState because it's a cross-axis flag. */
  #lastAnimating = false;

  constructor(opts: ViewportEngineOptions) {
    this.#y = {
      transition: opts.y.curve({ initial: opts.initial.yRange }),
      settleMs: opts.y.settleMs,
      stickyMs: opts.y.stickyMs,
      gestureMs: opts.y.gestureMs,
      toggleMs: opts.y.toggleMs,
    };
    this.#x = {
      transition: opts.x.curve({ initial: opts.initial.xRange }),
      settleMs: opts.x.settleMs,
      gestureMs: opts.x.gestureMs,
      threshold: null,
      lastTarget: null,
      gestureUntil: 0,
    };
    this.#computeX = opts.computeXTarget;
    this.#computeY = opts.computeYTarget;
    this.#onWake = opts.onWake;
  }

  // --- Helpers -------------------------------------------------------------

  /**
   * Retarget X. Honors `#x.threshold` (filters sub-threshold drift) and
   * updates `#x.lastTarget` only when the retarget actually fires —
   * autoscroll consults that field, so we must not advertise an X destination
   * the spring didn't accept.
   *
   * `settleMs` is the per-call settle time. Gestures pass `#x.gestureMs`
   * (fast — responsive feel) while stream ticks pass `#x.settleMs` (the
   * cadence-tuned baseline).
   */
  #retargetX(target: VisibleRange, now: number, settleMs: Milliseconds): void {
    if (this.#x.threshold !== null && this.#x.threshold > 0 && this.#x.lastTarget !== null) {
      const delta = Math.abs(target.to - this.#x.lastTarget.to);
      if (delta < this.#x.threshold) return;
    }
    this.#x.transition.retarget(target, { now, expandMs: settleMs });
    this.#x.lastTarget = { from: target.from, to: target.to };
  }

  #snapX(target: VisibleRange, now: number): void {
    this.#x.transition.snap({ from: target.from, to: target.to }, { now });
    this.#x.lastTarget = { from: target.from, to: target.to };
  }

  /** Fire `onWake` once when an idle engine receives a new retarget. */
  #wake(wasIdle: boolean): void {
    if (wasIdle) this.#onWake?.();
  }

  // --- Inputs --------------------------------------------------------------

  onPointAppended(now?: number): void {
    const startWall = now ?? performance.now();
    if (startWall < this.#x.gestureUntil) return;

    const newX = this.#computeX();
    const yWindow = newX ?? this.#x.transition.target;
    const newY = this.#computeY({ xTarget: yWindow });
    if (newX === null && newY === null) return;

    const wasIdle = !this.#lastAnimating;

    if (newX !== null) this.#retargetX(newX, startWall, this.#x.settleMs);
    if (newY !== null) {
      this.#y.transition.retarget(newY, {
        now: startWall,
        expandMs: this.#y.settleMs,
        contractMs: this.#y.stickyMs,
      });
    }
    this.#wake(wasIdle);
  }

  onSeriesVisibilityChanged(now?: number): void {
    const newY = this.#computeY({ xTarget: this.#x.transition.target });
    if (newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    this.#y.transition.retarget(newY, {
      now: startWall,
      expandMs: this.#y.toggleMs,
      contractMs: this.#y.toggleMs,
    });
    this.#wake(wasIdle);
  }

  onPanZoom(opts: PanZoomOptions, now?: number): void {
    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;

    this.#retargetX(opts.xTarget, startWall, this.#x.gestureMs);
    this.#x.gestureUntil = startWall + X_GESTURE_LOCKOUT_MS;

    if (opts.yAuto) {
      const yTarget = this.#computeY({ xTarget: opts.xTarget });
      if (yTarget !== null) {
        this.#y.transition.retarget(yTarget, {
          now: startWall,
          expandMs: this.#y.gestureMs,
          contractMs: this.#y.gestureMs,
        });
      }
    }
    this.#wake(wasIdle);
  }

  onAxisReconfig(now?: number): void {
    const newY = this.#computeY({ xTarget: this.#x.transition.target });
    if (newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    this.#y.transition.snap(newY, { now: startWall });
    this.#wake(wasIdle);
  }

  onProgrammaticZoom(opts: ProgrammaticZoomOptions, now?: number): void {
    this.#x.gestureUntil = 0;
    const newY = this.#computeY({ xTarget: opts.xTarget });
    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;

    if (opts.xEase === true) {
      this.#retargetX(opts.xTarget, startWall, this.#x.gestureMs);
      if (newY !== null) {
        this.#y.transition.retarget(newY, {
          now: startWall,
          expandMs: this.#y.settleMs,
          contractMs: this.#y.stickyMs,
        });
      }
      this.#wake(wasIdle);

      return;
    }

    this.#snapX(opts.xTarget, startWall);
    if (newY !== null) {
      this.#y.transition.retarget(newY, {
        now: startWall,
        expandMs: this.#y.settleMs,
        contractMs: this.#y.stickyMs,
      });
    }
    this.#wake(wasIdle);
  }

  onDataReplaced(now?: number): void {
    const newX = this.#computeX();
    const newY = this.#computeY({ xTarget: newX ?? this.#x.transition.target });
    if (newX === null && newY === null) return;

    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    if (newX !== null) this.#snapX(newX, startWall);
    if (newY !== null) this.#y.transition.snap(newY, { now: startWall });
    this.#wake(wasIdle);
  }

  snap(target: SnapTarget, now?: number): void {
    this.#x.gestureUntil = 0;
    const startWall = now ?? performance.now();
    const wasIdle = !this.#lastAnimating;
    if (target.x !== undefined) this.#snapX(target.x, startWall);
    if (target.y !== undefined) this.#y.transition.snap(target.y, { now: startWall });
    this.#wake(wasIdle);
  }

  // --- Outputs -------------------------------------------------------------

  tick(now: number): AnimationState {
    this.#x.transition.tick(now);
    this.#y.transition.tick(now);
    const animating = this.#x.transition.animating || this.#y.transition.animating;
    this.#lastAnimating = animating;

    return {
      xRange: this.#x.transition.current,
      yRange: this.#y.transition.current,
      animating,
    };
  }

  getAnimationState(): AnimationState {
    return {
      xRange: this.#x.transition.current,
      yRange: this.#y.transition.current,
      animating: this.#x.transition.animating || this.#y.transition.animating,
    };
  }

  getTarget(): { x: VisibleRange; y: YRange } {
    return { x: this.#x.transition.target, y: this.#y.transition.target };
  }

  get animating(): boolean {
    return this.#x.transition.animating || this.#y.transition.animating;
  }

  get lastXTarget(): VisibleRange | null {
    return this.#x.lastTarget;
  }

  setXThreshold(threshold: number | null): void {
    this.#x.threshold = threshold;
  }

  setXSettleMs(settleMs: number): void {
    this.#x.settleMs = settleMs;
  }
}

export function createViewportEngine(opts: ViewportEngineOptions): ViewportEngine {
  return new ViewportEngineImpl(opts);
}
