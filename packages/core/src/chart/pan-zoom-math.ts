/**
 * Pure pan / zoom math for the viewport's logical X range. Extracted out
 * of `Viewport` so the rubber-band, soft-bound clamp, and edge-reached
 * classification can be unit-tested in isolation and so the next refactor
 * step can move data-anchor state (dataStart / dataEnd / padding /
 * dataInterval) onto the chart without dragging the class along.
 *
 * Inputs are explicit (no class fields). Outputs include flags (`autoScrollOff`,
 * `edgeReached`) the caller applies as side effects.
 */

import type { HorizontalPadding, VisibleRange } from '../types';

/** Minimum overshoot fraction of visible range before edgeReached fires. */
export const EDGE_REACHED_MIN_FRACTION = 0.1;
/** Maximum overshoot as a fraction of the visible range during a pan gesture. */
export const PAN_MAX_OVERSHOOT_FRACTION = 0.3;
/** Maximum zoom-in overshoot as a fraction of softMinRange. */
export const ZOOM_MIN_OVERSHOOT_FRACTION = 0.4;
/** Default maximum visible bars before fitToData caps and tail-scroll takes over. */
export const DEFAULT_MAX_VISIBLE_BARS = 200;
/** Minimum allowed `maxVisibleBars` — matches the visible-bar floor below which
 *  the viewport refuses to render. */
export const MIN_VISIBLE_BARS = 2;

export interface SoftBounds {
  left: number | null;
  right: number | null;
}

/**
 * Resolve a {@link HorizontalPadding} value to a time offset.
 * - `{ intervals: N }` → N * dataInterval (zoom-independent bar count)
 * - `number` (pixels) → (px / chartWidth) * visibleRange (zoom-dependent)
 */
export function resolveHorizontalPaddingTime(
  pad: HorizontalPadding,
  range: number,
  dataInterval: number,
  chartWidth: number,
): number {
  if (typeof pad === 'object') return pad.intervals * dataInterval;
  if (chartWidth <= 0) return 0;

  return (pad / chartWidth) * range;
}

export interface SoftBoundsInput {
  range: number;
  chartWidth: number;
  dataInterval: number;
  padding: { left: HorizontalPadding; right: HorizontalPadding };
  dataStart: number | null;
  dataEnd: number | null;
}

/**
 * Compute the left / right soft pan-time bound. Returns `null` on a side
 * whose data boundary is unset or whose padding requires a chart width
 * that isn't available yet.
 */
export function computeSoftBounds(input: SoftBoundsInput): SoftBounds {
  const { range, chartWidth, dataInterval, padding, dataStart, dataEnd } = input;
  // Pixel padding of 0 is trivially resolvable without a chart width.
  const resolvable = (pad: HorizontalPadding) => typeof pad === 'object' || pad === 0 || chartWidth > 0;

  const left =
    dataStart !== null && resolvable(padding.left)
      ? dataStart - resolveHorizontalPaddingTime(padding.left, range, dataInterval, chartWidth)
      : null;
  const right =
    dataEnd !== null && resolvable(padding.right)
      ? dataEnd + resolveHorizontalPaddingTime(padding.right, range, dataInterval, chartWidth)
      : null;

  return { left, right };
}

/** Minimum visible range (zoom-in ceiling). Expressed as 10 bars. */
export function softMinRange(dataInterval: number): number {
  return 10 * dataInterval;
}

export interface SoftMaxRangeInput {
  dataInterval: number;
  padding: { left: HorizontalPadding; right: HorizontalPadding };
  dataStart: number | null;
  dataEnd: number | null;
}

/**
 * Maximum visible range (zoom-out floor). Returns `null` when data bounds
 * are unknown — no hard ceiling in that case.
 */
export function softMaxRange(input: SoftMaxRangeInput): number | null {
  const { dataInterval, padding, dataStart, dataEnd } = input;
  if (dataStart === null || dataEnd === null) return null;

  const span = dataEnd - dataStart;
  if (span <= 0) return null;

  const leftPad = typeof padding.left === 'object' ? padding.left.intervals * dataInterval : null;
  const rightPad = typeof padding.right === 'object' ? padding.right.intervals * dataInterval : null;

  if (leftPad !== null || rightPad !== null) {
    return span + (leftPad ?? 0) + (rightPad ?? 0);
  }

  return span + dataInterval * 5;
}

export interface PanInput {
  currentLogical: VisibleRange;
  timeDelta: number;
  chartWidth: number;
  dataInterval: number;
  padding: { left: HorizontalPadding; right: HorizontalPadding };
  dataStart: number | null;
  dataEnd: number | null;
}

export interface EdgeReachedInfo {
  side: 'left' | 'right';
  overshoot: number;
  boundaryTime: number;
}

export interface PanResult {
  /** New logical X range to commit, or `null` if the input range is invalid. */
  newLogical: VisibleRange | null;
  /** When `true`, the new window no longer contains the data tail — caller should disable autoScroll. */
  autoScrollOff: boolean;
  /** When set, caller should fire its `edgeReached` event with this payload. */
  edgeReached: EdgeReachedInfo | null;
}

