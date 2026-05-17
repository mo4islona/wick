import { useLayoutEffect, useRef } from 'react';

import { type ValueFormatter, mountAxisLabels } from '@wick-charts/core';

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
  useYRange(chart);

  const containerRef = useRef<HTMLDivElement | null>(null);

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

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    return mountAxisLabels({ chart, container, axis: 'y' });
  }, [chart]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: chart.xAxisHeight,
        width: chart.yAxisWidth,
        pointerEvents: 'none',
      }}
    />
  );
}
