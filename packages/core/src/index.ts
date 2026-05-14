// Chart

export type {
  BuiltinEngineOptions,
  YEngineContext,
  YEngineFactory,
  YRangeAnimatorLike,
} from './animation';
// Y-bound animator factories. Built-ins live in separate modules so unused
// engines tree-shake out — import only the one you need.
export { hermiteAnimator } from './animation/hermite-animator';
export { snapAnimator } from './animation/snap-animator';
export { springAnimator } from './animation/spring-animator';
export type { AnimationsConfig, ChartOptions, EdgeReachedInfo, EdgeSide, EdgeState } from './chart';
export { ChartInstance } from './chart';
// Overlay primitives — helpers, types, and positioning used by framework overlays
export type { LegendItem } from './legend';
export type {
  NavigatorCandlePoint,
  NavigatorControllerParams,
  NavigatorData,
  NavigatorLinePoint,
  NavigatorOptions,
  NavigatorSeriesType,
} from './navigator';
// Navigator
export { NavigatorController } from './navigator';
// Performance instrumentation
export type { FrameKind, PercentileSample, PerfMonitorOptions, PerfStats } from './perf';
export { PerfMonitor } from './perf';
// Tick fade tracker (read-only types — instances live on chart.timeScale/yScale)
export type { TickEntry, TickTrackerSnapshot } from './scales/tick-tracker';
export { AxisTickTracker } from './scales/tick-tracker';
export type { HoverInfo, SliceInfo } from './series/types';
export type {
  BuildHoverSnapshotsArgs,
  BuildLastSnapshotsArgs,
  SeriesSnapshot,
  SnapshotSort,
} from './snapshots';
export { buildHoverSnapshots, buildLastSnapshots } from './snapshots';
// Data
export { darkTheme } from './theme/dark';
export { lightTheme } from './theme/light';
export type { ThemeConfig, ThemePreset } from './theme/palettes';
export { autoGradient, createTheme, isDarkBg } from './theme/palettes';
export { resolveAxisFontSize, resolveAxisTextColor, resolveCandlestickBodyColor } from './theme/resolve';
export {
  andromeda,
  ayuMirage,
  catppuccin,
  dracula,
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
  oneDarkPro,
  panda,
  peachCream,
  quietLight,
  rosePineDawn,
  sandDune,
  solarizedLight,
} from './theme/themes';
// Theme
export type { ChartTheme, Typography } from './theme/types';
export type { TooltipPosition, TooltipPositionArgs } from './tooltip-position';
export { computeTooltipPosition } from './tooltip-position';
// Types
export type {
  AxisBound,
  AxisConfig,
  BarSeriesOptions,
  /** @deprecated Use {@link StackingMode} instead. */
  BarStacking,
  CandlestickSeriesOptions,
  ChartLayout,
  CrosshairPosition,
  /** @deprecated Use {@link TimePoint} instead. */
  LineData,
  LineSeriesOptions,
  OHLCData,
  OHLCInput,
  PieLabelsOptions,
  PieSeriesOptions,
  PieSliceData,
  SeriesType,
  StackingMode,
  TimePoint,
  TimePointInput,
  TimeValue,
  VisibleRange,
  VisibleRangeSpec,
  XAxisConfig,
  YAxisConfig,
  YRange,
} from './types';
// Utils
export type { TooltipField, TooltipFormatter, ValueFormatter } from './utils/format';
export { formatCompact, formatPriceAdaptive } from './utils/format';
export { detectInterval, formatDate, formatTime, normalizeTime } from './utils/time';
export type { HorizontalPadding } from './viewport';
