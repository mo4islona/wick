/**
 * ViewportEngine — single-responsibility state machine for the chart's X / Y
 * viewport animations.
 *
 * Inputs are push signals from the chart (`onPointAppended`,
 * `onSeriesVisibilityChanged`, `onPanZoom`, `onDataReplaced`, `snap`). Targets
 * are pulled on demand via the two callbacks the chart supplies at
 * construction time — `computeXTarget` and `computeYTarget` — so the engine
 * itself stays free of series / data-store knowledge.
 *
 * **Implicit ordering contract:** the chart must mutate its own series /
 * dataInterval / chartWidth state BEFORE calling any `on*` signal. Otherwise,
 * the callback reads stale data, and the engine targets the previous frame's
 * state.
 *
 * Currently, a thin wrapper over the legacy slot-based {@link AnimationEngine}
 * + {@link AnimationBridge} pair while the chart migration is in progress;
 * the wrapper collapses to a standalone X / Y implementation once chart
 * call sites stop reaching the inner engine directly.
 */

import { AnimationBridge } from '../chart/animation-bridge';
import type { VisibleRange, YRange } from '../types';
import type { AnimationEngine } from './engine';
import { createAnimationEngine } from './engine';
import type { Milliseconds } from './time';
import type { Transition } from './transition';

export interface ViewportSnapshot {
  readonly current: { readonly x: VisibleRange; readonly y: YRange };
  readonly target: { readonly x: VisibleRange; readonly y: YRange };
  readonly animating: boolean;
  /** Wall-clock ms when `current` is projected to reach `target`. Equals `now` when settled. */
  readonly settleAt: number;
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
   * `tick(now)`. Keeping `effectiveNow === startWall` is required by the
   * underlying engine's zero-duration prune step; if you let the engine
   * read the wall itself, microsecond drift between the emit and the tick
   * silently drops `instant` events.
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

  /** Advance against `now`; returns the per-frame snapshot. */
  tick(now: number): ViewportSnapshot;
  /** Last-tick value (no advance). */
  getCurrent(): { x: VisibleRange; y: YRange };
  /** Latest target value. Equals `current` when settled. */
  getTarget(): { x: VisibleRange; y: YRange };
  /** Wall-clock the visible range will reach target. Equals `now` when settled. */
  getSettleAt(): number;
  /** Whether any axis is still in flight. */
  readonly animating: boolean;
  /**
   * Most recently committed X target, or `null` if no X retarget has fired
   * yet. Mirrors the legacy {@link AnimationBridge.lastXTarget} contract —
   * autoscroll consults this when deciding tail re-engagement so the choice
   * sees the *logical* destination, not the in-flight visual.
   */
  readonly lastXTarget: VisibleRange | null;

  /**
   * Sub-threshold X filter — emitted X retargets ignore deltas below this
   * value. Set on the underlying bridge by chart callers that want to
   * suppress micro-jitter during streaming.
   */
  setXThreshold(threshold: number | null): void;

  /** Hook into the underlying low-level engine for back-compat call sites. */
  readonly inner: AnimationEngine;
}

class ViewportEngineImpl implements ViewportEngine {
  readonly #engine: AnimationEngine;
  readonly #bridge: AnimationBridge;
  readonly #computeX: () => VisibleRange | null;
  readonly #computeY: (args: { xTarget: VisibleRange }) => YRange | null;
  readonly #dataTickMsOpt: Milliseconds | (() => Milliseconds);
  readonly #yExpandMs: Milliseconds;
  readonly #yContractMs: Milliseconds;
  readonly #yGestureMs: Milliseconds;
  readonly #xGestureMs: Milliseconds;
  readonly #yVisibilityMs: Milliseconds;
  #xTarget: VisibleRange;
  #yTarget: YRange;
  #settleAt = 0;
  #xThreshold: number | null = null;

