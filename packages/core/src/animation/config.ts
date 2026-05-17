/**
 * Animation config — single home for:
 *
 *   1. Default durations (`DEFAULT_*`) — shared baselines consumed by
 *      {@link AnimationConfig.resolve}, the renderer factories, the Y
 *      transition factories, and the axis tick-fade tracker.
 *   2. Public {@link AnimationsConfig} shape — what users pass to
 *      `ChartOptions.animations`.
 *   3. Runtime {@link AnimationConfig} class — resolved view with every
 *      field concrete plus `defaults(kind)` / `overrides(kind)` helpers
 *      for the chart's `addXSeries` option-merge.
 */

import { type AnimationTime, resolveAnimationTime } from './time';
import type { TransitionFactory } from './transition';
import { hermite } from './y-range-hermite';
import { snap } from './y-range-snap';

// =============================================================================
// Internal shared baselines
// =============================================================================

const DEFAULT_SERIES_ENTRY = 250;
const DEFAULT_SERIES_SMOOTH = 250;

// =============================================================================
// Per-series-type defaults (public)
// =============================================================================

/** Line entrance tween duration. */
export const DEFAULT_LINE_ENTRY = DEFAULT_SERIES_ENTRY;
/** Line live-value chase duration. */
export const DEFAULT_LINE_SMOOTH = DEFAULT_SERIES_SMOOTH;
/** Pulse cycle period for the line last-point halo. Periodic loop, not a one-shot transition. */
export const DEFAULT_LINE_PULSE = 600;

/** Candlestick entrance tween duration. */
export const DEFAULT_CANDLESTICK_ENTRY = DEFAULT_SERIES_ENTRY;
/** Candlestick live OHLC chase duration. */
export const DEFAULT_CANDLESTICK_SMOOTH = DEFAULT_SERIES_SMOOTH;

/** Bar entrance tween duration. */
export const DEFAULT_BAR_ENTRY = DEFAULT_SERIES_ENTRY;
/** Bar live-value chase duration. */
export const DEFAULT_BAR_SMOOTH = DEFAULT_SERIES_SMOOTH;

/** Pie segment entry sweep. Parsed at config-time; wiring lands in a later phase. */
export const DEFAULT_PIE_ENTRY = 250;
/** Pie segment data-update chase. Parsed at config-time; wiring lands in a later phase. */
export const DEFAULT_PIE_UPDATE = 250;

// =============================================================================
// X / Y / axis defaults
// =============================================================================

/** Floor duration for streaming X scroll. */
export const DEFAULT_X_DATA_TICK = 250;

/**
 * Per-event ease applied to user pan/zoom commits. Logical state advances
 * synchronously (gesture math, edge detection, autoscroll all read the
 * committed target); the visual range eases over this duration so a single
 * mouse event isn't a teleport and back-to-back wheel/trackpad events
 * interpolate smoothly through the same animator.
 *
 * Defaults to `0` (instant apply) — opt in via `animations.x.gesture`
 * (suggested value 60). The default is conservative because the animated
 * visual range diverges from the committed target until the ease completes;
 * consumers reading `chart.getVisibleRange()` synchronously after a wheel/pan
 * expect the new value.
 */
export const DEFAULT_X_GESTURE = 0;

/**
 * Short-ease applied to the Y animator while a user gesture is active.
 * The default sticky-Y contract duration (2500 ms) is intentionally long
 * for streaming feeds — outliers leaving the window shouldn't reflow the
 * whole chart — but during pan/zoom the user explicitly chose a new view,
 * so contractions should converge in roughly one frame per wheel tick
 * instead of crawling over the full contract budget.
 */
export const DEFAULT_Y_GESTURE = 100;

/**
 * Default duration for `ChartInstance.setSeriesVisible` fade transitions —
 * the cross-fade applied to the series alpha AND the one-shot Y-range
 * duration override used for the same toggle, so the fade and the axis
 * re-fit settle on the same frame.
 */
export const DEFAULT_Y_VISIBILITY = 250;

/** Axis tick label cross-fade duration. */
export const DEFAULT_AXIS_TICK_FADE = 250;

