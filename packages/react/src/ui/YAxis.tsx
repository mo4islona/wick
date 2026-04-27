import { useLayoutEffect, useRef } from 'react';

import { resolveAxisFontSize, resolveAxisTextColor, type ValueFormatter } from '@wick-charts/core';

import { useChartInstance } from '../context';
import { useYRange } from '../store-bridge';
import { AXIS_LABEL_CLEANUP_MS, AXIS_LABEL_FADE_CSS } from './axisFade';

interface TrackedTick {
  opacity: number;
  addedAt: number;
  fadedAt?: number;
}

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

  const theme = chart.getTheme();
  const currentTicks = chart.yScale.niceTickValues();
  const currentSet = new Set(currentTicks);

  const mapRef = useRef<Map<number, TrackedTick>>(new Map());
  const map = mapRef.current;
  const now = performance.now();

  for (const p of currentTicks) {
    if (!map.has(p)) {
      map.set(p, { opacity: 1, addedAt: now });
    } else {
      map.get(p)!.opacity = 1;
    }
  }

  for (const [p, entry] of map) {
    if (!currentSet.has(p)) {
      if (entry.opacity !== 0) {
        entry.opacity = 0;
        entry.fadedAt = now;
      }
    }
  }

  // Cleanup buffer matches the shared AXIS_LABEL_CLEANUP_MS — see axisFade.ts.
  for (const [p, entry] of map) {
    if (entry.opacity === 0 && entry.fadedAt !== undefined && now - entry.fadedAt > AXIS_LABEL_CLEANUP_MS) {
      map.delete(p);
    }
  }

  const allTicks = Array.from(map.entries());

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
      {allTicks.map(([price, entry]) => {
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
              opacity: entry.opacity,
              transition: AXIS_LABEL_FADE_CSS,
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
