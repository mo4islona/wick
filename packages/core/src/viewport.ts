import { ANIM, Animator, easeOutCubic } from './animation';
import { DEFAULT_REBOUND_MS } from './animation-constants';
import { EventEmitter } from './events';
import type { VisibleRange, YRange } from './types';
import { lerp } from './utils/math';

interface ViewportEvents {
  change: () => void;
  /**
   * Fired on user-initiated pan/zoom (not on programmatic animations). Chart
   * uses this to cancel series entrance animations so rapid panning doesn't
   * fight in-progress bar/candle intros.
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

  constructor({ padding, reboundMs }: ViewportOptions = {}) {
    super();
    this.padding = {
      top: padding?.top ?? DEFAULT_PADDING.top,
      bottom: padding?.bottom ?? DEFAULT_PADDING.bottom,
      right: padding?.right ?? DEFAULT_PADDING.right,
      left: padding?.left ?? DEFAULT_PADDING.left,
    };
    this.reboundMs = reboundMs ?? DEFAULT_REBOUND_MS;

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
  private retargetLogical(from: number, to: number, duration: number, now?: number): void {
    if (to <= from) return;
    const range = to - from;
    if (range / this.dataInterval < 2) return;

    this.#rangeAnimator.setTarget({ from, to }, { duration, now });
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

  /**
   * "Warm-up" predicate for streaming charts: returns `true` while the
   * viewport's left edge is still at its natural fit-to-data anchor
   * (`dataStart − leftPad`). While `true`, `Chart.onDataChanged` re-fits on
   * each new tick — the right edge expands to absorb fresh data, so the
   * line keeps growing rightward without sliding old points off the left.
   * Once `fitToData` hits its `maxBars` cap, the left edge advances away
   * from the natural anchor, this flips to `false`, and `scrollToEnd`'s
   * pan-aware tail-tracking takes over.
   *
   * Reads {@link logicalRange} so the math operates on the latest committed
   * target, not a mid-tween animated position.
   */
  dataFitsCurrentViewport(chartWidth = 0): boolean {
    if (this.#dataStart === null || this.#dataEnd === null) return false;
    const { from, to } = this.logicalRange;
    const range = to - from;
    if (range <= 0) return false;
    if (chartWidth > 0) this._lastChartWidth = chartWidth;
    const width = chartWidth > 0 ? chartWidth : this._lastChartWidth;
    const pl = this.resolveHPad(this.padding.left, range, width);

    const naturalLeft = this.#dataStart - pl;
    const tolerance = this.dataInterval * 0.5;

    return Math.abs(from - naturalLeft) <= tolerance;
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
   */
  setRange(range: VisibleRange): void {
    const { from, to } = range;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (to <= from) return;
    if ((to - from) / this.dataInterval < 2) return;

    const lastVisible = this.#dataEnd !== null && this.#dataEnd >= from && this.#dataEnd <= to;
    this._autoScroll = lastVisible;
    this.applyLogical(from, to);
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

    // User input takes over from any in-flight programmatic animation: commit
    // the current visual position as the new logical baseline so gesture math
    // operates on what the user sees, not on the destination of an animation
    // they can't perceive yet. Without this, zooming during a warm-up fit or
    // a scrollToEnd ease produces a visible jump from mid-tween to target
    // before the zoom is applied.
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

    // Same takeover rule as zoomAt — see the comment there.
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
   * animation. `animated=false` snaps; `animated=true` retargets — duration
   * defaults to `ANIM.fit` (intentional reflow), pass `durationMs` to
   * override (e.g. streaming warm-up uses `ANIM.streamTick` so per-tick
   * re-fits don't accumulate). The animation is skipped when the viewport
   * is uninitialised — first load always snaps so the data appears at its
   * natural extent.
   */
  fitToData(firstTime: number, lastTime: number, chartWidth = 0, animated = false, durationMs?: number): void {
    this._autoScroll = true;
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const maxBars = 400;
    const maxRange = maxBars * this.dataInterval;
    const dataSpan = lastTime - firstTime;

    // Compute a representative range for resolving pixel-based padding.
    // For interval-based padding this value is unused; for pixel-based it
    // must be a reasonable estimate — we use the data span as the base and
    // expand it below once we have targetFrom/targetTo.
    // For a single point, use a small multiple of dataInterval as the base range
    const estimatedRange = dataSpan > 0 ? dataSpan : this.dataInterval * 10;

    const pr = this.resolveHPad(this.padding.right, estimatedRange, chartWidth);
    const pl = this.resolveHPad(this.padding.left, estimatedRange, chartWidth);

    let targetTo = lastTime + pr;
    let targetFrom = firstTime - pl;

    // Cap to maxBars — anchor right edge and trim left
    if (targetTo - targetFrom > maxRange) {
      targetTo = lastTime + pr;
      targetFrom = targetTo - maxRange;
    }

    const { from: curFrom, to: curTo } = this.logicalRange;
    const uninitialised = curFrom === 0 && curTo === 0;
    if (animated && !uninitialised) {
      this.retargetLogical(targetFrom, targetTo, durationMs ?? ANIM.fit);
    } else {
      this.applyLogical(targetFrom, targetTo);
    }
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

    this.retargetLogical(targetFrom, targetTo, ANIM.streamTick);
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
