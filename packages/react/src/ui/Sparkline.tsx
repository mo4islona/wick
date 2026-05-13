import { type CSSProperties, useMemo, useRef } from 'react';

import { type ChartTheme, type TimePoint, formatCompact, resolveCandlestickBodyColor } from '@wick-charts/core';

import { BarSeries } from '../BarSeries';
import { ChartContainer } from '../ChartContainer';
import { LineSeries } from '../LineSeries';

export type SparklineVariant = 'line' | 'bar';
export type SparklineValuePosition = 'left' | 'right' | 'none';

export interface SparklineProps {
  /** Data points plotted by the sparkline. A flat `TimePoint[]` — the sparkline only ever shows one tiny line/bar. */
  data: TimePoint[];
  /**
   * Streaming-window mode: viewport is fixed at `capacity` bars wide and
   * stays anchored at the time of the first data point until the window
   * fills. New ticks flow into the empty right side instead of expanding
   * the visible range. Pass at least one seed point in `data` so the
   * initial window has a time anchor.
   */
  flow?: { capacity: number };
  /** Visual theme. Drives series colour, background gradient, and the change-direction colours used in the value block. */
  theme: ChartTheme;
  /** 'line' (default) or 'bar' */
  variant?: SparklineVariant;
  /** Where to show the value label */
  valuePosition?: SparklineValuePosition;
  /** Custom format for the value */
  formatValue?: (value: number) => string;
  /** Label text above the value */
  label?: string;
  /** Sublabel text below the value (defaults to the change %) */
  sublabel?: string;
  /** Line/bar color override (defaults to theme) */
  color?: string;
  /** Secondary color for negative bars */
  negativeColor?: string;
  /** Show area fill under line */
  area?: {
    /** Whether the area fill is rendered under the sparkline. Defaults to `true`. */
    visible: boolean;
  };
  /** @deprecated Use {@link area} instead. */
  areaFill?: boolean;
  /** Chart width (default: 140) */
  width?: number;
  /** Overall height (default: 48) */
  height?: number;
  /** Stroke width in CSS pixels (default: 1.5) */
  strokeWidth?: number;
  /** Show chart background gradient (default: true) */
  gradient?: boolean;
  /** Container style override */
  style?: CSSProperties;
}

