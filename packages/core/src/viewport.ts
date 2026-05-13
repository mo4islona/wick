import { ANIM, Animator, type Easing, easeLinear, easeOutCubic } from './animation';
import { DEFAULT_REBOUND_MS } from './animation-constants';
import { EventEmitter } from './events';
import type { VisibleRange, YRange } from './types';
import { lerp } from './utils/math';

interface ViewportEvents {
  change: () => void;
  /**
   * Fired on user-initiated pan/zoom and on the post-gesture rebound that
   * corrects overshoot — rebound is treated as a continuation of the user's
   * gesture, not a programmatic animation. Not fired for programmatic
   * fit/scrollToEnd. Chart uses this to apply a shorter Y-range chase during
   * gestures so the axis doesn't trail through a 250 ms ease.
   */
  interact: () => void;
  /**
   * Fired when the user releases a pan/zoom gesture and rebound begins, if the
   * gesture ended with meaningful overshoot (> 10% of visible range). Payload
   * describes which edge was pulled past. Emitted at rebound start — not after
   * the animation completes — so hosts can kick off history fetches without
   * waiting for the visual snap-back.
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
   * Rebound (snap-back) animation duration in milliseconds. `0` disables the
   * ease-out so the viewport snaps back instantly.
   */
  reboundMs?: number;
  /**
   * Maximum number of data bars (candles/points) the viewport will fit before
   * it stops growing and switches to tail-scroll. While the data span is below
   * this threshold, streaming ticks expand the right edge to absorb new
   * points; once the span exceeds it, the visible window holds at this width
   * and slides forward as new data arrives. Default: 200. Values below 2 are
   * clamped to 2 (the minimum visible-bar count enforced elsewhere).
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

/** Minimum overshoot fraction of visible range before edgeReached fires on rebound. */
const EDGE_REACHED_MIN_FRACTION = 0.1;
/** Maximum overshoot as a fraction of the visible range during a pan gesture. */
const PAN_MAX_OVERSHOOT_FRACTION = 0.3;
/** Maximum zoom-in overshoot as a fraction of softMinRange. */
const ZOOM_MIN_OVERSHOOT_FRACTION = 0.4;
/** Minimum pending shift (expressed via dataInterval) before scrollToEnd animates. */
const AUTOSCROLL_MIN_DELTA_BARS = 0.5;
/** Minimum pending shift in pixels (whichever is smaller vs bars-based). */
const AUTOSCROLL_MIN_DELTA_PX = 4;
/** Cap for the adaptive scroll-to-end duration. Long-interval data (daily
 * candles, etc.) would otherwise stretch the ease across hours; we never need
 * the scroll to outlast a few seconds of motion to hide the per-tick step. */
const SCROLL_TO_END_MAX_MS = 5_000;

/** Inter-arrival above this is treated as "the stream paused, this tick
 * effectively starts a new stream" — `streamingDuration` resets to
 * `ANIM.streamTick` instead of producing a multi-second slide. */
const STREAM_IDLE_RESET_MS = 2_000;

/** Default maximum visible bars before fitToData caps the window and tail-scroll takes over. */
const DEFAULT_MAX_VISIBLE_BARS = 200;
/** Minimum allowed `maxVisibleBars` — matches the visible-bar floor enforced
 * by `applyLogical` / `setRange`, below which the viewport refuses to render. */
const MIN_VISIBLE_BARS = 2;

/** Lerp two `VisibleRange` values for the range animator. */
const rangeLerp = (a: VisibleRange, b: VisibleRange, t: number): VisibleRange => ({
  from: lerp(a.from, b.from, t),
  to: lerp(a.to, b.to, t),
});

/** Structural equality for the range animator's no-op short-circuits. */
const rangeEquals = (a: VisibleRange, b: VisibleRange): boolean => a.from === b.from && a.to === b.to;

/**
 * Manages the visible time range and Y range of the chart.
 *
 * The visible range goes through {@link Animator}: every transition (programmatic
 * scroll, fit, rebound) hands a target to the animator, which interpolates over
 * frames. Pan/zoom user input still applies *instantly* on the logical state —
 * input animation is layered on later (see {@link logicalRange} below).
 *
 * Logical vs visual state. {@link visualRange} (= `animator.current`) is what
 * is drawn this frame; {@link logicalRange} (= `animator.target`) is the
 * latest committed position used by gesture math, soft-bound checks, autoscroll
 * decisions, and `edgeReached` classification. Reading the animated mid-tween
 * `visualRange` for those decisions would break rubber-band physics. The
 * existing public {@link visibleRange} alias resolves to visual so external
 * consumers and snapshot tests behave as before.
 *
 * Viewport boundaries are "soft": pan and zoom may push past them with
 * progressive rubber-band resistance. When the gesture ends, {@link startRebound}
 * animates the range back into valid bounds and fires `edgeReached` for the
 * side that was pulled past — chart hosts use that signal to fetch more data.
 */
export class Viewport extends EventEmitter<ViewportEvents> {
  readonly #rangeAnimator: Animator<VisibleRange>;
  private _yRange: YRange = { min: 0, max: 0 };
  private _autoScroll = true;
  private padding: ResolvedPadding;
  private reboundMs: number;
  private dataInterval = 60_000;
  #dataStart: number | null = null;
  #dataEnd: number | null = null;
  /**
   * The value of `#dataEnd` *before* the most recent `setDataEnd` call.
   * `scrollToEnd` uses this to slide the viewport by the data's advance
   * distance — preserving any pan offset the user established instead of
   * snapping the right edge back to the natural-pin position on every tick.
   */
  private _prevDataEnd: number | null = null;

