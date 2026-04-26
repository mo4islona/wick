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

/**
 * Manages the visible time range and Y range of the chart.
 *
 * User-initiated pan/zoom applies range updates instantly — smoothing on input
 * events feels laggy in practice. The `animateTo` / `tick` path is reserved for
 * API-driven transitions (`fitToData`, `scrollToEnd`) and post-gesture rebound
 * (`startRebound`), where a short cubic ease-out reads as intentional motion.
 *
 * Viewport boundaries are "soft": pan and zoom may push past them with
 * progressive rubber-band resistance. When the gesture ends, {@link startRebound}
 * animates the range back into valid bounds and fires `edgeReached` for the
 * side that was pulled past — chart hosts use that signal to fetch more data.
 */
export class Viewport extends EventEmitter<ViewportEvents> {
  private _visibleRange: VisibleRange = { from: 0, to: 0 };
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

  // Animation state — no own rAF, ticked by the render loop. Used by API-driven
  // transitions (fitToData, scrollToEnd) and post-gesture rebound.
  private _animating = false;
  private animStartTime = 0;
  private animDuration = 0;
  private animFrom: VisibleRange = { from: 0, to: 0 };
  private animTo: VisibleRange = { from: 0, to: 0 };

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

  get visibleRange(): VisibleRange {
    return this._visibleRange;
  }

  get yRange(): YRange {
    return this._yRange;
  }

  get autoScroll(): boolean {
    return this._autoScroll;
  }

