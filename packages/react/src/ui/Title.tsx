import type { CSSProperties, ReactNode } from 'react';

import { useTheme } from '../ThemeContext';

/** Props for the {@link Title} component. */
export interface TitleProps {
  /** Primary label (e.g. "BTC/USD"). */
  children?: ReactNode;
  /**
   * Secondary label rendered in a muted colour next to the primary one (e.g.
   * "Live Candlestick", "1m", series count).
   */
  sub?: ReactNode;
  /** Extra styles merged onto the flex row. */
  style?: CSSProperties;
}

/**
 * Chart title / subtitle bar rendered as a flex row above the chart canvas
 * (above {@link InfoBar} when both are present). Hoisted out of the
 * overlay layer by {@link ChartContainer}, so browser flex layout reserves
 * its height and ResizeObserver drives a Y-range recompute.
 *
 * Place it at the top of a chart's children — its slot in the DOM is
 * determined by `ChartContainer`, not by source order:
 * ```tsx
 * <ChartContainer>
 *   <Title sub="Live Candlestick">BTC/USD</Title>
 *   <InfoBar />
 *   <CandlestickSeries data={data} />
 *   ...
 * </ChartContainer>
 * ```
 */
export function Title({ children, sub, style }: TitleProps) {
  const theme = useTheme();
  return (
    <div
      data-chart-title=""
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        padding: '6px 8px 0',
        flexShrink: 0,
        fontFamily: theme.typography.fontFamily,
        fontSize: theme.typography.fontSize,
        fontWeight: 600,
        color: theme.tooltip.textColor,
        pointerEvents: 'none',
        ...style,
      }}
    >
      {children != null && children !== false && <span>{children}</span>}
      {sub != null && sub !== false && (
        <span style={{ fontWeight: 400, color: theme.axis.textColor, fontSize: theme.axis.fontSize }}>
          {sub}
        </span>
      )}
    </div>
  );
}
