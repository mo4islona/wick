import type { AnimationEngine } from '../animation/engine';
import type { Milliseconds } from '../animation/time';
import type { VisibleRange, YRange } from '../types';

/**
 * Y emit target. `expandMs` / `contractMs` are forwarded straight to the
 * engine's Y `Transition.retarget` call, letting the chart preserve the
 * asymmetric sticky-Y baseline (fast expand, slow contract) on streaming
 * data ticks while a visibility or gesture event overrides with a single
 * symmetric duration. Both fields fall back to `event.duration` when
 * omitted.
 */
export interface YEmitTarget {
  target: YRange;
  expandMs?: Milliseconds;
  contractMs?: Milliseconds;
}

/**
 * Pre-computed targets supplied by the chart when emitting a streaming
 * (data_tick) update. `xTarget === null` skips the X claim — chart-side
 * helpers (`viewport.computeStreamingTargetX`) return null while warm-up
 * hold is active or when the visible window already covers the new data.
 *
 * `startWall` (every emit shape) pins the event's wall-clock anchor. The
 * chart captures `performance.now()` once and passes the same value to the
 * matching `engine.tick(now)` so a zero-duration event isn't pruned by
 * microsecond drift between emit and tick before the slot processor sees
 * it. Omit to let the engine fall back to its idle-sentinel / last-tick
 * logic.
 */
export interface DataTickEmit {
  duration: Milliseconds;
  xTarget: VisibleRange | null;
  yTarget: YEmitTarget | null;
  startWall?: number;
  /**
   * Minimum X movement (`to` delta) that justifies an X emit. High-frequency
   * streams produce many sub-pixel ticks; below this threshold the bridge
   * keeps the running X animation untouched so the easing curve doesn't
   * restart on every frame.
   */
  xThreshold?: number;
}

export interface VisibilityEmit {
  duration: Milliseconds;
  yTarget: YEmitTarget | null;
  startWall?: number;
}

export interface GestureEmit {
  duration: Milliseconds;
  xTarget?: VisibleRange;
  yTarget?: YEmitTarget;
  startWall?: number;
}

export interface InstantEmit {
  xTarget?: VisibleRange;
  yTarget?: YEmitTarget;
  startWall?: number;
}

/**
 * Pure adapter between chart-side event sources (streaming, visibility
 * toggles, gestures, programmatic snaps) and the {@link AnimationEngine}.
 * Owns one piece of cross-emit state — `lastXTarget`, the most recent
 * *logical* X target. The autoscroll controller reads it (not the visual
 * `state.xRange`) to decide when to re-engage tail-following after a pan.
 */
export class AnimationBridge {
  /**
   * Most recent logical X target observed. Updated synchronously on every
   * emit *before* `engine.emit` so reentrancy-safe handlers (e.g. an
   * autoscroll re-engagement check fired inside the same RAF as the emit)
   * see the up-to-date value.
   */
  lastXTarget: VisibleRange | null = null;

  readonly #engine: AnimationEngine;

  constructor(opts: { engine: AnimationEngine }) {
    this.#engine = opts.engine;
  }

  /**
   * Streaming append / updateLast. May claim Y and X in lockstep — chart-
   * side helpers can omit either by passing `null`. Sub-threshold X deltas
   * are filtered before the engine sees them so the easing curve doesn't
   * restart on micro-shifts.
   */
  emitDataTick(opts: DataTickEmit): void {
    const xTarget = this.#applyXFilter(opts.xTarget, opts.xThreshold);
    if (xTarget !== null) {
      this.lastXTarget = xTarget;
    }

    if (xTarget === null && opts.yTarget === null) {
      return;
    }

    this.#engine.emit({
      kind: 'data_tick',
      duration: opts.duration,
      startWall: opts.startWall,
      targets: {
        x: xTarget !== null ? { target: xTarget } : undefined,
        y: opts.yTarget !== null ? opts.yTarget : undefined,
      },
    });
  }

  /**
   * Series visibility toggle — Y reflow only. Series-side alpha cross-fade
   * lives on the renderer (`BaseSeries.setAlpha`); axis tick fade lives on
   * `AxisTickTracker`. This emit preempts the streaming Y retarget at a
   * higher priority kind.
   */
  emitVisibility(opts: VisibilityEmit): void {
    this.#engine.emit({
      kind: 'visibility',
      duration: opts.duration,
      startWall: opts.startWall,
      targets: {
        y: opts.yTarget !== null ? opts.yTarget : undefined,
      },
    });
  }

  /** Wheel / pan / pinch — highest-priority slot claim short of `instant`. */
  emitGesture(opts: GestureEmit): void {
    if (opts.xTarget !== undefined) {
      this.lastXTarget = opts.xTarget;
    }

    this.#engine.emit({
      kind: 'gesture',
      duration: opts.duration,
      startWall: opts.startWall,
      targets: {
        x: opts.xTarget !== undefined ? { target: opts.xTarget } : undefined,
        y: opts.yTarget !== undefined ? opts.yTarget : undefined,
      },
    });
  }

  /**
   * Zero-duration claim. Used for first paint, bulk-replace, programmatic
   * snap (`setSeriesData({snap: true})`). Engine routes it through the
   * zero-duration guard so the slot lands at target on the first tick.
   */
  emitInstant(opts: InstantEmit): void {
    if (opts.xTarget !== undefined) {
      this.lastXTarget = opts.xTarget;
    }

    this.#engine.emit({
      kind: 'instant',
      duration: 0,
      startWall: opts.startWall,
      targets: {
        x: opts.xTarget !== undefined ? { target: opts.xTarget } : undefined,
        y: opts.yTarget !== undefined ? opts.yTarget : undefined,
      },
    });
  }

  #applyXFilter(target: VisibleRange | null, threshold: number | undefined): VisibleRange | null {
    if (target === null) return null;
    if (threshold === undefined || threshold <= 0) return target;
    if (this.lastXTarget === null) return target;

    const delta = Math.abs(target.to - this.lastXTarget.to);

    return delta >= threshold ? target : null;
  }
}
