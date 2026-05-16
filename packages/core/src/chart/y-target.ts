/**
 * Y-bound resolution. Pulled out of ChartInstance because the math is pure
 * series-store reads + axis-bound interpretation — no chart state beyond
 * what the caller passes in.
 *
 * Two stages:
 *   1. {@link computeTargetYRange} sweeps visible series and returns the
 *      raw [min, max] of in-window data.
 *   2. {@link resolveBound} interprets an `AxisBound` (number / 'auto' /
 *      function / percentage string) against that raw range to produce the
 *      final per-side bound.
 *
 * The chart's `#computeYTarget` wires both stages together.
 */

import type { TimeSeriesStore } from '../data/store';
import type { SeriesRenderer } from '../series/types';
import type { AxisBound, OHLCData, TimePoint, VisibleRange } from '../types';

export interface YTargetSeries {
  readonly renderer: SeriesRenderer;
  // biome-ignore lint/suspicious/noExplicitAny: matches the heterogeneous storage in ChartInstance.
  readonly store: TimeSeriesStore<any> | null;
  readonly visible: boolean;
}

/**
 * Sample data inside `targetVisible` and return the unbounded [min, max] of
 * visible series, or `null` when nothing is in view. Bounds are NOT applied
 * here — the caller composes them via {@link resolveBound}.
 *
 * When `allValues` is non-null, individual sampled values are pushed into
 * it so function- / percentage-style bounds can reference the full
 * distribution (otherwise only min/max are visited).
 */
export function computeTargetYRange(
  targetVisible: VisibleRange,
  series: readonly YTargetSeries[],
  allValues: number[] | null,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;

  for (const entry of series) {
    if (!entry.visible) continue;

    // Custom value range from the renderer (e.g. stacked totals) wins.
    if (entry.renderer.getValueRange) {
      const r = entry.renderer.getValueRange(targetVisible.from, targetVisible.to);
      if (r) {
        if (r.max > max) max = r.max;
        if (r.min < min) min = r.min;
        allValues?.push(r.min, r.max);
        continue;
      }
    }
    if (!entry.store) continue;

    const visible = entry.store.getVisibleData(targetVisible.from, targetVisible.to);
    for (const point of visible) {
      if ('high' in point) {
        const ohlc = point as OHLCData;
        // Skip non-finite values (null / undefined / NaN / ±Infinity). Without
        // the guard, `Infinity` poisons max, `-Infinity` poisons min, and
        // `null` coerces to 0, collapsing the range to a single flat line.
        if (Number.isFinite(ohlc.high)) {
          if (ohlc.high > max) max = ohlc.high;
          allValues?.push(ohlc.high);
        }
        if (Number.isFinite(ohlc.low)) {
          if (ohlc.low < min) min = ohlc.low;
          allValues?.push(ohlc.low);
        }
      } else {
        const line = point as TimePoint;
        if (Number.isFinite(line.value)) {
          if (line.value > max) max = line.value;
          if (line.value < min) min = line.value;
          allValues?.push(line.value);
        }
      }
    }
  }

  if (min === Infinity || max === -Infinity) return null;

  return { min, max };
}

/** Resolve an {@link AxisBound} to a concrete numeric value. */
export function resolveBound(
  bound: AxisBound | undefined,
  autoValue: number,
  otherValue: number,
  values: number[],
  side: 'min' | 'max',
): number {
  if (bound === undefined || bound === 'auto') return autoValue;
  if (typeof bound === 'number') return bound;
  if (typeof bound === 'function') return bound(values);

  // Parse percentage string like "+10%", "-5%".
  const match = String(bound).match(/^([+-]?)\s*(\d+(?:\.\d+)?)\s*%$/);
  if (match) {
    const sign = match[1] === '-' ? -1 : 1;
    const pct = parseFloat(match[2]) / 100;
    const dataRange = Math.abs(otherValue - autoValue) || Math.abs(autoValue) || 1;

    return autoValue + sign * pct * dataRange * (side === 'max' ? 1 : -1);
  }

  return autoValue;
}
