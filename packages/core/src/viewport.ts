import { computeFitToData } from './chart/fit-to-data';
import { DEFAULT_MAX_VISIBLE_BARS, MIN_VISIBLE_BARS, computePan, computeZoom } from './chart/pan-zoom-math';
import { computeStreamingTarget } from './chart/streaming-target';
import { EventEmitter } from './events';
import type { VisibleRange, YRange } from './types';

interface ViewportEvents {
  /**
   * Fired on any commit to {@link Viewport.logicalRange} or any chart-driven
   * write to {@link Viewport.visualRange}. Subscribers (scales, the chart's
   * render-loop wake-up) use it as a "something changed, repaint" signal.
   */
  change: () => void;
  /**
   * Fired on user-initiated pan / zoom. Chart subscribes to emit a `gesture`
   * X/Y event into the {@link AnimationEngine} so the engine takes the new
   * logical target as its slot claim and eases the visual over `x.gestureMs`
   * / `y.gestureMs`.
   */
  interact: () => void;
  /**
   * Fired when a pan / zoom commits a logical range past a soft data
   * boundary by more than 10% of the visible range. Hosts use this to kick
   * off history fetches (`onEdgeReached`).
   */
  edgeReached: (info: { side: 'left' | 'right'; overshoot: number; boundaryTime: number }) => void;
}

/** Horizontal padding expressed as a fixed pixel offset or a number of data intervals. */
export type HorizontalPadding = number | { intervals: number };

/** Configuration options for the {@link Viewport}. */
export interface ViewportOptions {
  padding?: {
    /** Top padding in pixels. Default: 20 */
    top?: number;
    /** Bottom padding in pixels. Default: 20 */
    bottom?: number;
    /**
     * Right-side padding. Accepts pixels (`50`) or data intervals (`{ intervals: 3 }`).
     * Default: `{ intervals: 3 }` — 3 empty data points to the right of the last point.
     */
    right?: HorizontalPadding;
    /**
     * Left-side padding. Accepts pixels (`50`) or data intervals (`{ intervals: 0 }`).
     * Default: `{ intervals: 0 }`.
     */
    left?: HorizontalPadding;
  };
  /**
   * Maximum number of data bars (candles/points) the viewport will fit before
   * it stops growing and switches to tail-scroll. Default: 200. Values below
   * 2 are clamped to 2.
   */
  maxVisibleBars?: number;
}

interface ResolvedPadding {
  top: number;
  bottom: number;
  right: HorizontalPadding;
  left: HorizontalPadding;
}

const DEFAULT_PADDING: ResolvedPadding = {
  top: 20,
  bottom: 20,
  right: { intervals: 3 },
  left: { intervals: 0 },
};

/**
 * Manages the visible time range and Y range of the chart.
 *
 * Post Phase-2 step 2: the X animator has moved into {@link AnimationEngine}.
 * The viewport owns:
 *  - {@link logicalRange}: the chart's intent ("where X should be"). Pan,
 *    zoom, `setRange`, `fitToData` commit here. The engine treats this as
 *    its X slot's target on every `data_tick` / `gesture` / `instant` emit.
 *  - {@link visualRange}: a cache of the engine's eased X (`state.xRange`),
 *    written by the chart each `renderMain`. Read by render code, scale
 *    projections, and `chart.getVisibleRange()` so external consumers
 *    observe the animated current — same contract as before the engine
 *    migration.
 *
 * Pan / zoom math reads {@link logicalRange} so a mid-tween visual never
 * skews gesture computations. `edgeReached` fires when the committed
 * logical pushes past a soft data boundary by more than 10% of the visible
 * range — hosts hook this to fetch history.
 */
export class Viewport extends EventEmitter<ViewportEvents> {
  #logical: VisibleRange = { from: 0, to: 0 };
  #visual: VisibleRange = { from: 0, to: 0 };
  private _yRange: YRange = { min: 0, max: 0 };
  private _autoScroll = true;
  private padding: ResolvedPadding;
  private dataInterval = 60_000;
  #dataStart: number | null = null;
  #dataEnd: number | null = null;
  /**
   * The previous value of `#dataEnd`. {@link computeStreamingTargetX} uses
   * it to preserve any pan offset across streaming ticks (so a user who
   * panned a few bars left of the tail keeps that offset as new bars
   * arrive, instead of being snapped back to the natural-pin position
   * every frame).
   */
  private _prevDataEnd: number | null = null;
  /** Cached chart width — kept across calls that don't pass one (e.g. on `interact`). */
  private _lastChartWidth = 0;
  /** Maximum bars before fitToData caps and tail-scroll takes over. */
  #maxVisibleBars = DEFAULT_MAX_VISIBLE_BARS;
  /**
   * Set by {@link setRangeHold} to suppress streaming pan while the right-
   * side gap fills up. Cleared by any user interaction or once
   * {@link computeStreamingTargetX} sees data catch the right edge.
   */
  #holdUntilFilled = false;