  /** Cached chart width — needed for rebound pixel-padding resolution
   * when startRebound is called from an event handler that doesn't pass width. */
  private _lastChartWidth = 0;

  /** Wall-clock timestamp of the previous {@link scrollToEnd} call. Used to
   * size the next scroll's duration to the measured inter-arrival interval —
   * with the animator's mid-flight retargeting, that keeps the viewport
   * continuously sliding between ticks instead of settling at a fixed 250 ms
   * and sitting idle until the next point. */
  #lastScrollWall = 0;

  /** Wall-clock timestamp of the previous {@link setDataEnd} call that
   * actually advanced `#dataEnd` (intra updates on the same time are
   * skipped). Lets {@link streamingDuration} size the first pan from the
   * data-arrival cadence (which is observable before any `scrollToEnd`
   * has run — typically the history load's setDataEnd happens earlier),
   * so the first scroll uses the real cadence instead of a fixed 250ms
   * fallback. */
  #lastDataEndWall = 0;

  /** Most recent inter-arrival between distinct `setDataEnd` calls, in
   * wall-clock ms. Updated lazily inside {@link setDataEnd}. */
  #lastDataEndInterval = 0;

  /** Threshold (in bar count) at which `fitToData` stops expanding the visible
   * range and tail-scroll takes over. Configurable via {@link ViewportOptions.maxVisibleBars}. */
  #maxVisibleBars = DEFAULT_MAX_VISIBLE_BARS;

  /**
   * Set by {@link setRangeHold} (the `setVisibleRange({ from, bars })` path)
   * to suppress streaming pan while the right-side gap fills up — viewport
   * stays put as new ticks render into the empty area. Cleared by any user
   * interaction (pan, zoom, rebound) or by `fitToData`/`setRange`, and by
   * `scrollToEnd` once the gap closes (data reaches the right edge).
   */
  #holdUntilFilled = false;

