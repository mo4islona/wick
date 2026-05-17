import { computePan, computeZoom } from './chart/pan-zoom-math';
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
   * X/Y event into the engine so it takes the new logical target as its
   * slot claim and eases the visual over `x.gestureMs` / `y.gestureMs`.
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
   * Callback used by pan/zoom soft-bound math + `setRange` autoscroll check.
   * Chart owns the data anchors (`#dataStart` / `#dataEnd`) and exposes
   * them through this lambda — viewport reads on demand.
   */
  getDataAnchors?: () => { dataStart: number | null; dataEnd: number | null };
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

const NULL_DATA_ANCHORS = { dataStart: null, dataEnd: null } as const;

/**
 * Manages the visible time range and Y range of the chart.
 *
 * Owns:
 *  - {@link logicalRange}: the chart's intent ("where X should be"). Pan /
 *    zoom / `setRange` commit here. The engine treats this as its X target.
 *  - {@link visualRange}: a cache of the engine's eased X, written by the
 *    chart each `renderMain` via {@link setVisualRange}. Read by render
 *    code, scales, and `chart.getVisibleRange()` so external consumers see
 *    the animated current.
 *  - `_autoScroll`, `_yRange`, `padding`, `dataInterval`.
 *
 * Does **not** own: data anchors (`dataStart` / `dataEnd` / `prevDataEnd`),
 * the warm-up `holdUntilFilled` flag, or the `maxVisibleBars` cap — those
 * live on the chart and are injected here via `getDataAnchors` when pan /
 * zoom math needs them.
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
  /** Cached chart width — kept across calls that don't pass one (e.g. on `interact`). */
  private _lastChartWidth = 0;
  readonly #getDataAnchors: () => { dataStart: number | null; dataEnd: number | null };

  constructor({ padding, getDataAnchors }: ViewportOptions = {}) {
    super();
    this.padding = {
      top: padding?.top ?? DEFAULT_PADDING.top,
      bottom: padding?.bottom ?? DEFAULT_PADDING.bottom,
      right: padding?.right ?? DEFAULT_PADDING.right,
      left: padding?.left ?? DEFAULT_PADDING.left,
    };
    this.#getDataAnchors = getDataAnchors ?? (() => NULL_DATA_ANCHORS);
  }

  /** Engine-eased X currently rendered. Equals {@link logicalRange} once the
   *  engine's X slot has settled. Read by render code, scales, snapshot tests
   *  — anything that asks "what's on screen?". Written by the chart each
   *  `renderMain` from `state.xRange`. */
  get visualRange(): VisibleRange {
    return this.#visual;
  }

  /** Latest committed target position. Pan rubber-band, zoom resistance,
   *  soft-bound clamping, autoscroll re-engagement all read this. Mid-tween
   *  visual would break those decisions. */
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
   * Commit a new logical range without emitting `change`. Used by the
   * chart's streaming-target flow where the engine drives the visual
   * animation and we don't want the `change` event to wake the render
   * loop a second time (engine.onWake already did).
   */
  commitLogicalSilent(range: VisibleRange): void {
    this.#logical = { from: range.from, to: range.to };
    this.#visual = { from: range.from, to: range.to };
  }

  /** Force `autoScroll` on. Used by the chart's streaming flow when the
   *  data tail re-enters the window. */
  forceAutoScrollOn(): void {
    this._autoScroll = true;
  }

  /**
   * Validate-and-snap the logical range. Used by pan, zoom, setRange.
   * Snaps `#visual` to match so standalone consumers — viewport unit tests,
   * hosts that don't wire the engine — observe the committed range
   * immediately.
   *
   * Chart-driven flows then override `#visual` each frame via
   * {@link setVisualRange} from `engine.state.xRange`.
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

    const { dataEnd } = this.#getDataAnchors();
    const lastVisible = dataEnd !== null && dataEnd >= from && dataEnd <= to;
    this._autoScroll = lastVisible;
    this.applyLogical(from, to);
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
   *   programmatic re-engagement. A wheel zoom while auto-scroll is active
   *   must keep it active.
   *
   * Always snaps logical. The chart's `interact` handler emits a `gesture`
   * X event into the engine for the visual ease.
   */
  zoomAt(centerTime: number, factor: number, chartWidth = this._lastChartWidth): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const { dataStart, dataEnd } = this.#getDataAnchors();
    const result = computeZoom({
      currentLogical: this.#logical,
      centerTime,
      factor,
      chartWidth,
      dataInterval: this.dataInterval,
      padding: { left: this.padding.left, right: this.padding.right },
      dataStart,
      dataEnd,
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

    const { dataStart, dataEnd } = this.#getDataAnchors();
    const result = computePan({
      currentLogical: this.#logical,
      timeDelta,
      chartWidth,
      dataInterval: this.dataInterval,
      padding: { left: this.padding.left, right: this.padding.right },
      dataStart,
      dataEnd,
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
   * Decide whether tail-following should re-engage after a pan. Called from
   * the chart's RAF loop with the logical X target (the engine's
   * `lastXTarget`) rather than the eased visual so the flip happens when
   * the *destination* crosses `dataEnd`, not one or two frames earlier
   * when the visual dipped past.
   */
  checkAutoScrollReengagement(dataEnd: number, logicalTarget: VisibleRange): void {
    if (this._autoScroll) return;
    if (logicalTarget.from <= dataEnd && dataEnd <= logicalTarget.to) {
      this._autoScroll = true;
    }
  }

  destroy(): void {
    this.removeAllListeners();
  }
}
