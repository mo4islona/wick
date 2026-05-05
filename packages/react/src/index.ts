/**
 * @wick-charts/react — React bindings for Wick Charts.
 *
 * Everything importable from the library is re-exported here: components
 * (`<ChartContainer>`, `<CandlestickSeries>`, …), option types, utility
 * hooks, and themes. The underlying `@wick-charts/core` engine is bundled
 * into this package — its source lives at
 * https://github.com/mo4islona/wick-charts/tree/main/packages/core/src.
 */

export type {
  AnimationsConfig,
  AxisBound,
  AxisConfig,
  BarSeriesOptions,
  /** @deprecated Use {@link StackingMode} instead. */
  BarStacking,
  BuildHoverSnapshotsArgs,
  BuildLastSnapshotsArgs,
  CandlestickSeriesOptions,
  ChartLayout,
  ChartOptions,
  ChartTheme,
  CrosshairPosition,
  EdgeReachedInfo,
  EdgeSide,
  EdgeState,
  HoverInfo,
  LegendItem,
  /** @deprecated Use {@link TimePoint} instead. */
  LineData,
  LineSeriesOptions,
  NavigatorCandlePoint,
  NavigatorControllerParams,
  NavigatorData,
  NavigatorLinePoint,
  NavigatorOptions,
  NavigatorSeriesType,
  OHLCData,
  OHLCInput,
  PieSeriesOptions,
  PieSliceData,
  SeriesSnapshot,
  SeriesType,
  SliceInfo,
  SnapshotSort,
  StackingMode,
  ThemeConfig,
  ThemePreset,
  TimePoint,
  TimePointInput,
  TimeValue,
  TooltipField,
  TooltipFormatter,
  TooltipPosition,
  TooltipPositionArgs,
  Typography,
  ValueFormatter,
  VisibleRange,
  XAxisConfig,
  YAxisConfig,
  YRange,
} from '@wick-charts/core';
export {
  ChartInstance,
  NavigatorController,
  andromeda,
  autoGradient,
  ayuMirage,
  buildHoverSnapshots,
  buildLastSnapshots,
  catppuccin,
  computeTooltipPosition,
  createTheme,
  darkTheme,
  detectInterval,
  dracula,
  formatCompact,
  formatDate,
  formatPriceAdaptive,
  formatTime,
  githubLight,
  gruvbox,
  handwritten,
  highContrast,
  isDarkBg,
  lavenderMist,
  lightPink,
  lightTheme,
  materialPalenight,
  minimalLight,
  mintBreeze,
  monokaiPro,
  nightOwl,
  normalizeTime,
  oneDarkPro,
  panda,
  peachCream,
  quietLight,
  resolveAxisFontSize,
  resolveAxisTextColor,
  resolveCandlestickBodyColor,
  rosePineDawn,
  sandDune,
  solarizedLight,
} from '@wick-charts/core';

export { BarSeries } from './BarSeries';
export { CandlestickSeries } from './CandlestickSeries';
// React components
export { ChartContainer } from './ChartContainer';
// React hooks
export { useChartInstance } from './context';
export type { EdgeLoaderProps, EdgeLoaderRenderArgs } from './EdgeLoader';
export { EdgeLoader } from './EdgeLoader';
export { LineSeries } from './LineSeries';
export { PieSeries } from './PieSeries';
export {
  useCrosshairPosition,
  useLastYValue,
  usePreviousClose,
  useVisibleRange,
  useYRange,
} from './store-bridge';
export { ThemeProvider, useTheme } from './ThemeContext';
export { Crosshair } from './ui/Crosshair';
export type { InfoBarProps, InfoBarRenderContext } from './ui/InfoBar';
export { InfoBar } from './ui/InfoBar';
export type { LegendItemOverride, LegendProps } from './ui/Legend';
// Legend
export { Legend } from './ui/Legend';
export type { NavigatorProps } from './ui/Navigator';
export { Navigator } from './ui/Navigator';
export { NumberFlow } from './ui/NumberFlow';
export type { PieLegendMode, PieLegendPosition, PieLegendProps, PieLegendRenderContext } from './ui/PieLegend';
export { PieLegend } from './ui/PieLegend';
export { PieTooltip } from './ui/PieTooltip';
export type { SparklineProps, SparklineValuePosition, SparklineVariant } from './ui/Sparkline';
export { Sparkline } from './ui/Sparkline';
export { TimeAxis, TimeAxis as XAxis } from './ui/TimeAxis';
export type { TitleProps } from './ui/Title';
export { Title } from './ui/Title';
export type { TooltipProps, TooltipRenderContext, TooltipSort } from './ui/Tooltip';
// UI overlays
export { Tooltip } from './ui/Tooltip';
export type { YAxisProps } from './ui/YAxis';
export { YAxis } from './ui/YAxis';
export { YLabel } from './ui/YLabel';