// =============================================================================
// Y transition factory baselines
// =============================================================================

/** Outward (expanding) settle time baked into `hermite()` when unset. */
export const DEFAULT_HERMITE_EXPAND = 250;
/** Inward (contracting) settle time baked into `hermite()` when unset. */
export const DEFAULT_HERMITE_CONTRACT = 2_500;
/** Outward settle time baked into `spring()` when unset. ~99% target after this many ms. */
export const DEFAULT_SPRING_EXPAND_SPEED = 250;
/** Inward settle time baked into `spring()` when unset. */
export const DEFAULT_SPRING_CONTRACT_SPEED = 2_500;

// =============================================================================
// Public `AnimationsConfig` input surface
// =============================================================================

/**
 * Animation behavior knobs grouped by surface:
 *
 * - `y` — Y bound chase: pluggable transition curve, gesture-time short
 *   ease, visibility-toggle re-fit duration.
 * - `x` — X viewport: streaming scroll floor, per-event pan/zoom ease.
 * - `series.{line,candlestick,bar,pie}` — per-series-type data tweens.
 * - `axis.tickFade` — axis tick label cross-fade.
 *
 * Top-level `false` disables every animation category. Each category-level
 * `false` disables every field in that category. Series-type-level `false`
 * (`series: { line: false }`) disables that type only.
 *
 * The per-series numeric fields (`entry` / `smooth` / `pulse`) also exist
 * on individual series options (`<XSeries options={{ entryMs }}>`). The
 * chart-level field acts as the default for any series that hasn't set its
 * own override; an explicit `series.<type>: false` (or top-level `false`)
 * is a hard disable that overrides per-series.
 *
 * All settling animations share a 250 ms default so the X re-fit, Y range
 * update, and last-bar live-track all settle on the same frame on a
 * streaming tick. Pulse cycle period (600 ms) and `x.gesture` (0, opt-in)
 * keep their own values.
 */
export interface AnimationsConfig {
  /**
   * Y bound chase. `false` disables: Y range snaps instantly and visibility
   * toggles skip their fade.
   */
  y?:
    | false
    | {
        /** Y curve factory. See {@link hermite}, {@link spring}, {@link snap}. */
        transition?: TransitionFactory;
        /**
         * One-shot Y settle time applied while a user gesture (pan/zoom) is
         * active. Shorter than the curve's baseline so contractions during
         * interaction converge in ~one frame per wheel tick instead of
         * crawling through the long sticky-Y window. Default: 100 ms.
         */
        gesture?: AnimationTime;
        /**
         * Duration of the show/hide transition triggered by
         * `ChartInstance.setSeriesVisible`. The line/bar/candle alpha
         * cross-fades over this window AND the Y range re-fit uses the same
         * duration (one-shot override over the curve's baseline), so the
         * fade and the axis adjustment finish on the same frame. Default:
         * 250 ms. `false` / `0` makes visibility toggles instant.
         */
        visibility?: AnimationTime;
      };
  /**
   * X viewport. `false` disables both gesture ease and the streaming-scroll
   * floor — X changes snap instantly.
   */
  x?:
    | false
    | {
        /** Floor duration for streaming X scroll. Default: 250 ms. */
        dataTick?: AnimationTime;
        /**
         * Per-event ease applied to user pan/zoom commits. Logical state
         * advances synchronously (gesture math, edge detection, autoscroll
         * all read the committed target); the visual range eases over this
         * duration so back-to-back wheel/trackpad events interpolate
         * smoothly through the same animator.
         *
         * Default `0` (instant-apply). Opt in via `x: { gesture: 60 }` for
         * an eased pan/zoom feel — the default is conservative because the
         * animated visual range diverges from the committed target until
         * the ease completes, and existing consumers reading
         * `chart.getVisibleRange()` synchronously after a wheel/pan expect
         * the new value.
         */
        gesture?: AnimationTime;
      };
  /**
   * Per-series-type data animations. `false` disables every per-point
   * animation across every series. Setting a single type to `false`
   * (`series: { line: false }`) disables that type only.
   *
   * Per-series options (`<LineSeries options={{ entryMs, smoothMs, pulseMs }}>`)
   * win over chart-level numeric values. The chart-level field becomes the
   * default for series that don't set their own.
   */
  series?:
    | false
    | {
        line?: false | { entry?: AnimationTime; smooth?: AnimationTime; pulse?: AnimationTime };
        candlestick?: false | { entry?: AnimationTime; smooth?: AnimationTime };
        bar?: false | { entry?: AnimationTime; smooth?: AnimationTime };
        /**
         * Pie segment entry/update tweens. Parsed at config-time; the actual
         * wiring lands in a later phase — providing a value here today is a
         * no-op but the shape is stable.
         */
        pie?: false | { entry?: AnimationTime; update?: AnimationTime };
      };
  /** Axis tick label cross-fade. `false` makes tick relabel instant. */
  axis?: false | { tickFade?: AnimationTime };
}

