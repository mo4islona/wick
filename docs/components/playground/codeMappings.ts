import type { AnimationsConfig } from '@wick-charts/react';

import type { PropValue } from '../CodePreview';
import type { PlaygroundChartProps } from './Playground';

export type CartesianSeriesKind = 'line' | 'bar' | 'candle';

const AXIS_Y_WIDTH_DEFAULT = 55;
const AXIS_X_HEIGHT_DEFAULT = 30;
// Coordinated default for every settling animation — must match
// `DEFAULT_ANIMATION_MS` in packages/core/src/animation-constants.ts.
const SHARED_ANIMATION_MS_DEFAULT = 250;
const ENTRY_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const SMOOTH_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const PULSE_MS_DEFAULT = 600;
const REBOUND_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const Y_AXIS_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const INPUT_RESPONSE_MS_DEFAULT = 0;
const ENTRY_ANIM_DEFAULT: Record<CartesianSeriesKind, string> = {
  line: 'grow',
  bar: 'fade-grow',
  candle: 'unfold',
};

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

  // Chart-level animation overrides — emitted only when they differ from
  // library defaults so the snippet stays minimal. Per-series knobs
  // (entryAnimation/entryMs/smoothMs/pulse) flow through the series
  // options builder instead.
  const points: Record<string, PropValue> = {};
  if (s.entryMs !== ENTRY_MS_DEFAULT) points.enterMs = s.entryMs;
  if (s.smoothMs !== SMOOTH_MS_DEFAULT) points.smoothMs = s.smoothMs;
  if (s.pulseMs !== PULSE_MS_DEFAULT) points.pulseMs = s.pulseMs;

  const viewport: Record<string, PropValue> = {};
  if (s.reboundMs !== REBOUND_MS_DEFAULT) viewport.reboundMs = s.reboundMs;
  if (s.yAxisMs !== Y_AXIS_MS_DEFAULT) viewport.yAxisMs = s.yAxisMs;
  if (s.inputResponseMs !== INPUT_RESPONSE_MS_DEFAULT) viewport.inputResponseMs = s.inputResponseMs;

  const animations: Record<string, PropValue> = {};
  if (Object.keys(points).length > 0) animations.points = points;
  if (Object.keys(viewport).length > 0) animations.viewport = viewport;
  if (Object.keys(animations).length > 0) out.animations = animations;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build a runtime `animations` prop for `<ChartContainer animations={...}>`.
 * Returns `undefined` when every field matches the library default so callers
 * can omit the prop entirely (and the rendered code snippet stays clean).
 */
export function buildAnimationsProp(s: PlaygroundChartProps): AnimationsConfig | undefined {
  const points: AnimationsConfig['points'] extends infer T ? T : never =
    s.entryMs === ENTRY_MS_DEFAULT && s.smoothMs === SMOOTH_MS_DEFAULT && s.pulseMs === PULSE_MS_DEFAULT
      ? undefined
      : {
          ...(s.entryMs !== ENTRY_MS_DEFAULT ? { enterMs: s.entryMs } : {}),
          ...(s.smoothMs !== SMOOTH_MS_DEFAULT ? { smoothMs: s.smoothMs } : {}),
          ...(s.pulseMs !== PULSE_MS_DEFAULT ? { pulseMs: s.pulseMs } : {}),
        };

  const viewport: AnimationsConfig['viewport'] extends infer T ? T : never =
    s.reboundMs === REBOUND_MS_DEFAULT &&
    s.yAxisMs === Y_AXIS_MS_DEFAULT &&
    s.inputResponseMs === INPUT_RESPONSE_MS_DEFAULT
      ? undefined
      : {
          ...(s.reboundMs !== REBOUND_MS_DEFAULT ? { reboundMs: s.reboundMs } : {}),
          ...(s.yAxisMs !== Y_AXIS_MS_DEFAULT ? { yAxisMs: s.yAxisMs } : {}),
          ...(s.inputResponseMs !== INPUT_RESPONSE_MS_DEFAULT ? { inputResponseMs: s.inputResponseMs } : {}),
        };

  if (points === undefined && viewport === undefined) return undefined;
  const out: AnimationsConfig = {};
  if (points !== undefined) out.points = points;
  if (viewport !== undefined) out.viewport = viewport;

  return out;
}

/**
 * Build series `options` fragment for fields shared across cartesian series
 * (entry animation, entryMs, smoothMs, and `pulse` for line).
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
  // chart-level `animations.points` block via `buildCartesianContainerProps`,
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
