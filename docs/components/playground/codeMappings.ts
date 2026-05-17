import { type AnimationsConfig, hermite, snap, spring } from '@wick-charts/react';

import type { PropValue } from '../CodePreview';
import type { PlaygroundChartProps } from './Playground';

export type CartesianSeriesKind = 'line' | 'bar' | 'candle';

const AXIS_Y_WIDTH_DEFAULT = 55;
const AXIS_X_HEIGHT_DEFAULT = 30;
// Coordinated default for every settling animation. Must match the public
// defaults in packages/core/src/animation-constants.ts.
const SHARED_ANIMATION_MS_DEFAULT = 250;
const ENTRY_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const SMOOTH_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const PULSE_MS_DEFAULT = 600;
const REBOUND_MS_DEFAULT = SHARED_ANIMATION_MS_DEFAULT;
const INPUT_RESPONSE_MS_DEFAULT = 0;
const Y_ENGINE_DEFAULT = 'hermite';

// Module-level memoization so `buildAnimationsProp` returns the SAME factory
// reference on every call for the same engine label. ChartContainer's
// setAnimations effect compares by reference; without this cache each render
// would hand a fresh factory and either thrash the animator (if it ran) or be
// silently ignored (if dep stayed the same).
const Y_ENGINE_FACTORIES = {
  hermite: hermite(),
  spring: spring(),
  snap: snap(),
} as const;
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
  // (entryAnimation/entryMs/smoothMs/pulse) flow through the series options
  // builder instead. Phase 1 dropped `viewport.reboundMs` /
  // `viewport.inputResponseMs` from the public surface, so those slider
  // values render only when non-default; rebound has no config field, and
  // inputResponse is now `x.gesture`.
  const lineSeries: Record<string, PropValue> = {};
  if (s.entryMs !== ENTRY_MS_DEFAULT) lineSeries.entry = s.entryMs;
  if (s.smoothMs !== SMOOTH_MS_DEFAULT) lineSeries.smooth = s.smoothMs;
  if (s.pulseMs !== PULSE_MS_DEFAULT) lineSeries.pulse = s.pulseMs;

  const series: Record<string, PropValue> = {};
  if (Object.keys(lineSeries).length > 0) series.line = lineSeries;

  const yBlock: Record<string, PropValue> = {};
  if (s.yEngine !== Y_ENGINE_DEFAULT) {
    // Emitted as a bare identifier (`spring()` / `snap()`) via the
    // CodePreview VAR_REF_NAMES allow-list, so the snippet shows the
    // function call instead of a quoted string.
    yBlock.curve = `${s.yEngine}()`;
  }

  const xBlock: Record<string, PropValue> = {};
  if (s.inputResponseMs !== INPUT_RESPONSE_MS_DEFAULT) xBlock.gesture = s.inputResponseMs;
  // `s.reboundMs` no longer has a public config field — Phase 2 removes
  // rebound entirely. Slider state is kept for backwards-compat in the UI
  // panel; we just don't emit a config field for it.
  void s.reboundMs;

  const animationsAxis: Record<string, PropValue> = {};
  if (Object.keys(yBlock).length > 0) animationsAxis.y = yBlock;
  if (Object.keys(xBlock).length > 0) animationsAxis.x = xBlock;

  const animations: Record<string, PropValue> = {};
  if (Object.keys(animationsAxis).length > 0) animations.axis = animationsAxis;
  if (Object.keys(series).length > 0) animations.series = series;
  if (Object.keys(animations).length > 0) out.animations = animations;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build a runtime `animations` prop for `<ChartContainer animations={...}>`.
 * Returns `undefined` when every field matches the library default so callers
 * can omit the prop entirely (and the rendered code snippet stays clean).
 */
export function buildAnimationsProp(s: PlaygroundChartProps): AnimationsConfig | undefined {
  const linePoints =
    s.entryMs === ENTRY_MS_DEFAULT && s.smoothMs === SMOOTH_MS_DEFAULT && s.pulseMs === PULSE_MS_DEFAULT
      ? undefined
      : {
          ...(s.entryMs !== ENTRY_MS_DEFAULT ? { entry: s.entryMs } : {}),
          ...(s.smoothMs !== SMOOTH_MS_DEFAULT ? { smooth: s.smoothMs } : {}),
          ...(s.pulseMs !== PULSE_MS_DEFAULT ? { pulse: s.pulseMs } : {}),
        };

  const yEngineFactory = Y_ENGINE_FACTORIES[s.yEngine];
  const yBlock = s.yEngine === Y_ENGINE_DEFAULT ? undefined : { curve: yEngineFactory };
  const xBlock = s.inputResponseMs === INPUT_RESPONSE_MS_DEFAULT ? undefined : { gesture: s.inputResponseMs };

  // Slider for the (now-removed) public rebound field stays in the panel
  // for UI continuity; we just don't surface it in the runtime config.
  void s.reboundMs;

  if (linePoints === undefined && yBlock === undefined && xBlock === undefined) return undefined;

  const out: AnimationsConfig = {};
  if (linePoints !== undefined) out.series = { line: linePoints };
  if (yBlock !== undefined || xBlock !== undefined) {
    const axis: { y?: typeof yBlock; x?: typeof xBlock } = {};
    if (yBlock !== undefined) axis.y = yBlock;
    if (xBlock !== undefined) axis.x = xBlock;
    out.axis = axis;
  }

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
  // chart-level `animations.series.line.*` block via
  // `buildCartesianContainerProps`, which keeps the rendered snippet
  // single-source-of-truth and matches the way the public API is documented.
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