// =============================================================================
// Resolved runtime shape — used internally by chart + viewport-engine
// =============================================================================

/** Resolved per-series numeric durations (Pie has its own `updateMs`). */
export interface ResolvedSeriesAnimations {
  line: { entryMs: number; smoothMs: number; pulseMs: number };
  candlestick: { entryMs: number; smoothMs: number };
  bar: { entryMs: number; smoothMs: number };
  pie: { entryMs: number; updateMs: number };
}

export type SeriesAnimationKind = 'candle' | 'bar' | 'line';

const ZERO_SERIES_ANIMATIONS: ResolvedSeriesAnimations = {
  line: { entryMs: 0, smoothMs: 0, pulseMs: 0 },
  candlestick: { entryMs: 0, smoothMs: 0 },
  bar: { entryMs: 0, smoothMs: 0 },
  pie: { entryMs: 0, updateMs: 0 },
};

/**
 * Resolved animation config. Pass the user's `ChartOptions.animations` to
 * {@link AnimationConfig.resolve} once at chart construction; reads stay
 * O(1) and the merge helpers below produce per-series option payloads
 * for the renderer factories.
 *
 * @internal
 */
export class AnimationConfig {
  readonly y: { transition: TransitionFactory; gestureMs: number; visibilityMs: number };
  readonly x: { dataTickMs: number; gestureMs: number };
  readonly series: ResolvedSeriesAnimations;
  readonly axis: { tickFadeMs: number };

  private constructor(
    y: { transition: TransitionFactory; gestureMs: number; visibilityMs: number },
    x: { dataTickMs: number; gestureMs: number },
    series: ResolvedSeriesAnimations,
    axis: { tickFadeMs: number },
  ) {
    this.y = y;
    this.x = x;
    this.series = series;
    this.axis = axis;
  }

  /**
   * Collapse the public `animations` surface into a resolved config.
   * `animations: false` disables everything; category-level `false`
   * disables every field in that category; otherwise missing fields
   * inherit built-in defaults.
   */
  static resolve(input: boolean | AnimationsConfig | undefined): AnimationConfig {
    if (input === false) {
      return new AnimationConfig(
        { transition: snap(), gestureMs: 0, visibilityMs: 0 },
        { dataTickMs: 0, gestureMs: 0 },
        ZERO_SERIES_ANIMATIONS,
        { tickFadeMs: 0 },
      );
    }

    const cfg = input === true || input === undefined ? undefined : input;
    const rawY = cfg?.y;
    const rawX = cfg?.x;
    const rawSeries = cfg?.series;
    const rawAxis = cfg?.axis;

    const y =
      rawY === false
        ? { transition: snap(), gestureMs: 0, visibilityMs: 0 }
        : {
            transition: rawY?.transition ?? hermite(),
            gestureMs: resolveAnimationTime(rawY?.gesture, DEFAULT_Y_GESTURE),
            visibilityMs: resolveAnimationTime(rawY?.visibility, DEFAULT_Y_VISIBILITY),
          };

    const x =
      rawX === false
        ? { dataTickMs: 0, gestureMs: 0 }
        : {
            dataTickMs: resolveAnimationTime(rawX?.dataTick, DEFAULT_X_DATA_TICK),
            gestureMs: resolveAnimationTime(rawX?.gesture, DEFAULT_X_GESTURE),
          };

    const series = resolveSeriesAnimations(rawSeries);

    const axis =
      rawAxis === false
        ? { tickFadeMs: 0 }
        : { tickFadeMs: resolveAnimationTime(rawAxis?.tickFade, DEFAULT_AXIS_TICK_FADE) };

    return new AnimationConfig(y, x, series, axis);
  }