  constructor({ padding, reboundMs, maxVisibleBars }: ViewportOptions = {}) {
    super();
    this.padding = {
      top: padding?.top ?? DEFAULT_PADDING.top,
      bottom: padding?.bottom ?? DEFAULT_PADDING.bottom,
      right: padding?.right ?? DEFAULT_PADDING.right,
      left: padding?.left ?? DEFAULT_PADDING.left,
    };
    this.reboundMs = reboundMs ?? DEFAULT_REBOUND_MS;
    if (maxVisibleBars !== undefined) {
      this.#maxVisibleBars = Number.isFinite(maxVisibleBars)
        ? Math.max(MIN_VISIBLE_BARS, Math.floor(maxVisibleBars))
        : DEFAULT_MAX_VISIBLE_BARS;
    }

    this.#rangeAnimator = new Animator<VisibleRange>({
      initial: { from: 0, to: 0 },
      duration: ANIM.streamTick,
      easing: easeOutCubic,
      lerp: rangeLerp,
      equals: rangeEquals,
    });
  }

  /**
   * Update the rebound (snap-back) duration. `0` disables the ease-out so
   * the range snaps back instantly. Takes effect on the next rebound.
   */
  setReboundMs(reboundMs: number): void {
    this.reboundMs = Math.max(0, reboundMs);
  }

  /**
   * Resolve a HorizontalPadding value to a time offset.
   * - `{ intervals: N }` → N * dataInterval (zoom-independent bar count)
   * - `number` (pixels) → (px / chartWidth) * visibleRange (zoom-dependent)
   */
  private resolveHPad(pad: HorizontalPadding, range: number, chartWidth: number): number {
    if (typeof pad === 'object') {
      return pad.intervals * this.dataInterval;
    }
    if (chartWidth <= 0) return 0;

    return (pad / chartWidth) * range;
  }

  /** What is currently drawn this frame. Equals `logicalRange` when no animation
   * is in flight. Read by render code, scale projections, label placement,
   * snapshot tests — anything that asks "what's on screen?". */
  get visualRange(): VisibleRange {
    return this.#rangeAnimator.current;
  }

  /** Latest committed target position. Reads this for math: pan rubber-band,
   * zoom overshoot resistance, soft-bound clamping, autoscroll-on-tail-visible,
   * `edgeReached` payload. Mid-tween `visualRange` would break those decisions. */
  get logicalRange(): VisibleRange {
    return this.#rangeAnimator.target;
  }

  /** Public alias for {@link visualRange}. Kept for backward compatibility —
   * all existing consumers expect "what's visible right now", which is the
   * animated current value. */
  get visibleRange(): VisibleRange {
    return this.#rangeAnimator.current;
  }

  get yRange(): YRange {
    return this._yRange;
  }

  get autoScroll(): boolean {
    return this._autoScroll;
  }

  get animating(): boolean {
    return this.#rangeAnimator.animating;
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

  /** Read the currently-resolved padding — used by `ChartInstance.setPadding`
   * to decide whether a horizontal-padding change requires a viewport refit. */
  getPadding(): Readonly<ResolvedPadding> {
    return this.padding;
  }

  setDataStart(time: number): void {
    this.#dataStart = time;
  }

  setDataEnd(time: number): void {
    this._prevDataEnd = this.#dataEnd;
    this.#dataEnd = time;
    // Track wall-clock between distinct data-end advances so streaming
    // can size the first pan from the data-arrival cadence instead of
    // falling back to a 250ms default. Intra updates (same time) keep
    // the previous measurement intact.
    if (this._prevDataEnd === time) return;
    const wallNow = performance.now();
    if (this.#lastDataEndWall > 0) {
      this.#lastDataEndInterval = wallNow - this.#lastDataEndWall;
    }
    this.#lastDataEndWall = wallNow;
  }

  /**
   * Snap the animator's target to its own current value, halting any in-flight
   * animation at the visually-displayed position. Used by user-input handlers
   * (pan, zoom) so gesture math reads `logicalRange === visualRange` — the
   * user's reference frame is what they see, not the destination of a
   * programmatic animation they can't perceive yet.
   */
  private cancelPendingAnimation(): void {
    if (this.#rangeAnimator.animating) {
      this.#rangeAnimator.snap(this.#rangeAnimator.current);
      this.emit('change');
    }
  }

  /**
   * Validate-and-snap the animator. Used by direct-apply call sites (pan,
   * zoom, setRange, fit-without-animation). Cancels any in-flight animation
   * by definition (Animator.snap), so the caller doesn't need a separate
   * cancel step. Emits `change` once.
   *
   * Silently no-ops on invalid input (`to <= from`, fewer than 2 bars) so
   * callers can lob in a range before the data interval stabilises.
   */
  private applyLogical(from: number, to: number): void {
    if (to <= from) return;
    const range = to - from;
    if (range / this.dataInterval < 2) return;

    this.#rangeAnimator.snap({ from, to });
    this.emit('change');
  }

  /**
   * Validate-and-retarget the animator with a duration. Used by animated
   * call sites (scrollToEnd, fitToData(animated), startRebound, eased pan/
   * zoom).
   *
   * Emits `change` once on retarget so the host's render loop wakes up and
   * schedules the next frame — without it, no tick would run and the visual
   * would never advance toward the new target. Subsequent per-frame `change`
   * events fire from {@link tick} as `current` interpolates.
   */
  private retargetLogical(
    from: number,
    to: number,
    duration: number,
    opts: { now?: number; easing?: Easing } = {},
  ): void {
    if (to <= from) return;
    const range = to - from;
    if (range / this.dataInterval < 2) return;

    this.#rangeAnimator.setTarget({ from, to }, { duration, now: opts.now, easing: opts.easing });
    this.emit('change');
  }

  /** Called by the render loop before each frame. Returns true if still animating. */
  tick(now: number): boolean {
    if (!this.#rangeAnimator.animating) return false;

    const stillAnimating = this.#rangeAnimator.tick(now);
    this.emit('change');

    return stillAnimating;
  }

  /** Compute the left/right soft bound for the given pan-time range and chart width.
   * Returns null on the side whose data boundary is unset or whose padding resolution fails. */
  private getSoftBounds(range: number, chartWidth: number): { left: number | null; right: number | null } {
    // Pixel padding of 0 is trivially resolvable without a chart width — treat
    // it as a concrete soft bound flush against the data edge.
    const resolvable = (pad: HorizontalPadding) => typeof pad === 'object' || pad === 0 || chartWidth > 0;
    const left =
      this.#dataStart !== null && resolvable(this.padding.left)
        ? this.#dataStart - this.resolveHPad(this.padding.left, range, chartWidth)
        : null;
    const right =
      this.#dataEnd !== null && resolvable(this.padding.right)
        ? this.#dataEnd + this.resolveHPad(this.padding.right, range, chartWidth)
        : null;
    return { left, right };
  }

  /** Minimum visible range (zoom-in ceiling). Expressed as 10 bars. */
  private get softMinRange(): number {
    return 10 * this.dataInterval;
  }

  /** Maximum visible range (zoom-out floor). When interval-based horizontal padding is
   * configured, keep this ceiling aligned with the soft-pan bounds so rebound does not
   * clamp to a range wider than can fit inside them. Falls back to span + 5 intervals
   * when padding is purely pixel-based (where width depends on chartWidth, unavailable
   * here). Returns null when data bounds are unknown — no hard ceiling in that case. */
  private softMaxRange(): number | null {
    if (this.#dataStart === null || this.#dataEnd === null) return null;
    const span = this.#dataEnd - this.#dataStart;
    if (span <= 0) return null;

    const leftPad = typeof this.padding.left === 'object' ? this.padding.left.intervals * this.dataInterval : null;
    const rightPad = typeof this.padding.right === 'object' ? this.padding.right.intervals * this.dataInterval : null;

    if (leftPad !== null || rightPad !== null) {
      return span + (leftPad ?? 0) + (rightPad ?? 0);
    }
    return span + this.dataInterval * 5;
  }

  /**
   * Imperatively set the visible time range (public API — called by
   * `ChartInstance.setVisibleRange`).
   *
   * Snaps the animator: cancels any in-flight animation and applies the range
   * immediately. Auto-scroll policy mirrors pan: if the incoming range still
   * contains the last data point, streaming ticks keep tracking the tail;
   * otherwise the user is opting out of auto-scroll until they call `fitContent`
   * or scroll back to the tail.
   *
   * Silently no-ops on invalid input (non-finite bounds, to <= from, or
   * fewer than 2 bars visible) — mirrors `applyLogical`'s validation contract
   * so callers can lob in a range before the data interval stabilises.
   * Validation runs up-front so a rejected call never mutates auto-scroll
   * or cancels in-flight animations.
   *
   * Idempotent: if the requested range matches the current visible range,
   * returns without snapping the animator or emitting `change`. Lets two
   * mutually-syncing charts terminate naturally — without this, each
   * `setRange` echo retriggers `viewportChange` on the receiver, ping-ponging
   * forever.
   */
  setRange(range: VisibleRange): void {
    const { from, to } = range;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (to <= from) return;
    if ((to - from) / this.dataInterval < 2) return;

    const current = this.visibleRange;
    if (current.from === from && current.to === to) return;

    const lastVisible = this.#dataEnd !== null && this.#dataEnd >= from && this.#dataEnd <= to;
    this._autoScroll = lastVisible;
    // Plain setRange is what multi-chart sync and the navigator commit — it
    // should never inherit a leftover warm-up hold from an earlier
    // `setVisibleRange({ from, bars })`.
    this.#holdUntilFilled = false;
    this.applyLogical(from, to);
  }

  /**
   * Like {@link setRange}, but additionally arms a "hold until filled" flag
   * so streaming `appendData` ticks no-op while there's still empty space
   * between the latest data and the right edge of the viewport. Once the
   * gap closes (or any user gesture fires), the hold is released and
   * normal pan-tracking resumes. Used by `setVisibleRange({ from, bars })`
   * for streaming warm-up windows.
   */
  setRangeHold(range: VisibleRange): void {
    this.setRange(range);
    // setRange cleared the flag above; arm it now (after applyLogical so
    // visibleRange reflects the new bounds).
    this.#holdUntilFilled = true;
  }

  /** Set the Y-axis range. Adds pixel-based padding unless a side has a fixed (explicit) bound. */
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
   * Behaviour contract:
   * - Zoom-in pins the right edge of the visible range (never drifts left).
   *   Below the 10-bar floor a rubber-band resistance lets the gesture push
   *   past with progressive damping; on gesture release {@link startRebound}
   *   snaps back.
   * - Zoom-out is hard-capped at the padded data span (`softRight − softLeft`).
   *   Past that there's no more zoom-out — panning already covers navigating
   *   off-screen bars. The new window is also clamped so it never extends
   *   past the data edges — avoiding the "empty space then snap back" flash.
   * - Zoom does NOT toggle `_autoScroll`. That flag is reserved for pan
   *   (user moved away intentionally) and scrollToEnd/fitToData (chart
   *   resumes following). Zoom is a scale change, not a move — so a wheel
   *   zoom while auto-scroll is active must keep auto-scroll active.
   *
   * Reads {@link logicalRange} for math; commits via {@link applyLogical}
   * (snap) or {@link retargetLogical} (eased) depending on `durationMs`.
   * `durationMs > 0` enables input animation: logical state advances
   * synchronously so back-to-back wheel events keep computing against the
   * latest target, while the visual range eases through one shared animator.
   */
  zoomAt(centerTime: number, factor: number, chartWidth = this._lastChartWidth, durationMs = 0): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    // User input cancels a programmatic warm-up hold (the hold is for
    // initial setup only; once the user starts manipulating the view, the
    // chart resumes normal pan-tracking on streaming ticks).
    this.#holdUntilFilled = false;

    // User input takes over from any in-flight programmatic animation: commit
    // the current visual position as the new logical baseline so gesture math
    // operates on what the user sees, not on the destination of an animation
    // they can't perceive yet. Without this, zooming during an in-flight
    // fit or scrollToEnd ease produces a visible jump from mid-tween to
    // target before the zoom is applied.
    this.cancelPendingAnimation();

    const { from, to } = this.logicalRange;
    const range = to - from;
    if (range <= 0) return;

    const softMin = this.softMinRange;
    const { left: softLeft, right: softRight } = this.getSoftBounds(range, chartWidth);
    // Max usable zoom-out span: all data + both paddings visible. When either
    // soft bound is unresolved (chartWidth == 0 for pixel padding), fall back
    // to the legacy softMax which only accounts for data span.
    const hardMaxRange = softLeft !== null && softRight !== null ? softRight - softLeft : this.softMaxRange();

    let effFactor = factor;
    const minMaxOver = softMin * ZOOM_MIN_OVERSHOOT_FRACTION;

    // Zoom-in past the 10-bar floor: rubber-band resistance on the factor.
    if (factor < 1 && range < softMin) {
      const over = softMin - range;
      const ratio = Math.min(1, over / minMaxOver);
      // Resistance approaches 0 as ratio → 1. Squaring makes the edge feel firm.
      const resistance = (1 - ratio) ** 2;
      effFactor = 1 - (1 - factor) * resistance;
    }

    let newRange = range * effFactor;

    // Zoom-in asymptote: never shrink past softMin − maxOver.
    if (newRange < softMin - minMaxOver) newRange = softMin - minMaxOver;
    // Zoom-out hard cap: the padded data span. No rubber — wider than this
    // would just reveal empty canvas that startRebound would have to yank back.
    if (factor > 1 && hardMaxRange !== null && newRange > hardMaxRange) {
      newRange = hardMaxRange;
    }

    const ratioAnchor = (centerTime - from) / range;
    let newFrom = centerTime - ratioAnchor * newRange;
    let newTo = newFrom + newRange;

    // Zoom-in guardrail: never let the right edge drift left past its current
    // position. Keeps the last candle in view and prevents isLastPointVisible
    // from breaking live auto-scroll.
    if (factor < 1 && newTo < to) {
      const shift = to - newTo;
      newFrom += shift;
      newTo += shift;
    }

    // Zoom-out: clamp sides into soft bounds so the chart never reveals a gap
    // between the last candle and the right edge that rebound would have to
    // yank back. If the new range fills the entire padded span, sit flush
    // against both bounds (all data visible).
    if (factor > 1) {
      if (softRight !== null && newTo > softRight) {
        const shift = newTo - softRight;
        newFrom -= shift;
        newTo -= shift;
      }
      if (softLeft !== null && newFrom < softLeft) {
        const shift = softLeft - newFrom;
        newFrom += shift;
        newTo += shift;
      }
    }

    if (durationMs > 0) {
      this.retargetLogical(newFrom, newTo, durationMs);
    } else {
      this.applyLogical(newFrom, newTo);
    }
    this.emit('interact');
  }

  /**
   * Shift the visible range by a time delta. Overshooting either data edge
   * applies rubber-band resistance: the more the user pulls past, the smaller
   * each subsequent pixel of drag translates into actual range shift. Total
   * overshoot is capped at `PAN_MAX_OVERSHOOT_FRACTION` of the visible range.
   *
   * Reads {@link logicalRange} for math; commits via {@link applyLogical}
   * (snap) or {@link retargetLogical} (eased) depending on `durationMs`.
   */
  pan(timeDelta: number, chartWidth = 0, durationMs = 0): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    // Same takeover rules as zoomAt — clear warm-up hold and snap any
    // in-flight programmatic animation to its current visible position.
    this.#holdUntilFilled = false;
    this.cancelPendingAnimation();

    const { from, to } = this.logicalRange;
    const range = to - from;
    if (range <= 0) return;

    const { left: softLeft, right: softRight } = this.getSoftBounds(range, chartWidth);
    const maxOver = range * PAN_MAX_OVERSHOOT_FRACTION;

    let effDelta = timeDelta;

    // Dampen delta when we're already past a soft bound and moving further out.
    if (timeDelta > 0 && softRight !== null) {
      const overRight = Math.max(0, to - softRight);
      if (overRight > 0) {
        // Resistance approaches 0 as overshoot approaches maxOver.
        effDelta *= 1 / (overRight / maxOver + 1);
      }
    } else if (timeDelta < 0 && softLeft !== null) {
      const overLeft = Math.max(0, softLeft - from);
      if (overLeft > 0) {
        effDelta *= 1 / (overLeft / maxOver + 1);
      }
    }

    let newFrom = from + effDelta;
    let newTo = to + effDelta;

    // Hard-cap total overshoot so a single huge delta can't skip past the rubber band.
    if (softRight !== null && newTo > softRight + maxOver) {
      const excess = newTo - (softRight + maxOver);
      newFrom -= excess;
      newTo -= excess;
    }
    if (softLeft !== null && newFrom < softLeft - maxOver) {
      const excess = softLeft - maxOver - newFrom;
      newFrom += excess;
      newTo += excess;
    }

    // Auto-scroll policy: a pan that leaves the last data point on screen
    // is effectively "still live" — keep tracking so new ticks continue to
    // slide into view. A pan that pushes the last point off-screen is a
    // deliberate history inspection and opts out of tracking until the user
    // fits / scrolls back.
    const lastVisible = this.#dataEnd !== null && this.#dataEnd >= newFrom && this.#dataEnd <= newTo;
    this._autoScroll = lastVisible;
    if (durationMs > 0) {
      this.retargetLogical(newFrom, newTo, durationMs);
    } else {
      this.applyLogical(newFrom, newTo);
    }
    this.emit('interact');
  }

  /**
   * Animate the visible range back into soft bounds after a gesture ends.
   * No-op when already inside bounds. When the rebound corrects a meaningful
   * overshoot (> 10% of range) the side and overshoot magnitude are emitted
   * via `edgeReached` — hosts hook this to trigger history prefetch.
   *
   * Reads {@link logicalRange} for math; commits via {@link retargetLogical}
   * (or {@link applyLogical} when `reboundMs <= 0`).
   */
  startRebound(chartWidth = this._lastChartWidth): void {
    // Rebound runs after a user gesture — a warm-up hold is no longer
    // appropriate (the user has already touched the view).
    this.#holdUntilFilled = false;
    const { from, to } = this.logicalRange;
    const range = to - from;
    if (range <= 0) return;

    // Step 1 — clamp the range width into [softMin, softMax].
    const softMin = this.softMinRange;
    const softMax = this.softMaxRange();
    let targetRange = range;
    if (targetRange < softMin) targetRange = softMin;
    if (softMax !== null && targetRange > softMax) targetRange = softMax;

    let targetFrom = from;
    let targetTo = to;
    if (targetRange !== range) {
      // Preserve the anchor: if zoom overshot, re-center around the same midpoint.
      const mid = (from + to) / 2;
      targetFrom = mid - targetRange / 2;
      targetTo = mid + targetRange / 2;
    }

    // Step 2 — shift so neither edge sits outside soft bounds.
    const { left: softLeft, right: softRight } = this.getSoftBounds(targetRange, chartWidth);
    if (softRight !== null && targetTo > softRight) {
      const shift = targetTo - softRight;
      targetFrom -= shift;
      targetTo -= shift;
    }
    if (softLeft !== null && targetFrom < softLeft) {
      const shift = softLeft - targetFrom;
      targetFrom += shift;
      targetTo += shift;
    }

    const fromChange = Math.abs(targetFrom - from);
    const toChange = Math.abs(targetTo - to);
    // Treat sub-millisecond deltas as no-op — avoids spurious animations when
    // floating-point arithmetic leaves residual overshoot after a clean gesture.
    if (fromChange < 1 && toChange < 1) return;

    // Classify the gesture for edgeReached: which side was pulled past?
    const edgeThreshold = range * EDGE_REACHED_MIN_FRACTION;
    let edgeSide: 'left' | 'right' | null = null;
    let edgeOvershoot = 0;
    let edgeBoundaryTime = 0;
    if (softRight !== null && to - softRight > edgeThreshold) {
      edgeSide = 'right';
      edgeOvershoot = to - softRight;
      edgeBoundaryTime = softRight;
    } else if (softLeft !== null && softLeft - from > edgeThreshold) {
      edgeSide = 'left';
      edgeOvershoot = softLeft - from;
      edgeBoundaryTime = softLeft;
    }

    if (this.reboundMs <= 0) {
      this.applyLogical(targetFrom, targetTo);
    } else {
      this.retargetLogical(targetFrom, targetTo, this.reboundMs);
    }
    // Rebound shifts logicalRange — and therefore the Y target — after the
    // gesture-time interact flag has already been consumed. Emitting here
    // re-arms the short Y chase so the axis doesn't trail through a 250 ms
    // ease as X eases back into bounds.
    this.emit('interact');

    if (edgeSide !== null) {
      this.emit('edgeReached', {
        side: edgeSide,
        overshoot: edgeOvershoot,
        boundaryTime: edgeBoundaryTime,
      });
    }
  }

  /**
   * Fit the viewport to show data from first to last timestamp, with optional
   * animation. The animation is skipped when the viewport is uninitialised —
   * first load always snaps so the data appears at its natural extent.
   *
   * The visible range equals the data span with paddings, capped at
   * `maxVisibleBars * dataInterval` — when the data overflows the cap, the
   * range anchors right (latest data pinned to the right edge, older data
   * clipped off the left).
   *
   * Options:
   * - `chartWidth` — current chart pixel width; required for pixel-based padding resolution.
   * - `animated` — `true` retargets the animator; `false` (default) snaps.
   * - `durationMs` — override for the animated retarget; defaults to `ANIM.fit`.
   */
  fitToData(
    firstTime: number,
    lastTime: number,
    opts: { chartWidth?: number; animated?: boolean; durationMs?: number } = {},
  ): void {
    const { chartWidth = 0, animated = false, durationMs } = opts;

    this._autoScroll = true;
    // A fresh fit replaces any prior warm-up window the dev had armed.
    this.#holdUntilFilled = false;
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const maxRange = this.#maxVisibleBars * this.dataInterval;
    const dataSpan = lastTime - firstTime;

    // Pixel-based padding needs a representative range. For a single point
    // the span is 0; fall back to a few intervals so resolveHPad has
    // something workable.
    const estimatedRange = dataSpan > 0 ? dataSpan : this.dataInterval * 10;
    const pr = this.resolveHPad(this.padding.right, estimatedRange, chartWidth);
    const pl = this.resolveHPad(this.padding.left, estimatedRange, chartWidth);

    let targetTo = lastTime + pr;
    let targetFrom = firstTime - pl;

    if (targetTo - targetFrom > maxRange) {
      // Overflow — anchor right edge, trim left.
      targetTo = lastTime + pr;
      targetFrom = targetTo - maxRange;
    }

    const { from: curFrom, to: curTo } = this.logicalRange;
    const uninitialised = curFrom === 0 && curTo === 0;

    if (!animated || uninitialised) {
      this.applyLogical(targetFrom, targetTo);

      return;
    }

    this.retargetLogical(targetFrom, targetTo, durationMs ?? ANIM.fit);
  }

  /**
   * Compute the next streaming-retarget duration based on the wall-clock
   * inter-arrival interval since the previous streaming call. Returns a
   * value in `[ANIM.streamTick, SCROLL_TO_END_MAX_MS]` so the animator
   * keeps sliding through to the next tick instead of settling early.
   *
   * Updates `#lastScrollWall` as a side effect so the next `scrollToEnd`
   * call sees the elapsed time since this one — they're sequential ticks of
   * the same stream.
   */
  private streamingDuration(): number {
    const wallNow = performance.now();
    // Prefer the inter-arrival between `setDataEnd` calls — that includes
    // the gap between history load and the first stream tick, so the very
    // first pan can use the real cadence (typically ~1s in demos with
    // `speed: 5`) instead of a 250ms fallback that finishes before the
    // second tick arrives and produces a visible "quick first pan + idle"
    // discontinuity.
    let measured = this.#lastDataEndInterval;
    // If no data-end measurement yet, fall back to the inter-scroll one
    // (the older mechanism — kept so synthetic tests that drive
    // `scrollToEnd` without going through `setDataEnd` still work).
    if (measured <= 0) {
      measured = this.#lastScrollWall > 0 ? wallNow - this.#lastScrollWall : 0;
    }
    this.#lastScrollWall = wallNow;
    if (measured <= 0) return ANIM.streamTick;
    // Long idle gap — the stream effectively paused. Snap-back to the baseline
    // duration so the next tick eases over a normal frame, not over a 5-second
    // slide derived from the pause.
    if (measured > STREAM_IDLE_RESET_MS) return ANIM.streamTick;

    return Math.min(SCROLL_TO_END_MAX_MS, Math.max(ANIM.streamTick, measured));
  }

  /**
   * Keep the right edge pinned to the latest data (real-time auto-scroll).
   *
   * Streaming feeds can fire many ticks per second. The sub-threshold filter
   * below early-returns on tiny shifts so high-frequency ticks don't restart
   * the ease on every frame; the `_prevDataEnd`-based offset preservation
   * keeps a user pan stable across streaming ticks; both must survive the
   * migration verbatim. Only the underlying interpolation engine swapped to
   * {@link Animator} — call-site logic is unchanged.
   *
   * Reads {@link logicalRange} so the offset/threshold math operates on the
   * latest committed target, not the mid-tween animated `current`.
   */
  scrollToEnd(lastTime: number, chartWidth = 0): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;
    const { from: lFrom, to: lTo } = this.logicalRange;
    const range = lTo - lFrom;
    if (range <= 0) return;
    const pr = this.resolveHPad(this.padding.right, range, chartWidth);

    // Preserve the user's offset from the live tail across ticks.
    //
    // Base case (no prior `dataEnd` recorded): fall back to `lastTime + pr`,
    // matching the old pin behavior on the first scroll.
    //
    // Panned case (user scrolled while the tail was still visible, autoScroll
    // stayed true per task #12): the offset between the current right edge
    // (logical — animator target) and `_prevDataEnd` is carried forward, so
    // sequential streaming ticks slide the viewport without snapping the pan
    // back every frame.
    //
    // Clamp the preserved offset to `[0, pr]`. The lower bound matters when
    // the user panned/zoomed so far right that `dataEnd` landed left of the
    // viewport edge; the upper bound matters when a gesture left the right
    // edge past the natural-pin position — preserving a larger-than-pr gap
    // across ticks reads as "pulse drifting off screen" as new data arrives.
    // In both cases, pulling back toward the natural tail-track position is
    // the right next step.
    // Warm-up hold (armed by `setRangeHold`, i.e. `setVisibleRange({ from,
    // bars })`): keep the viewport stationary while the latest data is still
    // within the configured window. Streaming ticks render into the right-
    // side gap without sliding the existing seed bars off the left. Once
    // the data catches up to the right edge — or any user gesture clears
    // the hold — the normal offset-preserving pan logic takes over.
    if (this.#holdUntilFilled) {
      const tolerance = this.dataInterval * 0.01;
      if (lastTime + pr <= lTo + tolerance) {
        this._autoScroll = true;
        return;
      }
      this.#holdUntilFilled = false;
    }

    const anchorTo = lTo;
    const rawOffset = this._prevDataEnd !== null ? anchorTo - this._prevDataEnd : pr;
    const offset = Math.max(0, Math.min(pr, rawOffset));
    const targetTo = lastTime + offset;
    const targetFrom = targetTo - range;
    this._autoScroll = true;

    // Threshold: whichever is smaller — half a bar, or 4 px in time units.
    const barsThreshold = AUTOSCROLL_MIN_DELTA_BARS * this.dataInterval;
    const pxThreshold = chartWidth > 0 ? (AUTOSCROLL_MIN_DELTA_PX / chartWidth) * range : barsThreshold;
    const threshold = Math.min(barsThreshold, pxThreshold);

    // Sub-threshold streaming ticks (updateLast bursts) early-return; advancing
    // `_prevDataEnd` on those paths would drift it ahead of a fixed animation
    // target and eventually make `rawOffset` negative — clamping to 0 and
    // snapping the viewport to bare `dataEnd`, silently discarding any
    // preserved pan offset. The threshold check is on the delta between the
    // proposed target and the current logical position (target). This catches
    // sub-pixel drift whether or not we are mid-animation.
    const pending = Math.abs(targetTo - lTo);
    if (pending < threshold) return;

    // Size the scroll duration to the measured inter-arrival interval (see
    // streamingDuration) so the viewport keeps sliding through to the next
    // tick instead of settling at a fixed `ANIM.streamTick` and sitting idle
    // until the next point. Linear easing keeps the slide at constant speed —
    // eased curves slow as they approach each target, which produces a visible
    // wobble when the animator's mid-flight retarget kicks in.
    const duration = this.streamingDuration();

    this.retargetLogical(targetFrom, targetTo, duration, { easing: easeLinear });
    this._prevDataEnd = this.#dataEnd;
  }

  /** Return the number of data bars (candles/points) currently visible. */
  getVisibleBarsCount(): number {
    const { from, to } = this.#rangeAnimator.current;
    return (to - from) / this.dataInterval;
  }

  destroy(): void {
    this.removeAllListeners();
  }
}
