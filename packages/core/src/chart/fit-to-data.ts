/**
 * Pure helper: fit a logical X range around a data span, capped at
 * `maxVisibleBars * dataInterval`.
 *
 * Extracted out of `Viewport.fitToData` so the math can be unit-tested in
 * isolation and so the next refactor step can move the data-anchor state (start /
 * end / interval) onto the chart without dragging the viewport class along.
 */

import type { HorizontalPadding, VisibleRange } from '../types';

export interface FitToDataInput {
  /** Earliest data timestamp registered across all series. */
  firstTime: number;
  /** Latest data timestamp registered across all series. */
  lastTime: number;
  /** Time-between-bars; used as a unit for interval-style padding. */
  dataInterval: number;
  /**
   * Maximum bars to show before the fit caps. When the data span exceeds
   * this, the result anchors the right edge to `lastTime` and trims the left.
   */
  maxVisibleBars: number;
  /** Pixel width of the chart canvas. `0` is accepted; pixel-based padding becomes a no-op. */
  chartWidth: number;
  padding: {
    left: HorizontalPadding;
    right: HorizontalPadding;
  };
}

/** Compute the new logical range for a fit-to-data call. Always returns a non-empty range. */
export function computeFitToData(input: FitToDataInput): VisibleRange {
  const { firstTime, lastTime, dataInterval, maxVisibleBars, chartWidth, padding } = input;

  const maxRange = maxVisibleBars * dataInterval;
  const dataSpan = lastTime - firstTime;
  const estimatedRange = dataSpan > 0 ? dataSpan : dataInterval * 10;

  const pr = resolvePaddingTime(padding.right, estimatedRange, dataInterval, chartWidth);
  const pl = resolvePaddingTime(padding.left, estimatedRange, dataInterval, chartWidth);

  let targetTo = lastTime + pr;
  let targetFrom = firstTime - pl;

  if (targetTo - targetFrom > maxRange) {
    // Overflow — anchor the right edge, trim the left.
    targetTo = lastTime + pr;
    targetFrom = targetTo - maxRange;
  }

  return { from: targetFrom, to: targetTo };
}

/**
 * Resolve {@link HorizontalPadding} to a time offset. Mirrors the legacy
 * `Viewport.resolveHPad` exactly — kept private here because the viewport
 * still owns the same math for pan/zoom soft bounds.
 */
function resolvePaddingTime(pad: HorizontalPadding, range: number, dataInterval: number, chartWidth: number): number {
  if (typeof pad === 'object') return pad.intervals * dataInterval;
  if (chartWidth <= 0) return 0;

  return (pad / chartWidth) * range;
}
