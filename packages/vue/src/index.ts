/**
 * @wick-charts/vue — Vue bindings for Wick Charts.
 *
 * Everything importable from the library is re-exported here: components
 * (`<ChartContainer>`, `<CandlestickSeries>`, …), option types, and themes.
 * The underlying `@wick-charts/core` engine is bundled into this package —
 * its source lives at
 * https://github.com/mo4islona/wick-charts/tree/main/packages/core/src.
 */

export type {
  AxisBound,
  AxisConfig,
  BarSeriesOptions,
  /** @deprecated Use {@link StackingMode} instead. */
  BuildHoverSnapshotsArgs,
  BuildLastSnapshotsArgs,
  CandlestickSeriesOptions,
  ChartLayout,
  ChartOptions,
  ChartTheme,
  CrosshairPosition,
  HoverInfo,
  LegendItem,
  /** @deprecated Use {@link TimePoint} instead. */
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
  lavenderMist,
  lightPink,
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

export { default as BarSeries } from './BarSeries.vue';
export { default as CandlestickSeries } from './CandlestickSeries.vue';
// Vue components
export { default as ChartContainer } from './ChartContainer.vue';
export { useCrosshairPosition, useLastYValue, usePreviousClose, useVisibleRange, useYRange } from './composables';
// Composables and context
export { useChartInstance, useTheme } from './context';
export { default as LineSeries } from './LineSeries.vue';
export { default as PieSeries } from './PieSeries.vue';
export { default as Crosshair } from './ui/Crosshair.vue';
export { default as InfoBar } from './ui/InfoBar.vue';
export { default as Legend } from './ui/Legend.vue';
export { default as Navigator } from './ui/Navigator.vue';
export { default as NumberFlow } from './ui/NumberFlow.vue';
export { default as PieLegend } from './ui/PieLegend.vue';
export { default as PieTooltip } from './ui/PieTooltip.vue';
export { default as TimeAxis } from './ui/TimeAxis.vue';
export { default as Title } from './ui/Title.vue';
// UI overlays
export { default as Tooltip } from './ui/Tooltip.vue';
export { default as YAxis } from './ui/YAxis.vue';
export { default as YLabel } from './ui/YLabel.vue';
