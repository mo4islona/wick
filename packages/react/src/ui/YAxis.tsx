import { useLayoutEffect, useState } from 'react';

import { type ValueFormatter, resolveAxisFontSize, resolveAxisTextColor } from '@wick-charts/core';

import { useChartInstance } from '../context';
import { useYRange } from '../store-bridge';

export interface YAxisProps {
  /**
   * Custom tick-label formatter. When supplied, overrides the built-in
   * range-adaptive formatter for this axis.
   */
  format?: ValueFormatter;
  /**
   * Desired number of labels (≥ 2). Overrides any chart-level `axis.y.labelCount`.
   * Realized count may differ ±1 after the 1-2-5 snap.
   */
  labelCount?: number;
  /** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
  minLabelSpacing?: number;
}

export function YAxis({ format, labelCount, minLabelSpacing }: YAxisProps = {}) {
  const chart = useChartInstance();
  useYRange(chart); // subscribe to viewport changes so ticks re-render

  // Route the prop through yScale so the *same* formatter drives every
  // surface that reads `yScale.formatY()` (Crosshair, YLabel fallback).
  useLayoutEffect(() => {
    chart.yScale.setFormat(format ?? null);

    return () => chart.yScale.setFormat(null);
  }, [chart, format]);

  useLayoutEffect(() => {
    chart.setYAxisLabelDensity({
      labelCount: labelCount ?? null,
      minLabelSpacing: minLabelSpacing ?? null,
    });

    return () => {
      chart.setYAxisLabelDensity({ labelCount: null, minLabelSpacing: null });
    };
  }, [chart, labelCount, minLabelSpacing]);

  // Subscribe to `tickFrame` so DOM opacity advances together with grid fade.
  const [, setBump] = useState(0);
  useLayoutEffect(() => {
    const onFrame = () => setBump((n) => n + 1);
    chart.on('tickFrame', onFrame);

    return () => chart.off('tickFrame', onFrame);
  }, [chart]);

  const theme = chart.getTheme();
  // Seed the tracker so the very first paint after a data swap renders
  // ticks even before chart.renderMain runs (a React rerender driven by
  // setSeriesData schedules a RAF, not an inline renderMain). The chart's
  // `#emitTickFade` keeps its own diff baseline so this idempotent setter
  // can't starve the engine of a tickFade event — but the tracker's
  // current-tick array must already point at the new set for `snapshot`
  // to surface the new values. Opacity per tick still flows from
  // `state.tickOpacity`, populated when chart.renderMain emits.
  chart.yScale.tickTracker.setCurrentTicks(chart.yScale.niceTickValues());
  const { entries } = chart.yScale.tickTracker.snapshot(chart.getAnimationState().tickOpacity);

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: chart.xAxisHeight,
        width: chart.yAxisWidth,
        pointerEvents: 'none',
      }}
    >
      {entries.map(({ value: price, opacity }) => {
        if (opacity <= 0.01) return null;

        const y = chart.yScale.valueToY(price);

        return (
          <span
            key={price}
            style={{
              position: 'absolute',
              right: 8,
              top: y,
              transform: 'translateY(-50%)',
              color: resolveAxisTextColor(theme, 'y'),
              fontSize: resolveAxisFontSize(theme, 'y'),
              fontFamily: theme.typography.fontFamily,
              fontVariantNumeric: 'tabular-nums',
              userSelect: 'none',
              opacity,
              willChange: 'opacity',
            }}
          >
            {chart.yScale.formatY(price)}
          </span>
        );
      })}
    </div>
  );
}