  /**
   * Per-renderer-type chart-level option payload — merged BEFORE user
   * series options so explicit per-series options always win. Translates
   * resolved field names (`entryMs` / `smoothMs` / `pulseMs`) into the
   * renderer's option shape (`enterMs` / `smoothMs` / `pulseMs`).
   * `pulseMs` is line-only; bars / candles ignore it.
   */
  defaults(kind: SeriesAnimationKind): Record<string, unknown> {
    if (kind === 'line') {
      const { entryMs, smoothMs, pulseMs } = this.series.line;

      return { enterMs: entryMs, smoothMs, pulseMs };
    }

    if (kind === 'candle') {
      const { entryMs, smoothMs } = this.series.candlestick;

      return { enterMs: entryMs, smoothMs };
    }

    const { entryMs, smoothMs } = this.series.bar;

    return { enterMs: entryMs, smoothMs };
  }

  /**
   * Chart-level forced overrides — `animations.series.<type>: false` (or
   * any category set to `false`) is documented as a hard disable. Merged
   * AFTER user options so the disable can't be undone at the per-series
   * layer.
   */
  overrides(kind: SeriesAnimationKind): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    if (kind === 'line') {
      const { entryMs, smoothMs, pulseMs } = this.series.line;
      if (entryMs === 0) out.enterMs = 0;
      if (smoothMs === 0) out.smoothMs = 0;
      if (pulseMs === 0) out.pulseMs = 0;

      return out;
    }

    const { entryMs, smoothMs } = kind === 'candle' ? this.series.candlestick : this.series.bar;
    if (entryMs === 0) out.enterMs = 0;
    if (smoothMs === 0) out.smoothMs = 0;

    return out;
  }
}

function resolveSeriesAnimations(raw: AnimationsConfig['series'] | undefined): ResolvedSeriesAnimations {
  if (raw === false) return ZERO_SERIES_ANIMATIONS;

  const rawLine = raw?.line;
  const rawCandle = raw?.candlestick;
  const rawBar = raw?.bar;
  const rawPie = raw?.pie;

  const line =
    rawLine === false
      ? { entryMs: 0, smoothMs: 0, pulseMs: 0 }
      : {
          entryMs: resolveAnimationTime(rawLine?.entry, DEFAULT_LINE_ENTRY),
          smoothMs: resolveAnimationTime(rawLine?.smooth, DEFAULT_LINE_SMOOTH),
          pulseMs: resolveAnimationTime(rawLine?.pulse, DEFAULT_LINE_PULSE),
        };

  const candlestick =
    rawCandle === false
      ? { entryMs: 0, smoothMs: 0 }
      : {
          entryMs: resolveAnimationTime(rawCandle?.entry, DEFAULT_CANDLESTICK_ENTRY),
          smoothMs: resolveAnimationTime(rawCandle?.smooth, DEFAULT_CANDLESTICK_SMOOTH),
        };

  const bar =
    rawBar === false
      ? { entryMs: 0, smoothMs: 0 }
      : {
          entryMs: resolveAnimationTime(rawBar?.entry, DEFAULT_BAR_ENTRY),
          smoothMs: resolveAnimationTime(rawBar?.smooth, DEFAULT_BAR_SMOOTH),
        };

  const pie =
    rawPie === false
      ? { entryMs: 0, updateMs: 0 }
      : {
          entryMs: resolveAnimationTime(rawPie?.entry, DEFAULT_PIE_ENTRY),
          updateMs: resolveAnimationTime(rawPie?.update, DEFAULT_PIE_UPDATE),
        };

  return { line, candlestick, bar, pie };
}
