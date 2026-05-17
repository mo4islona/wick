import { useLayoutEffect, useRef } from 'react';

import { mountAxisLabels } from '@wick-charts/core';

import { useChartInstance } from '../context';
import { useVisibleRange } from '../store-bridge';

export interface TimeAxisProps {
  /** Desired number of labels (≥ 2). Overrides chart-level `axis.x.labelCount`. */
  labelCount?: number;
  /** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
  minLabelSpacing?: number;
}

export function TimeAxis({ labelCount, minLabelSpacing }: TimeAxisProps = {}) {
  const chart = useChartInstance();
  // Subscribe so the container re-renders when chart geometry shifts
  // (yAxisWidth / xAxisHeight can change on resize, legend mount, etc.).
  useVisibleRange(chart);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    chart.setTimeAxisLabelDensity({
      labelCount: labelCount ?? null,
      minLabelSpacing: minLabelSpacing ?? null,
    });

    return () => {
      chart.setTimeAxisLabelDensity({ labelCount: null, minLabelSpacing: null });
    };
  }, [chart, labelCount, minLabelSpacing]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    return mountAxisLabels({ chart, container, axis: 'x' });
  }, [chart]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        right: chart.yAxisWidth,
        height: chart.xAxisHeight,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
      }}
    />
  );
}
