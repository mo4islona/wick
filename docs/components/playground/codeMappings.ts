import { type AnimationsConfig, hermite, snap, spring } from '@wick-charts/react';

import type { PropValue } from '../CodePreview';
import type { PlaygroundChartProps } from './Playground';

export type CartesianSeriesKind = 'line' | 'bar' | 'candle';

const AXIS_Y_WIDTH_DEFAULT = 55;
const AXIS_X_HEIGHT_DEFAULT = 30;

// Defaults — keep in sync with `packages/core/src/animation/config.ts`.
// Sliders compare against these and only emit non-default fields so the
// rendered code snippet stays minimal.
const DEFAULTS = {
  // Per-series-type durations
  candleEntryMs: 250,
  candleSmoothMs: 250,
  barEntryMs: 250,
  barSmoothMs: 250,
  lineEntryMs: 250,
  lineSmoothMs: 250,
  linePulseMs: 600,
  pieEntryMs: 250,
  pieUpdateMs: 250,
  // X axis
  xCurve: 'spring' as const,
  xSettleMs: 200,
  xGestureMs: 150,
  // Y axis
  yCurve: 'hermite' as const,
  ySettleMs: 250,
  yStickyMs: 2500,
  yGestureMs: 100,
  // Cross-cutting
  ticksMs: 250,
  toggleMs: 250,
} as const;

const ENTRY_ANIM_DEFAULT: Record<CartesianSeriesKind, string> = {
  line: 'grow',
  bar: 'fade-grow',
  candle: 'unfold',
};

// Module-level memoization so factory references stay stable across renders.
// Runtime consumers (ChartContainer's animations effect) compare by reference;
// a fresh factory each render would either thrash the animator or be ignored.
const Y_CURVE_FACTORIES = {
  hermite: hermite(),
  spring: spring(),
  snap: snap(),
} as const;
const X_CURVE_FACTORIES = {
  spring: spring(),
  snap: snap(),
} as const;

// ── Shared series-block emitters ─────────────────────────────────────

function nonEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function pickLineBlock(s: PlaygroundChartProps): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  if (s.lineEntryMs !== DEFAULTS.lineEntryMs) out.entry = s.lineEntryMs;
  if (s.lineSmoothMs !== DEFAULTS.lineSmoothMs) out.smooth = s.lineSmoothMs;
  if (s.linePulseMs !== DEFAULTS.linePulseMs) out.pulse = s.linePulseMs;

  return nonEmpty(out);
}

function pickCandleBlock(s: PlaygroundChartProps): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  if (s.candleEntryMs !== DEFAULTS.candleEntryMs) out.entry = s.candleEntryMs;
  if (s.candleSmoothMs !== DEFAULTS.candleSmoothMs) out.smooth = s.candleSmoothMs;

  return nonEmpty(out);
}

function pickBarBlock(s: PlaygroundChartProps): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  if (s.barEntryMs !== DEFAULTS.barEntryMs) out.entry = s.barEntryMs;
  if (s.barSmoothMs !== DEFAULTS.barSmoothMs) out.smooth = s.barSmoothMs;

  return nonEmpty(out);
}

function pickPieBlock(s: PlaygroundChartProps): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  if (s.pieEntryMs !== DEFAULTS.pieEntryMs) out.entry = s.pieEntryMs;
  if (s.pieUpdateMs !== DEFAULTS.pieUpdateMs) out.update = s.pieUpdateMs;

  return nonEmpty(out);
}

function pickSeries(s: PlaygroundChartProps): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const line = pickLineBlock(s);
  const candle = pickCandleBlock(s);
  const bar = pickBarBlock(s);
  const pie = pickPieBlock(s);
  if (line) out.line = line;
  if (candle) out.candlestick = candle;
  if (bar) out.bar = bar;
  if (pie) out.pie = pie;

  return nonEmpty(out);
}

// ── Axis-block emitters ──────────────────────────────────────────────

/**
 * Build an axis block. `curveAs` controls how the curve factory is encoded:
 * - `'string'` — bare identifier string like `'spring()'`, used by the static
 *   code-preview path (rendered as a function call via VAR_REF_NAMES).
 * - `'factory'` — the actual memoized factory instance, used by the runtime
 *   `animations` prop.
 */
function pickXAxis(s: PlaygroundChartProps, curveAs: 'string' | 'factory'): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (s.xCurve !== DEFAULTS.xCurve) {
    out.curve = curveAs === 'factory' ? X_CURVE_FACTORIES[s.xCurve] : `${s.xCurve}()`;
  }
  if (s.xSettleMs !== DEFAULTS.xSettleMs) out.settle = s.xSettleMs;
  if (s.xGestureMs !== DEFAULTS.xGestureMs) out.gesture = s.xGestureMs;

  return nonEmpty(out);
}