  constructor({ padding, maxVisibleBars }: ViewportOptions = {}) {
    super();
    this.padding = {
      top: padding?.top ?? DEFAULT_PADDING.top,
      bottom: padding?.bottom ?? DEFAULT_PADDING.bottom,
      right: padding?.right ?? DEFAULT_PADDING.right,
      left: padding?.left ?? DEFAULT_PADDING.left,
    };
    if (maxVisibleBars !== undefined) {
      this.#maxVisibleBars = Number.isFinite(maxVisibleBars)
        ? Math.max(MIN_VISIBLE_BARS, Math.floor(maxVisibleBars))
        : DEFAULT_MAX_VISIBLE_BARS;
    }
  }

  /** Engine-eased X currently rendered. Equals {@link logicalRange} once the
   *  engine's X slot has settled. Read by render code, scales, snapshot tests
   *  — anything that asks "what's on screen?". Written by the chart each
   *  `renderMain` from `state.xRange`. */
  get visualRange(): VisibleRange {
    return this.#visual;
  }

  /** Latest committed target position. Pan rubber-band, zoom resistance,
   *  soft-bound clamping, autoscroll re-engagement, and `edgeReached`
   *  classification all read this. Mid-tween visual would break those
   *  decisions. */
  get logicalRange(): VisibleRange {
    return this.#logical;
  }

  /** Public alias for {@link visualRange}. Kept for backward compatibility. */
  get visibleRange(): VisibleRange {
    return this.#visual;
  }

  get yRange(): YRange {
    return this._yRange;
  }

  get autoScroll(): boolean {
    return this._autoScroll;
  }

  /** First data timestamp registered via {@link setDataStart}, or `null` before any data has arrived. */
  get dataStart(): number | null {
    return this.#dataStart;
  }

  /** Last data timestamp registered via {@link setDataEnd}, or `null` before any data has arrived. */
  get dataEnd(): number | null {
    return this.#dataEnd;
  }

  setDataInterval(interval: number): void {
    this.dataInterval = interval;
  }

  /** Replace padding configuration. Only updates fields that are provided; others keep defaults. */
  setPadding(padding?: ViewportOptions['padding']): void {
    this.padding = {
      top: padding?.top ?? DEFAULT_PADDING.top,
      bottom: padding?.bottom ?? DEFAULT_PADDING.bottom,
      right: padding?.right ?? DEFAULT_PADDING.right,
      left: padding?.left ?? DEFAULT_PADDING.left,
    };
  }

  /** Read the currently-resolved padding — `ChartInstance.setPadding` uses
   *  it to decide whether a horizontal-padding change requires a refit. */
  getPadding(): Readonly<ResolvedPadding> {
    return this.padding;
  }

  setDataStart(time: number): void {
    this.#dataStart = time;
  }

  setDataEnd(time: number): void {
    this._prevDataEnd = this.#dataEnd;
    this.#dataEnd = time;
  }

  /**
   * Chart-side writer: push the engine's eased X into the visual cache so
   * external consumers (`chart.getVisibleRange()`, axis label positioning,
   * snapshot tests) read the animated current rather than the static
   * target.
   *
   * Does NOT emit `change` — the chart calls this inside `renderMain` after
   * `engine.tick(now)` and a separate frame-level emit covers the repaint /
   * `viewportChange` signal.
   */
  setVisualRange(range: VisibleRange): void {
    this.#visual = { from: range.from, to: range.to };
  }