  constructor(opts: ViewportEngineOptions) {
    this.#engine = createAnimationEngine({
      initial: opts.initial,
      yTransition: opts.yTransition,
      onWake: opts.onWake,
    });
    this.#bridge = new AnimationBridge({ engine: this.#engine });
    this.#computeX = opts.computeXTarget;
    this.#computeY = opts.computeYTarget;
    this.#dataTickMsOpt = opts.dataTickMs;
    this.#yExpandMs = opts.yStickyExpandMs;
    this.#yContractMs = opts.yStickyContractMs;
    this.#yGestureMs = opts.yGestureMs;
    this.#xGestureMs = opts.xGestureMs;
    this.#yVisibilityMs = opts.yVisibilityMs;
    this.#xTarget = { from: opts.initial.xRange.from, to: opts.initial.xRange.to };
    this.#yTarget = { min: opts.initial.yRange.min, max: opts.initial.yRange.max };
  }

  #dataTickMs(): Milliseconds {
    return typeof this.#dataTickMsOpt === 'function' ? this.#dataTickMsOpt() : this.#dataTickMsOpt;
  }

  // --- Inputs --------------------------------------------------------------

  onPointAppended(now?: number): void {
    const newX = this.#computeX();
    const newY = newX !== null ? this.#computeY({ xTarget: newX }) : this.#computeY({ xTarget: this.#xTarget });
    if (newX === null && newY === null) return;

    const startWall = now ?? performance.now();
    const dataTickMs = this.#dataTickMs();
    if (newX !== null) this.#xTarget = { from: newX.from, to: newX.to };
    if (newY !== null) this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = startWall + dataTickMs;

    this.#bridge.emitDataTick({
      duration: dataTickMs,
      xTarget: newX,
      yTarget: newY !== null ? { target: newY, expandMs: this.#yExpandMs, contractMs: this.#yContractMs } : null,
      xThreshold: this.#xThreshold ?? undefined,
      startWall,
    });
  }

  onSeriesVisibilityChanged(now?: number): void {
    const newY = this.#computeY({ xTarget: this.#xTarget });
    if (newY === null) return;

    const startWall = now ?? performance.now();
    this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = startWall + this.#yVisibilityMs;

    this.#bridge.emitVisibility({
      duration: this.#yVisibilityMs,
      yTarget: { target: newY },
      startWall,
    });
  }

  onPanZoom(opts: PanZoomOptions, now?: number): void {
    const startWall = now ?? performance.now();
    this.#xTarget = { from: opts.xTarget.from, to: opts.xTarget.to };

    let yTarget: YRange | null = null;
    if (opts.yAuto) {
      yTarget = this.#computeY({ xTarget: opts.xTarget });
      if (yTarget !== null) this.#yTarget = { min: yTarget.min, max: yTarget.max };
    }
    this.#settleAt = startWall + Math.max(this.#xGestureMs, this.#yGestureMs);

    this.#bridge.emitGesture({
      duration: this.#xGestureMs,
      xTarget: opts.xTarget,
      yTarget:
        yTarget !== null ? { target: yTarget, expandMs: this.#yGestureMs, contractMs: this.#yGestureMs } : undefined,
      startWall,
    });
  }

  onAxisReconfig(now?: number): void {
    const newY = this.#computeY({ xTarget: this.#xTarget });
    if (newY === null) return;

    const startWall = now ?? performance.now();
    this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = startWall;

    this.#bridge.emitInstant({
      yTarget: { target: newY },
      startWall,
    });
  }

  onProgrammaticZoom(opts: ProgrammaticZoomOptions, now?: number): void {
    const newY = this.#computeY({ xTarget: opts.xTarget });

    const startWall = now ?? performance.now();
    this.#xTarget = { from: opts.xTarget.from, to: opts.xTarget.to };
    if (newY !== null) this.#yTarget = { min: newY.min, max: newY.max };

    if (opts.xEase === true) {
      const dataTickMs = this.#dataTickMs();
      this.#bridge.emitDataTick({
        duration: dataTickMs,
        xTarget: opts.xTarget,
        yTarget: newY !== null ? { target: newY, expandMs: this.#yExpandMs, contractMs: this.#yContractMs } : null,
        startWall,
      });
      this.#settleAt = startWall + dataTickMs;

      return;
    }

    this.#bridge.emitInstant({ xTarget: opts.xTarget, startWall });

    if (newY !== null) {
      this.#bridge.emitDataTick({
        duration: this.#yExpandMs,
        xTarget: null,
        yTarget: { target: newY, expandMs: this.#yExpandMs, contractMs: this.#yContractMs },
        startWall,
      });
      this.#settleAt = startWall + this.#yExpandMs;
    } else {
      this.#settleAt = startWall;
    }
  }

  onDataReplaced(now?: number): void {
    const newX = this.#computeX();
    const newY = this.#computeY({ xTarget: newX ?? this.#xTarget });
    if (newX === null && newY === null) return;

    const startWall = now ?? performance.now();
    if (newX !== null) this.#xTarget = { from: newX.from, to: newX.to };
    if (newY !== null) this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = startWall;

    this.#bridge.emitInstant({
      xTarget: newX ?? undefined,
      yTarget: newY !== null ? { target: newY } : undefined,
      startWall,
    });
  }

  snap(target: SnapTarget, now?: number): void {
    const startWall = now ?? performance.now();
    if (target.x !== undefined) this.#xTarget = { from: target.x.from, to: target.x.to };
    if (target.y !== undefined) this.#yTarget = { min: target.y.min, max: target.y.max };
    this.#settleAt = startWall;

    this.#bridge.emitInstant({
      xTarget: target.x,
      yTarget: target.y !== undefined ? { target: target.y } : undefined,
      startWall,
    });
  }

  // --- Outputs -------------------------------------------------------------

  tick(now: number): ViewportSnapshot {
    const state = this.#engine.tick(now);
    return {
      current: { x: state.xRange, y: state.yRange },
      target: { x: this.#xTarget, y: this.#yTarget },
      animating: state.animating,
      settleAt: this.#settleAt,
    };
  }

  getCurrent(): { x: VisibleRange; y: YRange } {
    const state = this.#engine.getAnimationState();
    return { x: state.xRange, y: state.yRange };
  }

  getTarget(): { x: VisibleRange; y: YRange } {
    return { x: this.#xTarget, y: this.#yTarget };
  }

  getSettleAt(): number {
    return this.#settleAt;
  }

  get animating(): boolean {
    return this.#engine.getAnimationState().animating;
  }

  get lastXTarget(): VisibleRange | null {
    return this.#bridge.lastXTarget;
  }

  setXThreshold(threshold: number | null): void {
    this.#xThreshold = threshold;
  }

  get inner(): AnimationEngine {
    return this.#engine;
  }
}

export function createViewportEngine(opts: ViewportEngineOptions): ViewportEngine {
  return new ViewportEngineImpl(opts);
}
