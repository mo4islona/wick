import type { ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────

export type GridStyle = 'solid' | 'dashed' | 'dotted';
export type HeaderLayout = 'overlay' | 'inline';

export type CandleEntryAnim = 'fade' | 'unfold' | 'slide' | 'fade-unfold' | 'none';
export type BarEntryAnim = 'fade' | 'grow' | 'fade-grow' | 'slide' | 'none';
export type LineEntryAnim = 'grow' | 'fade' | 'none';

export type AnimationKind = 'candle' | 'bar' | 'line' | 'pie';

/** X / Y transition factory selector. Spring is critically-damped physics, hermite is a
 *  fixed-duration cubic, snap disables the easing entirely. */
export type AxisCurve = 'hermite' | 'spring' | 'snap';

/**
 * Flat state shared by every playground page. Nested library shapes
 * (`grid.visible`, `area.visible`, `animations.axis.y.curve`, …) are assembled
 * by the translation layer in `Playground.tsx` and the runtime emitter in
 * `codeMappings.ts`; panel rows always index by flat key so reset and
 * active-count math stay a trivial `state[k] !== defaults[k]` comparison.
 */
export interface CommonState {
  streaming: boolean;
  perfHudVisible: boolean;
  // Grid
  gridVisible: boolean;
  gridStyle: GridStyle;
  // Background
  bgGradient: boolean;
  headerLayout: HeaderLayout;
  // Axes
  yAxisVisible: boolean;
  xAxisVisible: boolean;
  yAxisWidth: number;
  xAxisHeight: number;
  minBound: string;
  maxBound: string;

  // ── Animations: per-kind entry style + durations ────────────────────
  candleEntryAnimation: CandleEntryAnim;
  barEntryAnimation: BarEntryAnim;
  lineEntryAnimation: LineEntryAnim;
  /** `series.candlestick.entry` — per-candle entrance duration. */
  candleEntryMs: number;
  /** `series.candlestick.smooth` — OHLC chase duration on data updates. */
  candleSmoothMs: number;
  /** `series.bar.entry` — per-bar entrance duration. */
  barEntryMs: number;
  /** `series.bar.smooth` — value chase duration on data updates. */
  barSmoothMs: number;
  /** `series.line.entry` — per-point entrance duration. */
  lineEntryMs: number;
  /** `series.line.smooth` — last-value chase time-constant. */
  lineSmoothMs: number;
  /** `series.line.pulse` — halo cycle period at the line tail. 0 disables. */
  linePulseMs: number;
  /** `series.pie.entry` — slice grow-in duration (currently no-op in core, parsed). */
  pieEntryMs: number;
  /** `series.pie.update` — slice resize duration (currently no-op in core, parsed). */
  pieUpdateMs: number;

  // ── Animations: X axis (viewport horizontal) ────────────────────────
  /** `axis.x.curve` — spring keeps velocity across ticks; snap disables easing. */
  xCurve: 'spring' | 'snap';
  /** `axis.x.settle` — streaming retarget baseline. EMA tunes this at runtime. */
  xSettleMs: number;
  /** `axis.x.gesture` — pan/zoom commit override (per-event ease). */
  xGestureMs: number;

  // ── Animations: Y axis (viewport vertical) ──────────────────────────
  /** `axis.y.curve` — hermite (default) / spring / snap. */
  yCurve: AxisCurve;
  /** `axis.y.settle` — outward chase to a new extreme. */
  ySettleMs: number;
  /** `axis.y.sticky` — inward contraction after an extreme leaves (sticky-Y feel). */
  yStickyMs: number;
  /** `axis.y.gesture` — Y override during gestures (frame-per-tick interactive feel). */
  yGestureMs: number;

  // ── Animations: cross-cutting ───────────────────────────────────────
  /** `axis.ticks` — tick-label cross-fade duration. */
  ticksMs: number;
  /** `toggle` — series-visibility fade + Y re-fit duration. */
  toggleMs: number;

  // Navigator
  navigatorVisible: boolean;
  navigatorHeight: number;
}

export const COMMON_DEFAULTS: CommonState = {
  streaming: true,
  perfHudVisible: false,
  gridVisible: true,
  gridStyle: 'solid',
  bgGradient: true,
  headerLayout: 'overlay',
  yAxisVisible: true,
  xAxisVisible: true,
  yAxisWidth: 55,
  xAxisHeight: 30,
  minBound: 'auto',
  maxBound: 'auto',
  // Numbers mirror DEFAULT_* constants in `packages/core/src/animation/config.ts`.
  // Keep them in sync — "active count" math compares state[k] !== defaults[k].
  candleEntryAnimation: 'unfold',
  barEntryAnimation: 'fade-grow',
  lineEntryAnimation: 'grow',
  candleEntryMs: 250,
  candleSmoothMs: 250,
  barEntryMs: 250,
  barSmoothMs: 250,
  lineEntryMs: 250,
  lineSmoothMs: 250,
  linePulseMs: 600,
  pieEntryMs: 250,
  pieUpdateMs: 250,
  xCurve: 'spring',
  xSettleMs: 200,
  xGestureMs: 150,
  yCurve: 'hermite',
  ySettleMs: 250,
  yStickyMs: 2500,
  yGestureMs: 100,
  ticksMs: 250,
  toggleMs: 250,
  navigatorVisible: false,
  navigatorHeight: 60,
};

// ── Row/Section spec types ───────────────────────────────────

export type RowSpec<V = unknown> = {
  key: string;
  label: string;
  hint?: string;
  render: (v: V, onChange: (v: V) => void) => ReactNode;
  /** Optional visibility predicate evaluated against the full flat state. */
  visible?: (state: Record<string, unknown>) => boolean;
  /** Column span inside the 2-col section grid. 1 = half-width (pairs with sibling), 2 = full row. Default 2. */
  span?: 1 | 2;
  /**
   * Visual sub-header label rendered above this row when it starts a new group
   * (i.e. previous visible row had a different / no group). Used by the
   * Animations section to break its rows into Series / X axis / Y axis / Other
   * blocks while still living inside a single collapsible section.
   */
  group?: string;
};

export type SectionSpec = {
  id: string;
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  rows: RowSpec[];
  /** When set, this section's rows are appended to the built-in section with that id. */
  extend?: string;
};
