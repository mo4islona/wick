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
 * PR-3 of the viewport-engine refactor: this is currently a thin wrapper
 * over the legacy slot-based {@link AnimationEngine} + {@link AnimationBridge}
 * pair. PR-4 will collapse the implementation to hold the X / Y machinery
 * directly without the underlying event/slot direction.
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

export interface SnapTarget {
  x?: VisibleRange;
  y?: YRange;
}

export interface ViewportEngineOptions {
  initial: { yRange: YRange; xRange: VisibleRange };
  /** Pre-constructed Y transition (Hermite / Spring / Snap). */
  yTransition: Transition;
  /** Streaming retarget duration for X (linear ease). */
  dataTickMs: Milliseconds;
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
  /** New data point appended — recompute both targets and retarget. */
  onPointAppended(): void;
  /** Series visibility toggled — Y target only (X is untouched). */
  onSeriesVisibilityChanged(): void;
  /** User gesture committed a new X range. */
  onPanZoom(opts: PanZoomOptions): void;
  /** Bulk data swap — snap both axes to the new target. */
  onDataReplaced(): void;
  /** Instant-apply specific X / Y values without easing. */
  snap(target: SnapTarget): void;

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
  readonly #dataTickMs: Milliseconds;
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
    this.#dataTickMs = opts.dataTickMs;
    this.#yExpandMs = opts.yStickyExpandMs;
    this.#yContractMs = opts.yStickyContractMs;
    this.#yGestureMs = opts.yGestureMs;
    this.#xGestureMs = opts.xGestureMs;
    this.#yVisibilityMs = opts.yVisibilityMs;
    this.#xTarget = { from: opts.initial.xRange.from, to: opts.initial.xRange.to };
    this.#yTarget = { min: opts.initial.yRange.min, max: opts.initial.yRange.max };
  }

  // --- Inputs --------------------------------------------------------------

  onPointAppended(): void {
    const newX = this.#computeX();
    const newY = newX !== null ? this.#computeY({ xTarget: newX }) : this.#computeY({ xTarget: this.#xTarget });
    if (newX === null && newY === null) return;

    const now = performance.now();
    if (newX !== null) this.#xTarget = { from: newX.from, to: newX.to };
    if (newY !== null) this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = now + this.#dataTickMs;

    this.#bridge.emitDataTick({
      duration: this.#dataTickMs,
      xTarget: newX,
      yTarget: newY !== null ? { target: newY, expandMs: this.#yExpandMs, contractMs: this.#yContractMs } : null,
      xThreshold: this.#xThreshold ?? undefined,
      startWall: now,
    });
  }

  onSeriesVisibilityChanged(): void {
    const newY = this.#computeY({ xTarget: this.#xTarget });
    if (newY === null) return;

    const now = performance.now();
    this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = now + this.#yVisibilityMs;

    this.#bridge.emitVisibility({
      duration: this.#yVisibilityMs,
      yTarget: { target: newY },
      startWall: now,
    });
  }

  onPanZoom(opts: PanZoomOptions): void {
    const now = performance.now();
    this.#xTarget = { from: opts.xTarget.from, to: opts.xTarget.to };

    let yTarget: YRange | null = null;
    if (opts.yAuto) {
      yTarget = this.#computeY({ xTarget: opts.xTarget });
      if (yTarget !== null) this.#yTarget = { min: yTarget.min, max: yTarget.max };
    }
    this.#settleAt = now + Math.max(this.#xGestureMs, this.#yGestureMs);

    this.#bridge.emitGesture({
      duration: this.#xGestureMs,
      xTarget: opts.xTarget,
      yTarget:
        yTarget !== null ? { target: yTarget, expandMs: this.#yGestureMs, contractMs: this.#yGestureMs } : undefined,
      startWall: now,
    });
  }

  onDataReplaced(): void {
    const newX = this.#computeX();
    const newY = this.#computeY({ xTarget: newX ?? this.#xTarget });
    if (newX === null && newY === null) return;

    const now = performance.now();
    if (newX !== null) this.#xTarget = { from: newX.from, to: newX.to };
    if (newY !== null) this.#yTarget = { min: newY.min, max: newY.max };
    this.#settleAt = now;

    this.#bridge.emitInstant({
      xTarget: newX ?? undefined,
      yTarget: newY !== null ? { target: newY } : undefined,
      startWall: now,
    });
  }

  snap(target: SnapTarget): void {
    const now = performance.now();
    if (target.x !== undefined) this.#xTarget = { from: target.x.from, to: target.x.to };
    if (target.y !== undefined) this.#yTarget = { min: target.y.min, max: target.y.max };
    this.#settleAt = now;

    this.#bridge.emitInstant({
      xTarget: target.x,
      yTarget: target.y !== undefined ? { target: target.y } : undefined,
      startWall: now,
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