  /**
   * Validate-and-snap the logical range. Used by every committing call site
   * (pan, zoom, setRange, fitToData). Snaps `#visual` to match so
   * standalone consumers — viewport unit tests, hosts that don't wire the
   * {@link AnimationEngine} — observe the committed range immediately.
   *
   * Chart-driven flows then override `#visual` each frame via
   * {@link setVisualRange} from `engine.state.xRange`: for `instant`
   * emits the engine snaps to the same target so the value is identical;
   * for eased `data_tick` / `gesture` emits the engine pushes mid-tween
   * values, intentionally walking the visual from the prior position
   * back toward the snapped target.
   *
   * Silently no-ops on invalid input (`to <= from`, fewer than 2 bars) so
   * callers can lob in a range before the data interval stabilises.
   */
  private applyLogical(from: number, to: number): void {
    if (to <= from) return;
    const range = to - from;
    if (range / this.dataInterval < 2) return;

    this.#logical = { from, to };
    this.#visual = { from, to };
    this.emit('change');
  }

  /**
   * Imperatively set the visible time range (`ChartInstance.setVisibleRange`).
   * Snaps logical immediately. Auto-scroll policy mirrors pan: if the
   * incoming range still contains the last data point, streaming ticks keep
   * tracking the tail; otherwise the user opted out of auto-scroll.
   *
   * Idempotent on no-op input. Silently no-ops on invalid input.
   */
  setRange(range: VisibleRange): void {
    const { from, to } = range;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (to <= from) return;
    if ((to - from) / this.dataInterval < 2) return;

    const current = this.#logical;
    if (current.from === from && current.to === to) return;

    const lastVisible = this.#dataEnd !== null && this.#dataEnd >= from && this.#dataEnd <= to;
    this._autoScroll = lastVisible;
    // setRange is what multi-chart sync and the navigator commit — never
    // inherits a leftover warm-up hold from an earlier setRangeHold call.
    this.#holdUntilFilled = false;
    this.applyLogical(from, to);
  }

  /**
   * Like {@link setRange}, but arms a "hold until filled" flag so streaming
   * `appendData` ticks no-op while there's still empty space between the
   * latest data and the right edge. Once the gap closes (or any user
   * gesture fires), the hold is released and normal pan-tracking resumes.
   * Used by `setVisibleRange({ from, bars })` for streaming warm-up windows.
   */
  setRangeHold(range: VisibleRange): void {
    this.setRange(range);
    // setRange cleared the flag; arm it now.
    this.#holdUntilFilled = true;
  }

  /** Set the Y-axis range. Adds pixel-based padding unless a side has an explicit (fixed) bound. */
  setYRange(min: number, max: number, chartHeight: number, fixedMin = false, fixedMax = false): void {
    const dataRange = max - min;
    const padTop = chartHeight > 0 ? (this.padding.top / chartHeight) * dataRange : 0;
    const padBottom = chartHeight > 0 ? (this.padding.bottom / chartHeight) * dataRange : 0;
    this._yRange = {
      min: fixedMin ? min : min - padBottom,
      max: fixedMax ? max : max + padTop,
    };
  }

  /**
   * Zoom in/out around a time anchor. `factor < 1` zooms in, `> 1` zooms out.
   *
   * - Zoom-in pins the right edge (never drifts left). Below the 10-bar floor
   *   a rubber-band lets the gesture push past with progressive damping.
   * - Zoom-out is hard-capped at the padded data span; past that there's no
   *   more zoom-out — panning already covers off-screen bars. The new window
   *   is clamped so it never reveals an empty gap past the data edges.
   * - Zoom does NOT toggle `_autoScroll`. That flag is reserved for pan /
   *   programmatic re-engagement (chart's `AutoscrollController.tick`).
   *   A wheel zoom while auto-scroll is active must keep it active.
   *
   * Always snaps logical. The chart's `interact` handler emits a
   * `gesture` X event into the engine for the visual ease.
   */
  zoomAt(centerTime: number, factor: number, chartWidth = this._lastChartWidth): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    // User input cancels a programmatic warm-up hold.
    this.#holdUntilFilled = false;

    const result = computeZoom({
      currentLogical: this.#logical,
      centerTime,
      factor,
      chartWidth,
      dataInterval: this.dataInterval,
      padding: { left: this.padding.left, right: this.padding.right },
      dataStart: this.#dataStart,
      dataEnd: this.#dataEnd,
    });
    if (result.newLogical === null) return;

