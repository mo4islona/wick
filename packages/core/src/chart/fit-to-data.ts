/**
 * Pure helper: fit a logical X range around a data span, capped at
 * `maxVisibleBars * dataInterval`. Lives chart-side so the math is
 * unit-testable in isolation from any class instance.
 */

import type { HorizontalPadding, VisibleRange } from '../types';
import { resolvePaddingTime } from './viewport-padding';

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
