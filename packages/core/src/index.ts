// Chart

export type { AnimationTime, Milliseconds } from './animation/time';
export { parseAnimationTime } from './animation/time';
// Y-bound transition contract.
export type { RetargetOptions, Transition, TransitionContext, TransitionFactory } from './animation/transition';
// Push-model viewport state machine — owns X / Y range animation and exposes
// `getAnimationState` / `getTarget` / `getSettleAt` to renderers and scales.
export {
  type AnimationState,
  type PanZoomOptions,
  type ProgrammaticZoomOptions,
  type SnapTarget,
  type ViewportEngine,
  type ViewportEngineOptions,
  createViewportEngine,
} from './animation/viewport-engine';
// Built-in Y transitions. Each factory lives in its own module so unused
// curves tree-shake out — import only the ones you need.
export { type HermiteOpts, hermite } from './animation/y-range-hermite';
export { snap } from './animation/y-range-snap';
export { type SpringOpts, spring } from './animation/y-range-spring';
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
export { AxisTickTracker, computeTickFadeDiff } from './scales/tick-tracker';
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
