import type { ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────

export type GridStyle = 'solid' | 'dashed' | 'dotted';
export type HeaderLayout = 'overlay' | 'inline';

export type CandleEntryAnim = 'fade' | 'unfold' | 'slide' | 'fade-unfold' | 'none';
export type BarEntryAnim = 'fade' | 'grow' | 'fade-grow' | 'slide' | 'none';
export type LineEntryAnim = 'grow' | 'fade' | 'none';

export type AnimationKind = 'candle' | 'bar' | 'line';

/**
 * Flat state shared by every playground page. Nested library shapes
 * (`grid.visible`, `area.visible`, etc.) are assembled by the translation
 * layer in Playground.tsx; panel rows always index by flat key so reset and
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
  // Animations — points category
  candleEntryAnimation: CandleEntryAnim;
  barEntryAnimation: BarEntryAnim;
  lineEntryAnimation: LineEntryAnim;
  /** Per-point entrance duration (ms). 0 disables. */
  entryMs: number;
  /** Last-value chase time-constant on `updateData` ticks (ms). 0 snaps. */
  smoothMs: number;
  /** Pulse cycle period for the line halo (ms). 0 disables. */
  pulseMs: number;
  // Animations — viewport category
  /** Post-gesture rebound duration (ms). 0 snaps. */
  reboundMs: number;
  /** Y-range chase scale (ms). 0 snaps. */
  yAxisMs: number;
  /** Per-event ease for pan/zoom commits (ms). 0 = instant apply (default). */
  inputResponseMs: number;
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
  candleEntryAnimation: 'unfold',
  barEntryAnimation: 'fade-grow',
  lineEntryAnimation: 'grow',
  // Coordinated defaults — entrance, smoothing, Y chase, rebound all share
  // 250 ms so streaming ticks settle in lockstep across X, Y, and last-bar
  // live-track. Pulse stays at its own period; input ease stays opt-in (0).
  entryMs: 250,
  smoothMs: 250,
  pulseMs: 600,
  reboundMs: 250,
  yAxisMs: 250,
  inputResponseMs: 0,
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