/**
 * Shift the visible range by a time delta. Overshooting either data edge
 * applies rubber-band resistance, clamped at `PAN_MAX_OVERSHOOT_FRACTION`
 * of the range.
 *
 * A pan that leaves the last data point on screen stays "live" (autoscroll
 * untouched); one that pushes it off counts as deliberate history
 * inspection (`autoScrollOff: true`).
 */
export function computePan(input: PanInput): PanResult {
  const { currentLogical, timeDelta, chartWidth, dataInterval, padding, dataStart, dataEnd } = input;
  const { from, to } = currentLogical;
  const range = to - from;
  if (range <= 0) {
    return { newLogical: null, autoScrollOff: false, edgeReached: null };
  }

  const { left: softLeft, right: softRight } = computeSoftBounds({
    range,
    chartWidth,
    dataInterval,
    padding,
    dataStart,
    dataEnd,
  });
  const maxOver = range * PAN_MAX_OVERSHOOT_FRACTION;

  let effDelta = timeDelta;
  if (timeDelta > 0 && softRight !== null) {
    const overRight = Math.max(0, to - softRight);
    if (overRight > 0) effDelta *= 1 / (overRight / maxOver + 1);
  } else if (timeDelta < 0 && softLeft !== null) {
    const overLeft = Math.max(0, softLeft - from);
    if (overLeft > 0) effDelta *= 1 / (overLeft / maxOver + 1);
  }

  let newFrom = from + effDelta;
  let newTo = to + effDelta;

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

  const lastVisible = dataEnd !== null && dataEnd >= newFrom && dataEnd <= newTo;

  const edgeThreshold = range * EDGE_REACHED_MIN_FRACTION;
  let edgeReached: EdgeReachedInfo | null = null;
  if (softRight !== null && newTo - softRight > edgeThreshold) {
    edgeReached = { side: 'right', overshoot: newTo - softRight, boundaryTime: softRight };
  } else if (softLeft !== null && softLeft - newFrom > edgeThreshold) {
    edgeReached = { side: 'left', overshoot: softLeft - newFrom, boundaryTime: softLeft };
  }

  return {
    newLogical: { from: newFrom, to: newTo },
    autoScrollOff: !lastVisible,
    edgeReached,
  };
}

export interface ZoomInput {
  currentLogical: VisibleRange;
  centerTime: number;
  factor: number;
  chartWidth: number;
  dataInterval: number;
  padding: { left: HorizontalPadding; right: HorizontalPadding };
  dataStart: number | null;
  dataEnd: number | null;
}

export interface ZoomResult {
  /** New logical X range to commit, or `null` if the input range is invalid. */
  newLogical: VisibleRange | null;
}

/**
 * Zoom in / out around a time anchor. `factor < 1` zooms in, `> 1` zooms out.
 *
 * - Zoom-in pins the right edge (never drifts left). Below the 10-bar floor
 *   a rubber-band lets the gesture push past with progressive damping.
 * - Zoom-out is hard-capped at the padded data span; past that the math
 *   clamps newRange so the result never reveals an empty gap past the
 *   data edges.
 * - Zoom does NOT toggle autoScroll — that's a pan-only concern.
 */
export function computeZoom(input: ZoomInput): ZoomResult {
  const { currentLogical, centerTime, factor, chartWidth, dataInterval, padding, dataStart, dataEnd } = input;
  const { from, to } = currentLogical;
  const range = to - from;
  if (range <= 0) {
    return { newLogical: null };
  }

  const softMin = softMinRange(dataInterval);
  const { left: softLeft, right: softRight } = computeSoftBounds({
    range,
    chartWidth,
    dataInterval,
    padding,
    dataStart,
    dataEnd,
  });
  const hardMaxRange =
    softLeft !== null && softRight !== null
      ? softRight - softLeft
      : softMaxRange({ dataInterval, padding, dataStart, dataEnd });

  let effFactor = factor;
  const minMaxOver = softMin * ZOOM_MIN_OVERSHOOT_FRACTION;

  // Zoom-in past the 10-bar floor: rubber-band resistance on the factor.
  if (factor < 1 && range < softMin) {
    const over = softMin - range;
    const ratio = Math.min(1, over / minMaxOver);
    const resistance = (1 - ratio) ** 2;
    effFactor = 1 - (1 - factor) * resistance;
  }

  let newRange = range * effFactor;
  if (newRange < softMin - minMaxOver) newRange = softMin - minMaxOver;
  if (factor > 1 && hardMaxRange !== null && newRange > hardMaxRange) {
    newRange = hardMaxRange;
  }

  const ratioAnchor = (centerTime - from) / range;
  let newFrom = centerTime - ratioAnchor * newRange;
  let newTo = newFrom + newRange;

  // Zoom-in guardrail: never let the right edge drift left past its
  // current position. Keeps the last candle in view.
  if (factor < 1 && newTo < to) {
    const shift = to - newTo;
    newFrom += shift;
    newTo += shift;
  }

  // Zoom-out: clamp sides into soft bounds.
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

  return { newLogical: { from: newFrom, to: newTo } };
}
