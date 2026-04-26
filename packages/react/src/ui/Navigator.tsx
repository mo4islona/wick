import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';

import { NavigatorController, type NavigatorData } from '@wick-charts/core';

import { useChartInstance } from '../context';
import { useTheme } from '../ThemeContext';

export interface NavigatorProps {
  /**
   * Data to render in the miniature view. Shape:
   *   { type: 'line' | 'bar',     points: { time, value }[] }
   *   { type: 'candlestick',      points: { time, open, high, low, close }[] }
   *
   * Usually the same series you feed into the main chart.
   */
  data: NavigatorData;
  /** Strip height in CSS pixels. Defaults to `theme.navigator.height` (60). */
  height?: number;
  /** Style override for the outer wrapper div. */
  style?: CSSProperties;
  /** Extra class on the outer wrapper div. */
  className?: string;
}

/**
 * Miniature navigator strip with a draggable window indicator for the main
 * chart's visible range. Must be rendered as a child of `<ChartContainer>`
 * so the chart instance is available via context.
 *
 * `ChartContainer` sifts this element out of its children and places it as a
 * flex sibling below the canvas area — it does not render inline.
 */
export function Navigator({ data, height, style, className }: NavigatorProps) {
  const chart = useChartInstance();
  // Subscribe to theme via context so a `<ThemeProvider>` swap re-renders the
  // strip with the new default height. Reading from `chart.getTheme()` would
  // miss those updates because the chart instance reference is stable.
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<NavigatorController | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const controller = new NavigatorController({
      container: containerRef.current,
      chart,
      data,
      options: height !== undefined ? { height } : undefined,
    });
    controllerRef.current = controller;

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // Mount-only. Data/height changes are synced by the two effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  useEffect(() => {
    controllerRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    controllerRef.current?.setOptions(height !== undefined ? { height } : {});
  }, [height]);

  const resolvedHeight = height ?? theme.navigator.height;

  return (
    <div
      ref={containerRef}
      className={className}
      data-chart-navigator=""
      style={{
        position: 'relative',
        width: '100%',
        height: resolvedHeight,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