  get animating(): boolean {
    return this._animating;
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

  private cancelAnimation(): void {
    this._animating = false;
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
   * (`dataStart − leftPad`). While true, `Chart.onDataChanged` re-fits on each
   * new tick — the right edge expands to absorb fresh data instead of
   * `scrollToEnd` sliding the whole window right and pushing the head off-screen.
   *
   * The right-edge condition is intentionally absent: the predicate is meant
   * to detect "user hasn't panned/zoomed away from fit", not "data already fits
   * in the current window" — we explicitly want to keep refitting (and growing
   * the viewport) even when the new tail would extend past the current right
   * edge. Once the natural-fit window grows past the maxBars cap inside
   * `fitToData`, its targetFrom anchors on `lastTime - maxRange` and the left
   * edge advances away from `dataStart − leftPad`, flipping this predicate to
   * `false` and handing off to `scrollToEnd`'s pan-aware tail-tracking.
   */
  dataFitsCurrentViewport(chartWidth = 0): boolean {
    if (this.#dataStart === null || this.#dataEnd === null) return false;
    const range = this._visibleRange.to - this._visibleRange.from;
    if (range <= 0) return false;
    if (chartWidth > 0) this._lastChartWidth = chartWidth;
    const width = chartWidth > 0 ? chartWidth : this._lastChartWidth;
    const pl = this.resolveHPad(this.padding.left, range, width);

    const naturalLeft = this.#dataStart - pl;
    const tolerance = this.dataInterval * 0.5;

    return Math.abs(this._visibleRange.from - naturalLeft) <= tolerance;
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
   * Cancels any in-flight animation and applies the range immediately.
   * Auto-scroll policy mirrors pan: if the incoming range still contains
   * the last data point, streaming ticks keep tracking the tail; otherwise
   * the user is opting out of auto-scroll until they call `fitContent` or
   * scroll back to the tail.
   *
   * Silently no-ops on invalid input (non-finite bounds, to <= from, or
   * fewer than 2 bars visible) — mirrors `applyRange`'s validation contract
   * so callers can lob in a range before the data interval stabilises.
   * Validation runs up-front so a rejected call never mutates auto-scroll
   * or cancels in-flight animations.
   */
  setRange(range: VisibleRange): void {
    const { from, to } = range;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (to <= from) return;
    if ((to - from) / this.dataInterval < 2) return;

    this.cancelAnimation();
    const lastVisible = this.#dataEnd !== null && this.#dataEnd >= from && this.#dataEnd <= to;
    this._autoScroll = lastVisible;
    this.applyRange(from, to);
  }

  /** Validate and apply a new visible range. Rejects invalid widths only. Soft-bound
   * enforcement happens at the caller (pan/zoomAt) via rubber-band resistance. */
  private applyRange(from: number, to: number): void {
    if (to <= from) return;

    const range = to - from;
    const bars = range / this.dataInterval;
    if (bars < 2) return;

    this._visibleRange = { from, to };
    this.emit('change');
  }

  /** Start animation — will be advanced by tick() calls from the render loop */
  animateTo(from: number, to: number, duration = 400): void {
    this.animFrom = { ...this._visibleRange };
    this.animTo = { from, to };
    this.animDuration = duration;
    this.animStartTime = performance.now();
    this._animating = true;
  }

  /** Called by the render loop before each frame. Returns true if still animating. */
  tick(now: number): boolean {
    if (!this._animating) return false;

    const elapsed = now - this.animStartTime;
    const t = Math.min(1, elapsed / this.animDuration);
    // Cubic ease-out for a smooth deceleration
    const ease = 1 - (1 - t) ** 3;

    const curFrom = lerp(this.animFrom.from, this.animTo.from, ease);
    const curTo = lerp(this.animFrom.to, this.animTo.to, ease);

    if (curTo > curFrom) {
      // Use applyRange for consistent clamping
      this.applyRange(curFrom, curTo);
    }

    if (t >= 1) {
      this._animating = false;
    }

    return this._animating;
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
   */
  zoomAt(centerTime: number, factor: number, chartWidth = this._lastChartWidth): void {
    this.cancelAnimation();
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const { from, to } = this._visibleRange;
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

    this.applyRange(newFrom, newTo);
    this.emit('interact');
  }

  /**
   * Shift the visible range by a time delta. Overshooting either data edge
   * applies rubber-band resistance: the more the user pulls past, the smaller
   * each subsequent pixel of drag translates into actual range shift. Total
   * overshoot is capped at `PAN_MAX_OVERSHOOT_FRACTION` of the visible range.
   */
  pan(timeDelta: number, chartWidth = 0): void {
    this.cancelAnimation();
    if (chartWidth > 0) this._lastChartWidth = chartWidth;

    const { from, to } = this._visibleRange;
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
    this.applyRange(newFrom, newTo);
    this.emit('interact');
  }

  /**
   * Animate the visible range back into soft bounds after a gesture ends.
   * No-op when already inside bounds. When the rebound corrects a meaningful
   * overshoot (> 10% of range) the side and overshoot magnitude are emitted
   * via `edgeReached` — hosts hook this to trigger history prefetch.
   */
  startRebound(chartWidth = this._lastChartWidth): void {
    const { from, to } = this._visibleRange;
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
      this.applyRange(targetFrom, targetTo);
    } else {
      this.animateTo(targetFrom, targetTo, this.reboundMs);
    }

    if (edgeSide !== null) {
      this.emit('edgeReached', {
        side: edgeSide,
        overshoot: edgeOvershoot,
        boundaryTime: edgeBoundaryTime,
      });
    }
  }

  /** Fit the viewport to show data from first to last timestamp, with optional animation. */
  fitToData(firstTime: number, lastTime: number, chartWidth = 0, animated = false): void {
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

    if (animated && this._visibleRange.from !== 0 && this._visibleRange.to !== 0) {
      this.animateTo(targetFrom, targetTo, 450);
    } else {
      this.applyRange(targetFrom, targetTo);
    }
  }

  /**
   * Keep the right edge pinned to the latest data (real-time auto-scroll).
   *
   * Streaming feeds can fire many ticks per second. Restarting the ease-out on
   * every tick produces a jittery one-pixel shimmy instead of a smooth slide.
   * Strategy:
   *   - If an animation is in flight and the new target differs from the
   *     current `animTo` by less than one threshold, let it finish.
   *   - If it differs by more, retarget without resetting `animStartTime` so
   *     the ease-out continues from its current progress.
   *   - If idle and the pending shift is below threshold, do nothing.
   */
  scrollToEnd(lastTime: number, chartWidth = 0): void {
    if (chartWidth > 0) this._lastChartWidth = chartWidth;
    const range = this._visibleRange.to - this._visibleRange.from;
    if (range <= 0) return;
    const pr = this.resolveHPad(this.padding.right, range, chartWidth);

    // Preserve the user's offset from the live tail across ticks.
    //
    // Base case (no prior `dataEnd` recorded): fall back to `lastTime + pr`,
    // matching the old pin behavior on the first scroll.
    //
    // Panned case (user scrolled while the tail was still visible, autoScroll
    // stayed true per task #12): the offset between the current right edge
    // and `_prevDataEnd` is carried forward, so sequential streaming ticks
    // slide the viewport without snapping the pan back every frame.
    //
    // Anchor on `animTo.to` when mid-animation so rapid back-to-back ticks
    // compute the offset against the intended target, not the partway
    // position — otherwise the viewport would drift behind the tail.
    //
    // Clamp the preserved offset to `[0, pr]`. The lower bound matters when
    // the user panned/zoomed so far right that `dataEnd` landed left of the
    // viewport edge; the upper bound matters when a gesture left the right
    // edge past the natural-pin position — preserving a larger-than-pr gap
    // across ticks reads as "pulse drifting off screen" as new data arrives.
    // In both cases, pulling back toward the natural tail-track position is
    // the right next step.
    const anchorTo = this._animating ? this.animTo.to : this._visibleRange.to;
    const rawOffset = this._prevDataEnd !== null ? anchorTo - this._prevDataEnd : pr;
    const offset = Math.max(0, Math.min(pr, rawOffset));
    const targetTo = lastTime + offset;
    const targetFrom = targetTo - range;
    this._autoScroll = true;

    // Threshold: whichever is smaller — half a bar, or 4 px in time units.
    const barsThreshold = AUTOSCROLL_MIN_DELTA_BARS * this.dataInterval;
    const pxThreshold = chartWidth > 0 ? (AUTOSCROLL_MIN_DELTA_PX / chartWidth) * range : barsThreshold;
    const threshold = Math.min(barsThreshold, pxThreshold);

    // `_prevDataEnd` is folded forward only when the call actually retargets
    // the animation. Sub-threshold streaming ticks (updateLast bursts) early-
    // return below; advancing `_prevDataEnd` on those paths would drift it
    // ahead of the fixed animation target and eventually make `rawOffset`
    // negative — clamping to 0 and snapping the viewport to bare `dataEnd`,
    // silently discarding any preserved pan offset.
    if (this._animating) {
      // Retarget in flight — don't reset animStartTime unless the delta is large
      // enough to be worth perceiving as a new animation beat.
      const retargetDelta = Math.abs(targetTo - this.animTo.to);
      if (retargetDelta < threshold) return; // let current animation finish
      this.animFrom = { ...this._visibleRange };
      this.animTo = { from: targetFrom, to: targetTo };
      this._prevDataEnd = this.#dataEnd;
      // Keep animStartTime + animDuration as-is so the ease-out continues from
      // its current progress rather than snapping to fresh-start.
    } else {
      const pending = Math.abs(targetTo - this._visibleRange.to);
      if (pending < threshold) return; // sub-pixel drift, not worth animating
      this.animateTo(targetFrom, targetTo, 150);
      this._prevDataEnd = this.#dataEnd;
    }
  }

  /** Return the number of data bars (candles/points) currently visible. */
  getVisibleBarsCount(): number {
    return (this._visibleRange.to - this._visibleRange.from) / this.dataInterval;
  }

  destroy(): void {
    this.cancelAnimation();
    this.removeAllListeners();
  }
}
