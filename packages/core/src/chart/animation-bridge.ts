import type {
  AnimationEngine,
  EntryTarget,
  LiveOHLCTarget,
  LiveScalarTarget,
  TickFadeTarget,
} from '../animation/engine';
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
  tickFade?: TickFadeTarget;
  /**
   * Live last-value retargets for line / bar series. Chart-side collector
   * walks every visible scalar series and packs `(seriesId, layerIdx,
   * latestValue)` triples so the engine eases the displayed last point in
   * lockstep with the X scroll / Y reflow that share this emit.
   */
  liveScalar?: readonly LiveScalarTarget[];
  /** Live OHLC retargets for candlestick series — symmetric to {@link liveScalar}. */
  liveOHLC?: readonly LiveOHLCTarget[];
  startWall?: number;
  /**
   * Minimum X movement (`to` delta) that justifies an X emit. High-frequency
   * streams produce many sub-pixel ticks; below this threshold the bridge
   * keeps the running X animation untouched so the easing curve doesn't
   * restart on every frame.
   */
  xThreshold?: number;
}

/**
 * Per-point entrance fade emit. Chart calls this on `appendData` with the
 * fresh point's `time`; engine claims an `entry` slot keyed
 * `${seriesId}:${layerIdx}:${time}` and ramps it 0 → 1 over `duration`.
 * Renderers read `state.entryProgress.get(seriesId)?.get(time)` to apply
 * per-point alpha / scale. Zero-duration emits are skipped — the chart
 * doesn't need to round-trip through the engine just to land at progress=1.
 */
export interface EntranceEmit {
  duration: Milliseconds;
  seriesId: string;
  layerIdx: number;
  time: number;
  startWall?: number;
}

export interface VisibilityEmit {
  duration: Milliseconds;
  seriesId: string;
  visible: boolean;
  yTarget: YEmitTarget | null;
  tickFade?: TickFadeTarget;
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
  /**
   * Snap-to-target live retargets. Used by chart for `smoothMs: 0` series
   * so the displayed last value lands on the new store value immediately
   * even while X scrolls smoothly via a parallel `data_tick`.
   */
  liveScalar?: readonly LiveScalarTarget[];
  liveOHLC?: readonly LiveOHLCTarget[];
  startWall?: number;
}

/**
 * Pure adapter between chart-side event sources (streaming, visibility
 * toggles, gestures, programmatic snaps) and the {@link AnimationEngine}.
 * Owns one piece of cross-emit state — `lastXTarget`, the most recent
 * *logical* X target. The autoscroll controller reads it (not the visual
 * `state.xRange`) to decide when to re-engage tail-following after a pan.
 *
 * Target *computation* lives in the chart (series data → Y, viewport →
 * streaming X, tick-tracker → entering/exiting tick values). The bridge
 * stays thin so its tests don't need to spin up a full ChartInstance.
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
   * Streaming append / updateLast. May claim Y, X and tickFade in lockstep
   * — chart-side helpers can omit any of them by passing `null` / `undefined`.
   * Sub-threshold X deltas are filtered before the engine sees them so the
   * easing curve doesn't restart on micro-shifts.
   */
  emitDataTick(opts: DataTickEmit): void {
    const xTarget = this.#applyXFilter(opts.xTarget, opts.xThreshold);
    if (xTarget !== null) {
      this.lastXTarget = xTarget;
    }

    const hasLiveScalar = opts.liveScalar !== undefined && opts.liveScalar.length > 0;
    const hasLiveOHLC = opts.liveOHLC !== undefined && opts.liveOHLC.length > 0;

    if (xTarget === null && opts.yTarget === null && opts.tickFade === undefined && !hasLiveScalar && !hasLiveOHLC) {
      return;
    }

    this.#engine.emit({
      kind: 'data_tick',
      duration: opts.duration,
      startWall: opts.startWall,
      targets: {
        x: xTarget !== null ? { target: xTarget } : undefined,
        y: opts.yTarget !== null ? opts.yTarget : undefined,
        tickFade: opts.tickFade,
        liveScalar: hasLiveScalar ? opts.liveScalar : undefined,
        liveOHLC: hasLiveOHLC ? opts.liveOHLC : undefined,
      },
    });
  }

  /**
   * Per-point entrance fade. Chart emits one per `appendData` call so the
   * engine's `entry` slot owns the timer instead of every renderer keeping
   * its own `Map<time, startTime>` and `performance.now()` read in the hot
   * path.
   *
   * Side effect — **live-slot identity snap.** The legacy renderer-local
   * live-track animator hard-snapped on a new candle/point (`isNewCandle`
   * check in `candlestick.ts:238`, `base-multi-layer.ts:249`) so the
   * displayed value didn't lerp across point identities. Reproduce that
   * here by dropping the `liveScalar` + `liveOHLC` slots for the same
   * `(seriesId, layerIdx)` before the entrance event lands; the next
   * `data_tick` recreates the slot with its target as the seed, which is
   * the new point's value — no cross-identity interpolation.
   *
   * Zero-duration emits still trigger the identity snap (entry slot just
   * lands at 1 immediately) so the chart never sees a one-frame "old
   * value" flash on `entryMs: 0` configs.
   */
  emitEntrance(opts: EntranceEmit): void {
    const liveK = `${opts.seriesId}:${opts.layerIdx}`;
    this.#engine.dropSlot('liveScalar', liveK);
    this.#engine.dropSlot('liveOHLC', liveK);

    if (opts.duration <= 0) return;

    const target: EntryTarget = {
      seriesId: opts.seriesId,
      layerIdx: opts.layerIdx,
      time: opts.time,
    };

    this.#engine.emit({
      kind: 'entrance',
      duration: opts.duration,
      startWall: opts.startWall,
      targets: { entry: [target] },
    });
  }

  /**
   * Series visibility toggle. Alpha cross-fade runs in lockstep with Y
   * reflow and any tick-fade entering / exiting that the visibility change
   * triggered (tick set differs because the Y range moved).
   */
  emitVisibility(opts: VisibilityEmit): void {
    this.#engine.emit({
      kind: 'visibility',
      duration: opts.duration,
      startWall: opts.startWall,
      targets: {
        alpha: [{ key: opts.seriesId, target: opts.visible ? 1 : 0 }],
        y: opts.yTarget !== null ? opts.yTarget : undefined,
        tickFade: opts.tickFade,
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

    const hasLiveScalar = opts.liveScalar !== undefined && opts.liveScalar.length > 0;
    const hasLiveOHLC = opts.liveOHLC !== undefined && opts.liveOHLC.length > 0;

    this.#engine.emit({
      kind: 'instant',
      duration: 0,
      startWall: opts.startWall,
      targets: {
        x: opts.xTarget !== undefined ? { target: opts.xTarget } : undefined,
        y: opts.yTarget !== undefined ? opts.yTarget : undefined,
        liveScalar: hasLiveScalar ? opts.liveScalar : undefined,
        liveOHLC: hasLiveOHLC ? opts.liveOHLC : undefined,
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
