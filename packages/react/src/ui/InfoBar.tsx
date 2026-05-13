import { type ReactNode, useLayoutEffect, useState } from 'react';

import {
  type OHLCData,
  type SeriesSnapshot,
  type TimePoint,
  type TooltipFormatter,
  buildHoverSnapshots,
  buildLastSnapshots,
  formatCompact,
  formatPriceAdaptive,
  formatTime,
  resolveCandlestickBodyColor,
} from '@wick-charts/core';

import { useChartInstance } from '../context';
import { useCrosshairPosition } from '../store-bridge';
import { useTheme } from '../ThemeContext';
import type { TooltipSort } from './Tooltip';

/** Context passed to the {@link InfoBar} render-prop. */
export interface InfoBarRenderContext {
  readonly snapshots: readonly SeriesSnapshot[];
  /** Timestamp displayed. In hover mode it's the crosshair time; in last-mode it's the newest point. */
  readonly time: number;
  /** `true` while the user's pointer is over the chart (hover mode). */
  readonly isHover: boolean;
}

/** Props for the {@link InfoBar} component. */
export interface InfoBarProps {
  /** Sort order for line values (default: 'none'). */
  sort?: TooltipSort;
  /**
   * Custom formatter for every displayed number in the default UI. Called per
   * cell with the field hint (`'open' | 'high' | 'low' | 'close' | 'volume' | 'value'`).
   * Defaults: adaptive precision for ohlc/value, compact (K/M/B/T) for volume.
   * Ignored when {@link children} is a render-prop.
   */
  format?: TooltipFormatter;
  /**
   * Render-prop escape hatch. Receives the computed snapshots and replaces the
   * entire built-in layout. Filter, reorder, or re-style rows here without
   * re-implementing any data wiring.
   */
  children?: (ctx: InfoBarRenderContext) => ReactNode;
}

/** Default InfoBar formatter — adaptive for ohlc/value, compact for volume. */
const defaultInfoBarFormat: TooltipFormatter = (v, field) =>
  field === 'volume' ? formatCompact(v) : formatPriceAdaptive(v);

/**
 * Compact OHLC/series info bar rendered as a flex row above the chart canvas.
 * Pairs with {@link Tooltip} (which then only renders its floating near-cursor part).
 *
 * Pass a render-prop child for a custom layout — the built-in UI is used when
 * {@link children} is omitted.
 */