function hexToRgba(color: string, alpha: number): string {
  if (color.startsWith('rgba')) return color;
  if (!color.startsWith('#')) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function computeChange(data: TimePoint[]): { value: number; pct: number; positive: boolean } {
  if (data.length < 2) return { value: 0, pct: 0, positive: true };
  const first = data[0].value;
  const last = data[data.length - 1].value;
  const diff = last - first;
  const pct = first !== 0 ? (diff / first) * 100 : 0;
  return { value: diff, pct, positive: diff >= 0 };
}

export function Sparkline({
  data,
  theme,
  variant = 'line',
  valuePosition = 'right',
  formatValue = formatCompact,
  label,
  sublabel,
  color,
  negativeColor,
  area,
  areaFill,
  flow,
  width = 140,
  height = 48,
  strokeWidth = 1.5,
  gradient = true,
  style,
}: SparklineProps) {
  // Default area-visible = true. `area` wins if caller passes it; otherwise
  // fall back to the deprecated flat `areaFill` flag for backward compatibility.
  const areaVisible = area?.visible ?? areaFill ?? true;
  const lastValue = data.length > 0 ? data[data.length - 1].value : 0;
  const change = useMemo(() => computeChange(data), [data]);

  const resolvedColor = color ?? theme.seriesColors[0];
  const resolvedNegColor = negativeColor ?? resolveCandlestickBodyColor(theme.candlestick.down.body);
  const changeColor = resolveCandlestickBodyColor(
    change.positive ? theme.candlestick.up.body : theme.candlestick.down.body,
  );

  // Self-stabilising Y bounds — never contract. Sparklines are tiny enough
  // that the chart's default auto-Y (visible min/max on every tick) reads
  // as a noticeable vertical "jump" when a streamed value is far from the
  // seen range, and every already-drawn point repositions with it. We
  // track a running min/max of all values we've seen, never shrink, and
  // hand the chart a padded version. Bounds settle within a few ticks for
  // bounded feeds (e.g. random in [-100, 100]); for drifting feeds they
  // creep outward to keep up. Reset across mounts via useRef — flow-mode
  // remounts get a fresh window.
  const boundsRef = useRef<{ min: number; max: number } | null>(null);
  const yBounds = useMemo(() => {
    if (data.length === 0) return undefined;

    let min = boundsRef.current?.min ?? Number.POSITIVE_INFINITY;
    let max = boundsRef.current?.max ?? Number.NEGATIVE_INFINITY;
    for (const p of data) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    boundsRef.current = { min, max };

    const range = max - min || Math.max(1, Math.abs(min));
    const pad = range * 0.2;

    return { min: min - pad, max: max + pad };
  }, [data]);

  // Captured-at-mount viewport for flow mode. Pins the latest seed point near
  // the RIGHT edge of the visible window (3-interval right pad, matching the
  // viewport default) with empty space stretching to the LEFT. New ticks
  // arrive at the right side and existing points slide LEFT — the "drive-in"
  // effect. Requires at least 2 seed points so `interval` can be inferred;
  // falls back to undefined otherwise (chart fits to data normally).
  // Subsequent renders don't recompute because ChartContainer ignores viewport
  // prop changes after mount.
  const viewport = useMemo(() => {
    if (!flow || data.length < 2) return undefined;

    const interval = data[1].time - data[0].time;
    if (interval <= 0) return undefined;

    const last = data[data.length - 1].time;
    const rightPad = 3 * interval;
    const to = last + rightPad;
    const from = to - flow.capacity * interval;

    return {
      maxVisibleBars: flow.capacity,
      initialRange: { from, to } as const,
    };
  }, []);

  const valueBlock = valuePosition !== 'none' && (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 1,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      {label && (
        <div
          style={{
            fontSize: theme.axis.fontSize,
            color: theme.axis.textColor,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          fontSize: theme.typography.fontSize + 3,
          fontWeight: 700,
          color: theme.tooltip.textColor,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatValue(lastValue)}
      </div>
      {sublabel !== undefined ? (
        <div
          style={{
            fontSize: theme.axis.fontSize - 1,
            color: theme.axis.textColor,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {sublabel}
        </div>
      ) : (
        <div
          style={{
            fontSize: theme.axis.fontSize - 1,
            fontWeight: 500,
            color: changeColor,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {change.positive ? '+' : ''}
          {change.pct.toFixed(1)}%
        </div>
      )}
    </div>
  );

  const chartBlock = (
    <div style={{ width, height, flexShrink: 0, borderRadius: 4, overflow: 'hidden' }}>
      <ChartContainer
        theme={theme}
        axis={{
          y: { visible: false, width: 0, min: yBounds?.min, max: yBounds?.max },
          x: { visible: false, height: 0 },
        }}
        padding={{ top: 5, right: 0, bottom: 0, left: 0 }}
        gradient={gradient}
        interactive={false}
        grid={{ visible: false }}
        viewport={viewport}
      >
        {variant === 'line' ? (
          <LineSeries
            data={[data]}
            options={{
              colors: [resolvedColor],
              strokeWidth,
              area: { visible: areaVisible },
              pulse: false,
              stacking: 'off',
            }}
          />
        ) : (
          <BarSeries
            data={[data]}
            options={{
              colors: [resolvedColor, resolvedNegColor],
              barWidthRatio: 0.7,
              stacking: 'off',
            }}
          />
        )}
      </ChartContainer>
    </div>
  );

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 8,
        background: hexToRgba(theme.tooltip.background, 0.7),
        border: `1px solid ${theme.tooltip.borderColor}`,
        fontFamily: theme.typography.fontFamily,
        ...style,
      }}
    >
      {valuePosition === 'left' && valueBlock}
      {chartBlock}
      {valuePosition === 'right' && valueBlock}
    </div>
  );
}