function pickYAxis(s: PlaygroundChartProps, curveAs: 'string' | 'factory'): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (s.yCurve !== DEFAULTS.yCurve) {
    out.curve = curveAs === 'factory' ? Y_CURVE_FACTORIES[s.yCurve] : `${s.yCurve}()`;
  }
  if (s.ySettleMs !== DEFAULTS.ySettleMs) out.settle = s.ySettleMs;
  if (s.yStickyMs !== DEFAULTS.yStickyMs) out.sticky = s.yStickyMs;
  if (s.yGestureMs !== DEFAULTS.yGestureMs) out.gesture = s.yGestureMs;

  return nonEmpty(out);
}

function pickAxis(s: PlaygroundChartProps, curveAs: 'string' | 'factory'): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const y = pickYAxis(s, curveAs);
  const x = pickXAxis(s, curveAs);
  if (y) out.y = y;
  if (x) out.x = x;
  if (s.ticksMs !== DEFAULTS.ticksMs) out.ticks = s.ticksMs;

  return nonEmpty(out);
}

function pickAnimations(s: PlaygroundChartProps, curveAs: 'string' | 'factory'): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const series = pickSeries(s);
  const axis = pickAxis(s, curveAs);
  if (axis) out.axis = axis;
  if (series) out.series = series;
  if (s.toggleMs !== DEFAULTS.toggleMs) out.toggle = s.toggleMs;

  return nonEmpty(out);
}

/**
 * Build ChartContainer props shared across cartesian playground pages.
 * Emits only fields that differ from library defaults so the snippet stays minimal —
 * a user toggling nothing still sees the cleanest possible `<ChartContainer theme={...}>`.
 */
export function buildCartesianContainerProps(s: PlaygroundChartProps): Record<string, PropValue> | undefined {
  const out: Record<string, PropValue> = {};

  if (!s.grid.visible) out.grid = { visible: false };
  if (!s.gradient) out.gradient = false;
  if (s.headerLayout !== 'overlay') out.headerLayout = s.headerLayout;

  const y: Record<string, PropValue> = {};
  if (s.axis?.y?.width !== undefined && s.axis.y.width !== AXIS_Y_WIDTH_DEFAULT) {
    y.width = s.axis.y.width;
  }
  if (s.axis?.y?.min !== undefined) y.min = s.axis.y.min as PropValue;
  if (s.axis?.y?.max !== undefined) y.max = s.axis.y.max as PropValue;

  const x: Record<string, PropValue> = {};
  if (s.axis?.x?.height !== undefined && s.axis.x.height !== AXIS_X_HEIGHT_DEFAULT) {
    x.height = s.axis.x.height;
  }

  const axis: Record<string, PropValue> = {};
  if (Object.keys(y).length > 0) axis.y = y;
  if (Object.keys(x).length > 0) axis.x = x;
  if (Object.keys(axis).length > 0) out.axis = axis;

  const animations = pickAnimations(s, 'string');
  if (animations) out.animations = animations as PropValue;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build a runtime `animations` prop for `<ChartContainer animations={...}>`.
 * Returns `undefined` when every field matches the library default so callers
 * can omit the prop entirely (and the rendered code snippet stays clean).
 */
export function buildAnimationsProp(s: PlaygroundChartProps): AnimationsConfig | undefined {
  return pickAnimations(s, 'factory') as AnimationsConfig | undefined;
}

/**
 * Build series `options` fragment for fields shared across cartesian series
 * (entry animation, and `pulse` toggle for line during streaming).
 * Callers merge this with series-specific options.
 */
export function buildCommonSeriesOptions(
  s: PlaygroundChartProps,
  kind: CartesianSeriesKind,
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};

  const anim = kind === 'line' ? s.lineEntryAnimation : kind === 'bar' ? s.barEntryAnimation : s.candleEntryAnimation;
  if (anim !== ENTRY_ANIM_DEFAULT[kind]) out.entryAnimation = anim;

  // Per-series duration overrides aren't emitted here — they fold into the
  // chart-level `animations.series.{kind}.*` block via `buildAnimationsProp`,
  // which keeps the rendered snippet single-source-of-truth and matches the
  // way the public API is documented.
  if (kind === 'line' && s.streaming) out.pulse = true;

  return out;
}

const NAVIGATOR_HEIGHT_DEFAULT = 60;

export type NavigatorDataType = 'line' | 'bar' | 'candlestick';

/**
 * Build the Navigator code-preview component entry when the user enabled it.
 * `pointsVar` is the variable name displayed for the `points` prop — usually
 * `'data'` for line/bar pages and `'closePoints'` for candlestick (since the
 * miniature is derived from `close` values). `dataType` controls the rendered
 * `type:` field.
 */
export function buildNavigatorComponent(
  s: PlaygroundChartProps,
  pointsVar: string,
  dataType: NavigatorDataType = 'line',
): { component: string; props: Record<string, PropValue> }[] {
  if (!s.navigatorVisible) return [];
  const props: Record<string, PropValue> = {
    data: { type: dataType, points: pointsVar } as unknown as PropValue,
  };
  if (s.navigatorHeight !== NAVIGATOR_HEIGHT_DEFAULT) props.height = s.navigatorHeight;

  return [{ component: 'Navigator', props }];
}
