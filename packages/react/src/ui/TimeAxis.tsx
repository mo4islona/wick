import { useLayoutEffect, useRef } from 'react';

import { formatTime, resolveAxisFontSize, resolveAxisTextColor } from '@wick-charts/core';

import { useChartInstance } from '../context';
import { useVisibleRange } from '../store-bridge';
import { AXIS_LABEL_CLEANUP_MS, AXIS_LABEL_FADE_CSS } from './axisFade';

interface TrackedTick {
  opacity: number;
  addedAt: number;
  fadedAt?: number;
}

export interface TimeAxisProps {
  /** Desired number of labels (≥ 2). Overrides chart-level `axis.x.labelCount`. */
  labelCount?: number;
  /** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
  minLabelSpacing?: number;
}

export function TimeAxis({ labelCount, minLabelSpacing }: TimeAxisProps = {}) {
  const chart = useChartInstance();
  useVisibleRange(chart); // subscribe to viewport changes so ticks re-render

  useLayoutEffect(() => {
    chart.setTimeAxisLabelDensity({
      labelCount: labelCount ?? null,
      minLabelSpacing: minLabelSpacing ?? null,
    });

    return () => {
      chart.setTimeAxisLabelDensity({ labelCount: null, minLabelSpacing: null });
    };
  }, [chart, labelCount, minLabelSpacing]);
  const theme = chart.getTheme();
  const dataInterval = chart.getDataInterval();
  const { ticks: currentTicks, tickInterval } = chart.timeScale.niceTickValues(dataInterval);
  const currentSet = new Set(currentTicks);

  // Persistent map: tick value → tracked state
  const mapRef = useRef<Map<number, TrackedTick>>(new Map());
  const map = mapRef.current;
  const now = performance.now();

  // Mark current ticks as visible
  for (const t of currentTicks) {
    if (!map.has(t)) {
      map.set(t, { opacity: 1, addedAt: now });
    } else {
      map.get(t)!.opacity = 1;
    }
  }

  // Mark missing ticks for fade-out
  for (const [t, entry] of map) {
    if (!currentSet.has(t)) {
      if (entry.opacity !== 0) {
        entry.opacity = 0;
        entry.fadedAt = now;
      }
    }
  }

  // Clean up ticks that have finished fading. Buffer = AXIS_LABEL_FADE_MS + 250
  // (one transition + a frame margin) so the DOM node sticks around past the
  // visible fade.
  for (const [t, entry] of map) {
    if (entry.opacity === 0 && entry.fadedAt !== undefined && now - entry.fadedAt > AXIS_LABEL_CLEANUP_MS) {
      map.delete(t);
    }
  }

  // Collect all ticks to render (current + fading out)
  const allTicks = Array.from(map.entries());

  return (
    <div
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
    >
      {allTicks.map(([time, entry]) => {
        const x = chart.timeScale.timeToX(time);
        return (
          <span
            key={time}
            style={{
              position: 'absolute',
              left: x,
              transform: 'translateX(-50%)',
              color: resolveAxisTextColor(theme, 'x'),
              fontSize: resolveAxisFontSize(theme, 'x'),
              fontFamily: theme.typography.fontFamily,
              userSelect: 'none',
              whiteSpace: 'nowrap',
              opacity: entry.opacity,
              transition: AXIS_LABEL_FADE_CSS,
              willChange: 'opacity',
            }}
          >
            {formatTime(time, tickInterval)}
          </span>
        );
      })}
    </div>
  );
}