    this.applyLogical(result.newLogical.from, result.newLogical.to);
    this.emit('interact');
  }

  /**
   * Shift the visible range by a time delta. Overshooting either data edge
   * applies rubber-band resistance.
   */
  pan(timeDelta: number, chartWidth = 0): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    this.#holdUntilFilled = false;

    const result = computePan({
      currentLogical: this.#logical,
      timeDelta,
      chartWidth,
      dataInterval: this.dataInterval,
      padding: { left: this.padding.left, right: this.padding.right },
      dataStart: this.#dataStart,
      dataEnd: this.#dataEnd,
    });
    if (result.newLogical === null) return;

    this._autoScroll = !result.autoScrollOff;
    this.applyLogical(result.newLogical.from, result.newLogical.to);

    if (result.edgeReached !== null) {
      this.emit('edgeReached', result.edgeReached);
    }
    this.emit('interact');
  }

  /**
   * Fit the viewport to show data from first to last timestamp.
   * The visible range equals the data span with paddings, capped at
   * `maxVisibleBars * dataInterval` — when the data overflows the cap, the
   * range anchors right (latest data pinned to the right edge).
   *
   * Always snaps logical. The animated/non-animated split is now chart-
   * level: the chart emits `instant` or `data_tick` X via the bridge based
   * on the call context.
   */
  fitToData(firstTime: number, lastTime: number, opts: { chartWidth?: number } = {}): void {
    const { chartWidth = 0 } = opts;

    this._autoScroll = true;
    this.#holdUntilFilled = false;
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const { from, to } = computeFitToData({
      firstTime,
      lastTime,
      dataInterval: this.dataInterval,
      maxVisibleBars: this.#maxVisibleBars,
      chartWidth,
      padding: { left: this.padding.left, right: this.padding.right },
    });

    this.applyLogical(from, to);
  }

  /**
   * Compute the next streaming X target after a `setDataEnd(last)` advance
   * and commit it as the new logical range. Returns the target as a
   * `VisibleRange` for the chart to feed to
   * `bridge.emitDataTick({ xTarget })`. Returns `null` when:
   *
   *  - `#holdUntilFilled` is active and the new data still fits inside the
   *    current logical window (warm-up hold), or
   *  - the X shift is below the sub-threshold filter (high-frequency
   *    `updateLast` bursts shouldn't restart the easing curve on every
   *    frame).
   *
   * Preserves any pan offset across ticks: the gap between the current
   * logical right edge and `_prevDataEnd` carries forward, so the
   * viewport slides by the data's advance distance instead of snapping
   * back to the natural-pin position every tick.
   *
   * Side effects when a non-null target is returned:
   *   1. Commits the target as the new `#logical` (gesture math, autoscroll
   *      checks and the next call's offset all read this).
   *   2. Advances `_prevDataEnd` so the *next* call's offset math measures
   *      against the just-committed dataEnd.
   *
   * The visual remains where the engine has it — chart-side
   * `bridge.emitDataTick({ xTarget })` + the engine's eased X slot drive
   * the slide of `visibleRange` toward the new logical over the cadence-
   * smoothed duration.
   */
  computeStreamingTargetX(lastTime: number, chartWidth = 0): VisibleRange | null {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const result = computeStreamingTarget({
      currentLogical: this.#logical,
      lastTime,
      prevDataEnd: this._prevDataEnd,
      dataInterval: this.dataInterval,
      paddingRight: this.padding.right,
      chartWidth,
      holdUntilFilled: this.#holdUntilFilled,
    });

    if (result.releaseHold) this.#holdUntilFilled = false;
    if (result.reengageAutoScroll) this._autoScroll = true;
    if (result.newLogical === null) return null;

    this.#logical = result.newLogical;
    this._prevDataEnd = this.#dataEnd;

    return { from: result.newLogical.from, to: result.newLogical.to };
  }

  /**
   * Decide whether tail-following should re-engage after a pan. Called from
   * the chart's RAF loop via {@link AutoscrollController}. Reads the logical
   * target (the chart passes `bridge.lastXTarget`) rather than the eased
   * visual so the flip happens when the *destination* crosses `dataEnd`,
   * not one or two frames earlier when the visual dipped past.
   */
  checkAutoScrollReengagement(dataEnd: number, logicalTarget: VisibleRange): void {
    if (this._autoScroll) return;
    if (logicalTarget.from <= dataEnd && dataEnd <= logicalTarget.to) {
      this._autoScroll = true;
    }
  }

  /** Return the number of data bars currently visible. */
  getVisibleBarsCount(): number {
    return (this.#visual.to - this.#visual.from) / this.dataInterval;
  }

  destroy(): void {
    this.removeAllListeners();
  }
}
