// One-paragraph hand-authored intros per component. The auto-generated
// description from the React function's JSDoc is preferred when present;
// this file is the fallback so every API page has a real lead.

export const INTROS: Record<string, string> = {
  // chart series
  LineSeries:
    'Renders one or more line/area layers from time-series data. Each entry in the `data` array becomes a separate stroked path (and optional gradient fill) sharing the same axes and stacking mode. Pass series options via `options` — they merge with the chart-level defaults.',
  BarSeries:
    'Renders bar/column layers. Supports stacked, percent-stacked, and overlapping modes via `options.stacking`. Bar width is computed from the data interval; tweak `options.barWidthRatio` if your bars look too tight or too sparse.',
  CandlestickSeries:
    'Renders OHLC candles with optional volume bars. The default body colour is direction-driven (up/down) but accepts a `bodyColor` callback for custom rules. Wicks render at sub-pixel widths on hi-DPI displays for a sharp look at any zoom.',
  PieSeries:
    'Renders a pie or donut chart. Slices animate on enter/exit, support hover lift, and optionally show inline labels at the slice midpoints. Use `<PieLegend>` and `<PieTooltip>` for accompanying overlays.',
  Sparkline:
    'A self-contained miniature chart for tables, KPIs, and dashboards. Renders without any of the chrome (`<YAxis>`, `<TimeAxis>`, etc.) and includes a lightweight value badge.',

  // subcomponents
  ChartContainer:
    'The root component every chart starts with. Provides theme, axis configuration, padding, and the canvas; collects series and overlays from its children. Use `viewport={{ maxVisibleBars, initialRange }}` to size the streaming window and apply an initial zoom *before* the first paint (same shape as the imperative `chart.setVisibleRange`).',
  TimeAxis:
    'Renders tick marks and labels along the time axis. Density adapts to viewport width and is bounded by the `labelCount` and `minLabelSpacing` props (which override the chart-level defaults).',
  YAxis:
    'Renders ticks and labels along the right edge of the chart. The 1-2-5 “nice number” snap keeps tick values readable at any zoom; pass `format` to customise the label string.',
  Tooltip:
    'Floating glass panel that appears on hover, showing per-series snapshots at the crosshair time. Use the render-prop child to replace the panel contents while keeping the positioned container (with flip/clamp).',
  Crosshair:
    'Vertical/horizontal guide lines plus a value badge that follow the pointer. Has no props — it inherits everything from the chart theme.',
  Legend:
    'Series legend with three interaction modes: `toggle` (click hides), `solo` (click isolates), `isolate` (click hides others). Use the render-prop child for fully custom rendering.',
  Navigator:
    'Mini overview strip showing the full series with a draggable zoom window. Pan, resize, and double-click to reset the visible range.',
  Title:
    'Chart title and optional subtitle. Renders inline above the canvas (or as an overlay, depending on `headerLayout` on `<ChartContainer>`).',
  InfoBar:
    'Persistent header strip showing the last-known values from each series, including direction arrows and percent change. Stays visible when no hover is active — the companion to `<Tooltip>`.',
  PieLegend:
    'Companion to `<PieSeries>` — renders slice labels with their value or percent, anchored to one of three positions (`bottom`, `right`, `overlay`).',
  PieTooltip:
    'Hover tooltip for `<PieSeries>`. Behaves like `<Tooltip>` but takes a `seriesId` and exposes the active slice in the render-prop.',
  NumberFlow:
    'Animated number ticker. Spins between values with configurable duration. Used internally by `<YLabel>` and the InfoBar percent-change badge — also exported for custom UI.',
  YLabel:
    'Floating price badge anchored to the last data point of a series. Pulses with the data and animates value transitions via `NumberFlow`.',
};