export function InfoBar({ sort = 'none', format = defaultInfoBarFormat, children }: InfoBarProps) {
  const chart = useChartInstance();
  const theme = useTheme();
  const crosshair = useCrosshairPosition(chart);

  const [, bump] = useState(0);
  useLayoutEffect(() => {
    const onOverlayChange = () => bump((n) => n + 1);
    chart.on('overlayChange', onOverlayChange);
    // Catch-up: a sibling series' layout effect may have registered data in
    // the same commit. Bump so the next synchronous render picks it up.
    if (chart.getSeriesIds().length > 0) bump((n) => n + 1);

    return () => {
      chart.off('overlayChange', onOverlayChange);
    };
  }, [chart]);

  // Hover-over-the-y-axis gap: the overlay canvas includes the y-axis strip,
  // so a crosshair event fires for offsets past the plotted data. The
  // nearest-time lookup then snaps to an out-of-range timestamp and returns
  // no samples. Falling back to the last-mode snapshots here keeps the bar
  // populated (showing last values at 0.6 opacity) instead of blinking out
  // every time the pointer grazes the y-axis.
  const lastSnapshots = buildLastSnapshots(chart, { sort, cacheKey: 'infobar-last' });
  let snapshots = lastSnapshots;
  let displayTime = lastSnapshots.length === 0 ? 0 : Math.max(...lastSnapshots.map((s) => s.data.time));
  let isHover = false;
  if (crosshair !== null) {
    const hoverSnapshots = buildHoverSnapshots(chart, { time: crosshair.time, sort, cacheKey: 'infobar-hover' });
    if (hoverSnapshots.length > 0) {
      snapshots = hoverSnapshots;
      // `snapshots[0].data.time` is index-0 → shifts when `sort` reorders.
      // Use the raw crosshair time (what the user is pointing at) so the
      // header stays stable across sort toggles.
      displayTime = crosshair.time;
      isHover = true;
    }
  }

  // No data yet (initial mount, before the first series tick) — render a
  // zero-content placeholder *for the default UI only* so the header reserves
  // its real height from the very first paint. Without this the header grows
  // when InfoBar pops in, ChartContainer's header-measure observer fires
  // `setPadding`, and the canvas + axes visibly shift down on the next RAF.
  //
  // The render-prop variant (`children`) keeps the legacy "return null"
  // behavior — its layout depends on user-supplied JSX, so we can't
  // synthesise a meaningful placeholder.
  if (snapshots.length === 0) {
    if (children) return null;

    return (
      <div
        data-tooltip-legend=""
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          flexShrink: 0,
          fontSize: theme.typography.fontSize,
          fontFamily: theme.typography.fontFamily,
          fontVariantNumeric: 'tabular-nums',
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {/* Non-breaking space keeps line-height intact so the div claims its
            real rendered height instead of collapsing to padding-only. */}
        <span>&nbsp;</span>
      </div>
    );
  }

  if (children) {
    return (
      <div
        data-tooltip-legend=""
        style={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          fontFamily: theme.typography.fontFamily,
          fontSize: theme.typography.fontSize,
          fontVariantNumeric: 'tabular-nums',
          opacity: isHover ? 1 : 0.6,
          transition: 'opacity 0.2s ease',
          pointerEvents: 'none',
        }}
      >
        {children({ snapshots, time: displayTime, isHover })}
      </div>
    );
  }

  const dataInterval = chart.getDataInterval();

  return (
    <div
      data-tooltip-legend=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        padding: '4px 8px',
        flexShrink: 0,
        fontSize: theme.typography.fontSize,
        fontFamily: theme.typography.fontFamily,
        fontVariantNumeric: 'tabular-nums',
        opacity: isHover ? 1 : 0.6,
        transition: 'opacity 0.2s ease',
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: theme.axis.textColor, marginRight: 2 }}>{formatTime(displayTime, dataInterval)}</span>
      {snapshots.map((s) => {
        const isOHLC = 'open' in s.data;
        if (isOHLC) {
          const ohlc = s.data as OHLCData;
          const isUp = ohlc.close >= ohlc.open;
          const c = resolveCandlestickBodyColor(isUp ? theme.candlestick.up.body : theme.candlestick.down.body);
          return (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LegendItem label="O" display={format(ohlc.open, 'open')} color={c} dim={theme.axis.textColor} />
              <LegendItem label="H" display={format(ohlc.high, 'high')} color={c} dim={theme.axis.textColor} />
              <LegendItem label="L" display={format(ohlc.low, 'low')} color={c} dim={theme.axis.textColor} />
              <LegendItem label="C" display={format(ohlc.close, 'close')} color={c} dim={theme.axis.textColor} />
              {ohlc.volume != null && (
                <LegendItem
                  label="V"
                  display={format(ohlc.volume, 'volume')}
                  color={theme.axis.textColor}
                  dim={theme.axis.textColor}
                />
              )}
            </span>
          );
        }
        const line = s.data as TimePoint;

        return (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: s.color, fontWeight: 500 }}>{format(line.value, 'value')}</span>
          </span>
        );
      })}
    </div>
  );
}

function LegendItem({ label, display, color, dim }: { label: string; display: string; color: string; dim: string }) {
  return (
    <>
      <span style={{ color: dim, opacity: 0.5, marginLeft: 5 }}>{label}</span>
      <span style={{ color, fontWeight: 500, marginLeft: 2 }}>{display}</span>
    </>
  );
}
