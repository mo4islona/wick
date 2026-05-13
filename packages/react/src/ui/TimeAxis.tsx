import { useLayoutEffect, useState } from 'react';

import { formatTime, resolveAxisFontSize, resolveAxisTextColor } from '@wick-charts/core';

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

  // Subscribe to `tickFrame` so the DOM opacity update lands in step with the
  // canvas grid fade — without this we'd only re-render on viewport changes
  // and the labels would snap-in.
  const [, setBump] = useState(0);
  useLayoutEffect(() => {
    const onFrame = () => setBump((n) => n + 1);
    chart.on('tickFrame', onFrame);

    return () => chart.off('tickFrame', onFrame);
  }, [chart]);

  const theme = chart.getTheme();
  const dataInterval = chart.getDataInterval();
  const { ticks: currentTicks, tickInterval } = chart.timeScale.niceTickValues(dataInterval);
  // Sync the tracker in render. This is idempotent — `setCurrentTicks` on
  // the same tick array is a no-op — so the StrictMode double-invocation
  // path doesn't leak state. We need the snapshot to reflect the current
  // tick set in the very first paint, which a layout-effect-based sync
  // can't deliver without a follow-up re-render the DOM consumer can't
  // observe synchronously.
  chart.timeScale.tickTracker.setCurrentTicks(currentTicks);
  const { entries } = chart.timeScale.tickTracker.snapshot();

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
      {entries.map(({ value: time, opacity }) => {
        if (opacity <= 0.01) return null;

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
              opacity,
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
