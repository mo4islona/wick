/**
 * Shared padding-resolution math used by every chart-side helper that
 * needs to convert a {@link HorizontalPadding} value into a time offset.
 *
 * Two units, one interface:
 * - `{ intervals: N }` → `N * dataInterval` ms (zoom-independent bar count)
 * - `number` (pixels)  → `(px / chartWidth) * range` ms (zoom-dependent)
 *
 * Returns `0` when the padding is pixel-based but the chart hasn't been
 * sized yet (`chartWidth <= 0`).
 */

import type { HorizontalPadding } from '../types';

export function resolvePaddingTime(
  pad: HorizontalPadding,
  range: number,
  dataInterval: number,
  chartWidth: number,
): number {
  if (typeof pad === 'object') return pad.intervals * dataInterval;
  if (chartWidth <= 0) return 0;

  return (pad / chartWidth) * range;
}
