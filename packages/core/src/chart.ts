import type { AnimationState, LiveOHLCTarget, LiveScalarTarget } from './animation/engine';
import { type AnimationEngine, createAnimationEngine } from './animation/engine';
import { type AnimationTime, resolveAnimationTime } from './animation/time';
import type { TransitionFactory } from './animation/transition';
import { hermite } from './animation/y-range-hermite';
import { snap } from './animation/y-range-snap';
import {
  DEFAULT_AXIS_TICK_FADE,
  DEFAULT_BAR_ENTRY,
  DEFAULT_BAR_SMOOTH,
  DEFAULT_CANDLESTICK_ENTRY,
  DEFAULT_CANDLESTICK_SMOOTH,
  DEFAULT_HERMITE_CONTRACT,
  DEFAULT_HERMITE_EXPAND,
  DEFAULT_LINE_ENTRY,
  DEFAULT_LINE_PULSE,
  DEFAULT_LINE_SMOOTH,
  DEFAULT_PIE_ENTRY,
  DEFAULT_PIE_UPDATE,
  DEFAULT_X_DATA_TICK,
  DEFAULT_X_GESTURE,
  DEFAULT_Y_GESTURE,
  DEFAULT_Y_VISIBILITY,
} from './animation-constants';
import { CanvasManager } from './canvas-manager';
import { AnimationBridge } from './chart/animation-bridge';
import { AutoscrollController } from './chart/autoscroll-controller';
import { KeyCache } from './chart/key-cache';
import { StreamingCadence } from './chart/streaming-cadence';
import { renderCrosshair } from './components/crosshair';
import { renderEdgeIndicator } from './components/edge-indicator';
import { renderGrid } from './components/grid';
import { TimeSeriesStore } from './data/store';
import { EventEmitter } from './events';
import { InteractionHandler } from './interactions/handler';
import { registerChartEngine, registerChartViewport } from './internal/test-handles';
import { PerfHud } from './perf/perf-hud';
import { PerfMonitor, type PerfMonitorOptions } from './perf/perf-monitor';
import { RenderScheduler } from './render-scheduler';
import type { AxisTickTracker } from './scales/tick-tracker';
import { TimeScale } from './scales/time-scale';
import { YScale } from './scales/y-scale';
import { BarRenderer } from './series/bar';
import { CandlestickRenderer } from './series/candlestick';
import { LineRenderer } from './series/line';
import { PieRenderer } from './series/pie';
import type { HoverInfo, SeriesRenderer, SliceInfo } from './series/types';
import { catppuccin } from './theme/themes/catppuccin';
import type { ChartTheme } from './theme/types';
import type {
  AxisBound,
  AxisConfig,
  BarSeriesOptions,
  CandlestickSeriesOptions,
  ChartLayout,
  CrosshairPosition,
  LineSeriesOptions,
  OHLCData,
  OHLCInput,
  PieSeriesOptions,
  TimePoint,
  TimePointInput,
  VisibleRange,
  VisibleRangeSpec,
} from './types';
import { detectInterval, normalizeTime } from './utils/time';
import { type HorizontalPadding, Viewport } from './viewport';

/** Which data side the user pulled past during a gesture. */
export type EdgeSide = 'left' | 'right';
/**
 * Host-controlled visual state for a chart edge:
 * - `idle`: nothing rendered (default).
 * - `loading`: a subtle spinner appears in the overshoot area.
 * - `no-data`: a dashed boundary line + "No more data" label appears at the data edge.
 * - `has-more`: reserved — currently behaves like `idle`. Use when more data exists but is not being fetched.
 */
export type EdgeState = 'idle' | 'loading' | 'no-data' | 'has-more';

/** Payload for {@link ChartOptions.onEdgeReached}. */
export interface EdgeReachedInfo {
  side: EdgeSide;
  /** Time units the user pulled past the soft bound. */
  overshoot: number;
  /** Soft-bound timestamp that was crossed (dataStart - leftPad or dataEnd + rightPad). */
  boundaryTime: number;
}

/** Events emitted by {@link ChartInstance}. */
interface ChartEvents {
  crosshairMove: (pos: CrosshairPosition | null) => void;
  viewportChange: () => void;
  dataUpdate: () => void;
  seriesChange: () => void;
  /**
   * Fired whenever any state that affects **overlay components** (InfoBar,
   * Tooltip, Legend, YLabel, PieLegend, PieTooltip) changes. Superset of
   * `dataUpdate` and `seriesChange` — also fires on visibility toggles,
   * series option changes, and theme swaps. Overlay components should
   * subscribe to this instead of stacking multiple listeners.
   */
  overlayChange: () => void;
  /**
   * Fired once per main-layer frame *while* an axis tick is still in the
   * middle of its fade-in/out animation. DOM axis components (`<TimeAxis>`,
   * `<YAxis>`) listen to this to re-read the per-tick opacity from
   * `timeScale.tickTracker` / `yScale.tickTracker` so the DOM labels and
   * canvas grid lines fade in lockstep. Stops firing as soon as every
   * tracked tick has reached its target opacity.
   */
  tickFrame: () => void;
}

/** Options passed when creating a new {@link ChartInstance}. */

/**
 * Chart-level animation configuration. Four independent domains so timings
 * across the Y axis, X axis, per-series tweens, and tick fade can't bleed
 * into each other.
 *
 * **Two layers — chart-level vs per-series.** The same per-point knobs
 * (`entry` / `smooth` / `pulse`) also exist on individual series options
 * (`<XSeries options={{ entryMs }}>`). The chart-level field acts as the
 * default for any series that hasn't set its own override; an explicit
 * `series.<type>: false` (or top-level `false`) is a hard disable that
 * overrides per-series.
 *
 * - `y` — Y bound chase: pluggable transition curve, gesture-time short
 *   ease, visibility-toggle re-fit duration.
 * - `x` — X viewport: streaming scroll floor, per-event pan/zoom ease.
 * - `series.{line,candlestick,bar,pie}` — per-series-type data tweens.
 * - `axis.tickFade` — axis tick label cross-fade.
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
        /**
         * Y curve factory. Built-in factories live in separate modules so
         * unused curves tree-shake out:
         *
         * - {@link hermite} *(default)* — velocity-matched cubic with a
         *   fixed deadline. Each retarget reaches the new target in exactly
         *   the configured duration.
         * - {@link spring} — critically-damped spring physics. Asymptotic
         *   approach, no fixed deadline; smoother on continuously-
         *   retargeted Y.
         * - {@link snap} — no animation (used internally when `y` is `false`).
         *
         * ```ts
         * import { spring, hermite } from '@wick-charts/core';
         *
         * animations={{ y: { transition: spring({ contractSpeed: '5s' }) } }}
         * ```
         */
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
         * {@link ChartInstance.setSeriesVisible}. The line/bar/candle alpha
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
   * animation across every series — overrides any per-series option set on
   * the same fields. Setting a single type to `false`
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

/**
 * Resolved, flat view of {@link AnimationsConfig} — every field concrete.
 * `0` in any numeric field means "disabled" (matches {@link AnimationTime}).
 *
 * @internal
 */
export interface ResolvedAnimationsConfig {
  y: {
    transition: TransitionFactory;
    gestureMs: number;
    visibilityMs: number;
  };
  x: {
    dataTickMs: number;
    gestureMs: number;
  };
  series: {
    line: { entryMs: number; smoothMs: number; pulseMs: number };
    candlestick: { entryMs: number; smoothMs: number };
    bar: { entryMs: number; smoothMs: number };
    pie: { entryMs: number; updateMs: number };
  };
  axis: { tickFadeMs: number };
}

export interface ChartOptions {
  theme?: ChartTheme;
  axis?: AxisConfig;
  /**
   * Viewport padding. `top`/`bottom` are in pixels. `left`/`right` accept either pixels (`50`)
   * or data intervals (`{ intervals: 3 }`). Defaults: `{ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } }`.
   */
  padding?: {
    top?: number;
    bottom?: number;
    right?: number | { intervals: number };
    left?: number | { intervals: number };
  };
  /**
   * Viewport-level streaming behavior.
   */
  viewport?: {
    /**
     * Maximum number of data bars (candles/points) the viewport will fit
     * before it stops growing and switches to tail-scroll. While the data
     * span is below this threshold, streaming ticks expand the right edge
     * to absorb new points; once the span exceeds it, the visible window
     * holds at this width and slides forward as new data arrives.
     * Default: 200. Values below 2 are clamped.
     */
    maxVisibleBars?: number;
    /**
     * Initial visible range applied **before** the first paint after data
     * arrives. Same shape as {@link ChartInstance.setVisibleRange} (a bar
     * count, an explicit `{from, to}` window, or a `{from, bars}` warm-up
     * pair). Calling `setVisibleRange` after mount via `useEffect` runs
     * post-paint and visually re-zooms the chart on the next frame; this
     * option folds the same intent into the first render so the very first
     * paint already shows the requested window.
     *
     * One-shot — consumed by the first `onDataChanged` call that has data,
     * then cleared. Subsequent `setSeriesData` calls don't re-apply it.
     */
    initialRange?: VisibleRangeSpec;
  };
  /** Enable zoom, pan, and crosshair interactions. Defaults to true. */
  interactive?: boolean;
  /** Background grid configuration. Default: `{ visible: true }`. */
  grid?: { visible: boolean };
  /**
   * Animation control. Split into `points` (data-series animations) and
   * `viewport` (pan/zoom rebound + Y-axis smoothing). See
   * {@link AnimationsConfig} for the full shape and defaults.
   *
   * Shorthands:
   * - `animations: true` (or omitted) uses built-in defaults.
   * - `animations: false` disables every animation category.
   * - `animations: { points: false }` disables all data-series animations.
   * - `animations: { viewport: false }` disables rebound + Y-axis smoothing.
   *
   * Per-series options (`enterMs`, `smoothMs`, etc.) override chart-level
   * defaults unless the category is explicitly `false` — then the chart-
   * level gate wins.
   */
  animations?: boolean | AnimationsConfig;
  /**
   * Invoked after the user releases a pan/zoom gesture that pulled the
   * viewport past a data edge by more than 10% of the visible range. Hosts
   * typically respond by prefetching more history and calling
   * {@link ChartInstance.setEdgeState} to show a spinner or "no more data"
   * indicator at the corresponding edge.
   */
  onEdgeReached?: (info: EdgeReachedInfo) => void;
  /**
   * Runtime performance instrumentation. Opt-in — absent by default so the
   * hot render path stays free of timing/counting overhead.
   *
   * - `false` / omitted — no instrumentation, no HUD, byte-identical to a perf-free build.
   * - `true` — create an internal {@link PerfMonitor} and mount a visible HUD overlay.
   * - `{ hud: true, ...options }` — same, with monitor options forwarded.
   * - `{ hud: false, ...options }` — instrument but do not render a HUD (useful when
   *   the host app consumes stats via `monitor.onFrame` and renders its own UI).
   * - `PerfMonitor` instance — attach to a pre-constructed monitor. Useful when several
   *   charts share one telemetry sink. HUD defaults to off in this mode.
   */
  perf?: boolean | PerfMonitor | (PerfMonitorOptions & { hud?: boolean; monitor?: PerfMonitor });
}

/**
 * Collapse the public `animations` surface into a flat resolved config.
 * `animations: false` disables everything; category-level `false` disables
 * every field in that category; otherwise missing fields inherit built-in
 * defaults.
 *
 * @internal
 */
export function resolveAnimationsConfig(input: ChartOptions['animations']): ResolvedAnimationsConfig {
  if (input === false) {
    return DISABLED_ANIMATIONS_CONFIG;
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

  return { y, x, series, axis };
}

const ZERO_SERIES_ANIMATIONS: ResolvedAnimationsConfig['series'] = {
  line: { entryMs: 0, smoothMs: 0, pulseMs: 0 },
  candlestick: { entryMs: 0, smoothMs: 0 },
  bar: { entryMs: 0, smoothMs: 0 },
  pie: { entryMs: 0, updateMs: 0 },
};

const DISABLED_ANIMATIONS_CONFIG: ResolvedAnimationsConfig = {
  y: { transition: snap(), gestureMs: 0, visibilityMs: 0 },
  x: { dataTickMs: 0, gestureMs: 0 },
  series: ZERO_SERIES_ANIMATIONS,
  axis: { tickFadeMs: 0 },
};

function resolveSeriesAnimations(raw: AnimationsConfig['series'] | undefined): ResolvedAnimationsConfig['series'] {
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

interface ResolvedPerfOptions {
  monitor: PerfMonitor | null;
  /** True when the monitor was constructed by `resolvePerfOptions`; false for caller-supplied monitors we must not destroy. */
  ownsMonitor: boolean;
  showHud: boolean;
}

/**
 * Collapse the polymorphic `perf` option into a concrete monitor + HUD
 * decision. Returning `{ monitor: null }` preserves the zero-instrumentation
 * path — no Proxy, no timing, no HUD.
 */
function resolvePerfOptions(input: ChartOptions['perf']): ResolvedPerfOptions {
  if (!input) return { monitor: null, ownsMonitor: false, showHud: false };

  if (input === true) return { monitor: new PerfMonitor(), ownsMonitor: true, showHud: true };

  if (input instanceof PerfMonitor) return { monitor: input, ownsMonitor: false, showHud: false };

  // Object form: may carry an external monitor or construction options, plus a HUD flag.
  const { hud, monitor, ...monitorOptions } = input;
  const external = monitor !== undefined;

  return {
    monitor: monitor ?? new PerfMonitor(monitorOptions),
    ownsMonitor: !external,
    showHud: hud ?? !external,
  };
}

/** Internal bookkeeping for a registered series. */
interface SeriesEntry {
  id: string;
  label?: string;
  renderer: SeriesRenderer;
  /** Null for non-time-series types like Pie. */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous storage — the concrete item type (TimePoint / OHLCData / LineData) depends on the series and is narrowed at the use site.
  store: TimeSeriesStore<any> | null;
  visible: boolean;
}

let seriesIdCounter = 0;

/**
 * Core chart controller. Manages series, viewport, scales, and rendering.
 * Create one per chart container and call {@link destroy} on unmount.
 */
export class ChartInstance extends EventEmitter<ChartEvents> {
  /** Canvas lifecycle and DPR-aware sizing. */
  #canvasManager: CanvasManager;
  /** Manages visible range, Y range, panning, zooming, and animated transitions. */
  readonly #viewport: Viewport;
  /** Schedules main-layer redraws (background, grid, series). */
  #mainScheduler: RenderScheduler;
  /** Schedules overlay redraws (crosshair). */
  #overlayScheduler: RenderScheduler;
  /** Maps time values to horizontal pixel coordinates. */
  readonly timeScale: TimeScale;
  /** Maps price/value to vertical pixel coordinates. */
  readonly yScale: YScale;
  /** Zoom, pan, crosshair — null when interactive=false. */
  #interactions: InteractionHandler | null;
  /** All registered series (candlestick, line, bar, pie). */
  #series: SeriesEntry[] = [];
  /** Active visual theme (colors, fonts, grid style). */
  #theme: ChartTheme;
  /** Whether to render the background grid. */
  #grid: boolean;
  /** Detected time interval between data points (milliseconds). */
  #dataInterval = 60_000;
  /** Current crosshair position, null when cursor is outside the chart. */
  #crosshairPos: CrosshairPosition | null = null;
  /** User-specified Y-axis bounds (auto, fixed, percentage). */
  #yBounds: { min?: AxisBound; max?: AxisBound } = {};
  /** Cached series ID list — invalidated on add/remove. */
  #seriesIdCache: string[] | null = null;
  /** Whether a YLabel overlay is active (used for right-padding calculation). */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: written via setYLabel, reserved for the right-padding reflow that accommodates the badge — kept so the flag stays consistent with the public API while the reflow logic is in progress.
  #hasYLabel = false;
  /** Axis visibility and sizing configuration. */
  #axis: AxisConfig = {};
  /** Host-declared state per edge — drives the edge-indicator overlay. */
  #edgeStates: Record<EdgeSide, EdgeState> = { left: 'idle', right: 'idle' };
  /** Cached boundary timestamps from the last `edgeReached` emission, by side. */
  #edgeBoundaries: Record<EdgeSide, number | null> = { left: null, right: null };
  /** Host-supplied callback fired when the user releases a pan/zoom past a data edge. */
  #onEdgeReached?: (info: EdgeReachedInfo) => void;

  /** Nesting depth for batch updates. Suppresses recomputes while > 0. */
  #batchDepth = 0;
  /** True when batched operations include data changes (triggers full onDataChanged on end). */
  #batchDataDirty = false;
  /** True when batched operations include visibility changes (triggers Y-range + redraw on end). */
  #batchVisualDirty = false;
  /** True when batched operations bumped overlay version (emits a single overlayChange on flush). */
  #batchOverlayDirty = false;

  /**
   * Monotonic counter bumped on any mutation that affects overlay output —
   * data, visibility, series options, theme. Used by snapshot helpers in
   * `@wick-charts/core` as a cache key so `buildHoverSnapshots` /
   * `buildLastSnapshots` return the same reference between ticks when
   * nothing observable has changed.
   *
   * @internal
   */
  #overlayVersion = 0;

  get yAxisWidth(): number {
    const y = this.#axis.y;
    return y?.visible === false ? 0 : (y?.width ?? 55);
  }

  get xAxisHeight(): number {
    const x = this.#axis.x;
    return x?.visible === false ? 0 : (x?.height ?? 30);
  }

  /** Resolved animation config derived from `options.animations` at construction. */
  #animationsConfig: ResolvedAnimationsConfig;

  /**
   * Owner of every chart-level animation timeline driven by Phase 2: X
   * range, Y bounds, per-series alpha, pulse phase. Viewport stores the
   * logical target and a visual cache the chart writes from
   * `engine.state.xRange` each `renderMain`.
   */
  readonly #engine: AnimationEngine;
  /** Pure adapter routing chart-side events into {@link #engine}. */
  readonly #bridge: AnimationBridge;
  /** EMA-smoothed real-wall-clock cadence between streaming appends. Drives
   *  the adaptive `data_tick` duration so the X slide stays in lockstep
   *  with the producer through small jitter. */
  readonly #cadence: StreamingCadence;
  /** Stable composite-key strings for live-value / entry-progress map lookups. */
  readonly #keys: KeyCache;
  /** Per-frame autoscroll re-engagement check — reads `bridge.lastXTarget`
   *  (logical) so a pan that brings `dataEnd` back into the destination
   *  flips tail-tracking without preempting an in-flight X animation. */
  readonly #autoscroll: AutoscrollController;

  /** Active performance monitor, or `null` when instrumentation is disabled (the default). */
  #perfMonitor: PerfMonitor | null;
  /** When true, `destroy()` tears down the monitor; false for caller-supplied monitors we must not destroy. */
  #ownsPerfMonitor = false;
  /** Visible HUD overlay; non-null only when the caller requested one. */
  #perfHud: PerfHud | null = null;

  constructor(container: HTMLElement, options?: ChartOptions) {
    super();
    // Support both new `axis` API and legacy flat props
    if (options?.axis) {
      this.#axis = options.axis;
      this.#yBounds = { min: options.axis.y?.min, max: options.axis.y?.max };
    }
    this.#theme = options?.theme ?? catppuccin.theme;
    this.#grid = options?.grid?.visible !== false;
    this.#animationsConfig = resolveAnimationsConfig(options?.animations);

    // The engine owns X, Y, alpha and pulse. Viewport is now a pure
    // logical-state holder plus visual cache (written each frame from
    // `state.xRange`); pan/zoom commit logical synchronously and the
    // engine eases the visual via gesture / data_tick events.
    this.#engine = createAnimationEngine({
      initial: { yRange: { min: 0, max: 0 }, xRange: { from: 0, to: 0 } },
      yTransition: this.#animationsConfig.y.transition({ initial: { min: 0, max: 0 } }),
      onWake: () => this.#mainScheduler?.markDirty(),
    });
    this.#bridge = new AnimationBridge({ engine: this.#engine });
    this.#cadence = new StreamingCadence();
    this.#keys = new KeyCache();

    this.#onEdgeReached = options?.onEdgeReached;
    this.#initialVisibleRange = options?.viewport?.initialRange;

    const resolvedPerf = resolvePerfOptions(options?.perf);
    this.#perfMonitor = resolvedPerf.monitor;
    this.#ownsPerfMonitor = resolvedPerf.ownsMonitor;

    this.#canvasManager = new CanvasManager(container, this.#perfMonitor ?? undefined);
    this.#viewport = new Viewport({
      padding: options?.padding,
      maxVisibleBars: options?.viewport?.maxVisibleBars,
    });
    this.#autoscroll = new AutoscrollController({ viewport: this.#viewport, bridge: this.#bridge });
    registerChartViewport(this, this.#viewport);
    registerChartEngine(this, this.#engine);
    this.timeScale = new TimeScale();
    this.yScale = new YScale();
    const tickFadeMs = this.#animationsConfig.axis.tickFadeMs;
    this.timeScale.tickTracker.setFadeMs(tickFadeMs);
    this.yScale.tickTracker.setFadeMs(tickFadeMs);

    const monitor = this.#perfMonitor;
    if (monitor) {
      this.#mainScheduler = new RenderScheduler((t) => {
        monitor.resetDrawCalls('main');
        const t0 = performance.now();
        this.renderMain(t);
        monitor.recordFrame('main', performance.now() - t0, t);
      });
      this.#overlayScheduler = new RenderScheduler((t) => {
        monitor.resetDrawCalls('overlay');
        const t0 = performance.now();
        this.renderOverlay(t);
        monitor.recordFrame('overlay', performance.now() - t0, t);
      });
      if (resolvedPerf.showHud) {
        this.#perfHud = new PerfHud(container, monitor);
      }
    } else {
      this.#mainScheduler = new RenderScheduler((t) => this.renderMain(t));
      this.#overlayScheduler = new RenderScheduler((t) => this.renderOverlay(t));
    }

    const interactive = options?.interactive !== false;
    this.#interactions = interactive
      ? new InteractionHandler(this.#canvasManager.canvas, this.#viewport, this.timeScale, this.yScale)
      : null;

    this.#viewport.on('change', () => {
      // Sync scales immediately so DOM axis components (TimeAxis, YAxis) read
      // fresh coordinates when viewportChange triggers their re-render.
      // Does NOT advance Y smoothing — that only happens inside renderMain().
      this.syncScales();
      this.#mainScheduler.markDirty();
      this.emit('viewportChange');
    });

    this.#viewport.on('edgeReached', (info: EdgeReachedInfo) => {
      // Remember the boundary so the edge-indicator overlay can anchor to it
      // even after subsequent pan/zoom that may shift soft bounds.
      this.#edgeBoundaries[info.side] = info.boundaryTime;
      this.#onEdgeReached?.(info);
    });

    // While the user is actively panning/zooming, route X AND Y through the
    // engine as a `gesture` event. Pan/zoom commit `viewport.logicalRange`
    // synchronously; the engine eases X to that target over `x.gestureMs`
    // (default 0 → instant) and Y to the resampled target over
    // `y.gestureMs`. The engine's priority-by-kind merge guarantees gesture
    // preempts any in-flight `data_tick` on the same slot.
    this.#viewport.on('interact', () => {
      this.#emitXTarget({ kind: 'gesture' });
      this.#emitYTarget({ kind: 'gesture' });
    });

    this.#canvasManager.on('resize', () => {
      // Render synchronously — canvas.width/height assignment clears the canvas,
      // so we must redraw immediately in the same frame to avoid a black flash.
      // Resize doesn't change the data-driven Y target, but the chart-area
      // height changed: the next setYRange call inside renderMain picks up
      // the new pixel padding so labels reposition without an explicit emit.
      this.updateScales();
      this.renderMain();
      // Notify React components — yScale changed due to new canvas dimensions
      // (e.g. Legend appeared and shrank the chart area).
      this.emit('viewportChange');
    });

    // Bootstrap the scales with the size CanvasManager measured synchronously
    // in its constructor. Without this, `yScale.height` stays at its default
    // `1` until the first ResizeObserver delivery (or first `onDataChanged`)
    // — and anything that calls `yScale.valueToY()` before then (YLabel,
    // YAxis labels, series draws on the first paint) computes positions
    // against a 1-pixel coordinate space, producing a visible "rescale"
    // jump once the real height lands. `syncScales` is cheap and safely
    // no-ops when the container hasn't been laid out yet (size still 0).
    this.syncScales();

    this.#interactions?.on('crosshairMove', (pos) => {
      this.#crosshairPos = pos;
      this.#overlayScheduler.markDirty();
      this.emit('crosshairMove', pos);

      // Generic spatial-hover dispatch — any renderer that implements hitTest+setHoverIndex opts in.
      this.#updateHover(pos);
    });
  }

  /**
   * Bump overlay version + emit `overlayChange`. Call from every mutation
   * path whose output overlay components care about: data, series list,
   * per-series/layer visibility, options, theme.
   *
   * Inside `batch(...)` the version still increments per call (so the
   * snapshot cache invalidates at least once per logical change), but the
   * `overlayChange` emission is coalesced to a single event on flush.
   * That lets Legend-style isolate toggles — which batch multiple
   * `setSeriesVisible` / `setLayerVisible` calls — produce one overlay
   * render instead of N.
   */
  #bumpOverlayVersion(): void {
    this.#overlayVersion++;
    if (this.#batchDepth > 0) {
      this.#batchOverlayDirty = true;

      return;
    }

    this.emit('overlayChange');
  }

  /**
   * Monotonic counter incremented on any mutation that affects overlay
   * output. Snapshot helpers (`buildHoverSnapshots`, `buildLastSnapshots`)
   * key their structural-equality cache on this value — same version +
   * same `(time, sort, cacheKey)` returns the same frozen reference.
   *
   * @internal
   */
  getOverlayVersion(): number {
    return this.#overlayVersion;
  }

  /**
   * Return a series ID: use the provided hint if it's non-empty and not already taken,
   * otherwise generate a new auto ID. Auto-generated IDs never collide with each other
   * or with user-provided IDs because they use a monotonically increasing counter.
   */
  #resolveId(hint?: string): string {
    if (hint && !this.#series.some((s) => s.id === hint)) {
      return hint;
    }
    // Keep incrementing until we find a free slot (skip any custom IDs that match)
    let candidate: string;
    do {
      candidate = `series_${++seriesIdCounter}`;
    } while (this.#series.some((s) => s.id === candidate));
    return candidate;
  }

  /**
   * Option overrides derived from the chart-level `animations.points` config.
   * Merged BEFORE user-supplied series options so explicit series options
   * always win — except when a chart-level category resolved to `0`
   * (disabled), in which case the category is forced off here and the
   * per-series option cannot re-enable it. Enforcement of the "chart-level
   * false wins" contract lives in the `addXSeries` wrappers below: they call
   * `#seriesAnimationDefaults(kind, options)` so the result merges *after*
   * the user's options for the disable paths.
   */
  /** Map a renderer instance to its `series.<kind>` config bucket. Pie has
   *  no per-series animation wiring yet (Phase 3), so we return null. */
  #rendererKind(renderer: SeriesRenderer): 'candle' | 'bar' | 'line' | null {
    if (renderer instanceof CandlestickRenderer) return 'candle';
    if (renderer instanceof BarRenderer) return 'bar';
    if (renderer instanceof LineRenderer) return 'line';

    return null;
  }

  #seriesAnimationDefaults(kind: 'candle' | 'bar' | 'line'): Record<string, unknown> {
    if (kind === 'line') {
      const { entryMs, smoothMs, pulseMs } = this.#animationsConfig.series.line;
      // `enterAnimation` style stays per-series — chart-level config only
      // influences durations. `pulseMs` is line-only; bars/candles ignore it.
      return { enterMs: entryMs, smoothMs, pulseMs };
    }

    if (kind === 'candle') {
      const { entryMs, smoothMs } = this.#animationsConfig.series.candlestick;

      return { enterMs: entryMs, smoothMs };
    }

    const { entryMs, smoothMs } = this.#animationsConfig.series.bar;

    return { enterMs: entryMs, smoothMs };
  }

  /**
   * Chart-level animation overrides — these *win over* any per-series value
   * because `animations.series.<type>: false` (or any category set to `false`)
   * is documented as a hard disable. Merged AFTER user options in the
   * `addXSeries` wrappers.
   */
  #seriesAnimationForceOff(kind: 'candle' | 'bar' | 'line'): Record<string, unknown> {
    const series = this.#animationsConfig.series;
    const out: Record<string, unknown> = {};

    if (kind === 'line') {
      const { entryMs, smoothMs, pulseMs } = series.line;
      if (entryMs === 0) out.enterMs = 0;
      if (smoothMs === 0) out.smoothMs = 0;
      if (pulseMs === 0) out.pulseMs = 0;

      return out;
    }

    const { entryMs, smoothMs } = kind === 'candle' ? series.candlestick : series.bar;
    if (entryMs === 0) out.enterMs = 0;
    if (smoothMs === 0) out.smoothMs = 0;

    return out;
  }

  /** Add a candlestick (OHLC) series and return its unique ID. */
  addCandlestickSeries(options?: Partial<CandlestickSeriesOptions & { id?: string }>): string {
    const store = new TimeSeriesStore<OHLCData>();
    const renderer = new CandlestickRenderer(store, {
      up: { ...this.#theme.candlestick.up },
      down: { ...this.#theme.candlestick.down },
      bodyWidthRatio: 0.6,
      ...this.#seriesAnimationDefaults('candle'),
      ...options,
      ...this.#seriesAnimationForceOff('candle'),
    });

    return this.#registerSeries(renderer, renderer.store, options ?? {});
  }

  /** Add a line series and return its unique ID. */
  addLineSeries(options?: Partial<LineSeriesOptions & { layers?: number; id?: string }>): string {
    const { layers, ...rest } = options ?? {};
    const layerCount = layers ?? 1;

    const renderer = new LineRenderer(layerCount, {
      colors: layerCount === 1 ? [this.#theme.line.color] : this.#theme.seriesColors.slice(0, layerCount),
      strokeWidth: this.#theme.line.width,
      area: { visible: true },
      ...this.#seriesAnimationDefaults('line'),
      ...rest,
      ...this.#seriesAnimationForceOff('line'),
    });

    const id = this.#registerSeries(renderer, renderer.store, rest);

    // Drive the pulse halo from engine state. Period is scaled so that the
    // engine's `phase = (effectiveNow / period) % 1` produces the same
    // visible rate as the legacy `Math.sin(now / pulseMs)`: full cycle of
    // `Math.sin(phase * 2π)` lands at `period` ms — for parity with the old
    // argument-advance rate (1/pulseMs per ms) we need period = 2π · pulseMs.
    const pulseMs = this.#animationsConfig.series.line.pulseMs;
    if (pulseMs > 0) {
      this.#engine.registerSeriesPulse(id, pulseMs * 2 * Math.PI);
    }

    return id;
  }

  /** Add a bar series and return its unique ID. */
  addBarSeries(options?: Partial<BarSeriesOptions & { layers?: number; id?: string }>): string {
    const { layers, ...rest } = options ?? {};
    const layerCount = layers ?? 1;

    const renderer = new BarRenderer(layerCount, {
      colors: this.#theme.seriesColors.slice(0, layerCount),
      barWidthRatio: 0.6,
      ...this.#seriesAnimationDefaults('bar'),
      ...rest,
      ...this.#seriesAnimationForceOff('bar'),
    });

    return this.#registerSeries(renderer, renderer.store, rest);
  }

  /**
   * Shared registration boilerplate for every renderer: assign an id, hook
   * data notifications, push into `#series`, invalidate caches, and emit
   * the usual churn events. Pie passes `null` for `store`; time-series
   * renderers pass their owned `TimeSeriesStore`.
   */
  #registerSeries(
    renderer: SeriesRenderer,
    store: SeriesEntry['store'],
    opts: { id?: string; label?: string },
  ): string {
    const id = this.#resolveId(opts.id);
    renderer.onDataChanged?.(() => this.onDataChanged());
    this.#series.push({ id, label: opts.label, renderer, store, visible: true });
    this.#seriesIdCache = null;
    this.updateViewportPadding();
    this.emit('seriesChange');
    this.#bumpOverlayVersion();

    return id;
  }

  /** Add a pie/donut series. Set `innerRadiusRatio > 0` for donut. */
  addPieSeries(options?: Partial<PieSeriesOptions & { id?: string }>): string {
    // Pie has no TimeSeriesStore, but routing through onDataChanged() keeps
    // batch() semantics consistent with time-series renderers.
    const renderer = new PieRenderer(options);

    return this.#registerSeries(renderer, null, options ?? {});
  }

  /** Remove a series by ID and clean up its resources. */
  removeSeries(id: string): void {
    const idx = this.#series.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.#series[idx].renderer.dispose();
      this.#series.splice(idx, 1);
      this.#seriesIdCache = null;
      this.#engine.dropSlot('alpha', id);
      this.#engine.unregisterSeriesPulse(id);
      this.#keys.dropSeries(id);
      this.updateViewportPadding();
      this.#mainScheduler.markDirty();
      this.emit('seriesChange');
      this.#bumpOverlayVersion();
    }
  }

  /**
   * Read-only snapshot of every chart-level animation timeline driven by
   * the engine. Renderers in the new architecture read `state.pulsePhase`,
   * `state.entryProgress`, `state.liveValues` etc. from this. The same
   * reference is returned every frame (P2 contract) — do not cache it
   * across frames; read the values inside the current render pass.
   */
  getAnimationState(): AnimationState {
    return this.#engine.getAnimationState();
  }

  /**
   * Replace all data for a series.
   *
   * - Single-layer series (candlestick, single-layer line/bar, pie): pass `data` directly.
   * - Multi-layer series (line/bar with multiple layers): pass `layerIndex` to target a specific layer.
   *
   * For line/bar accepts `TimePointInput[]` (time may be `Date`); for candlestick accepts `OHLCInput[]`;
   * for pie accepts `PieSliceData[]`. Time fields are normalized internally.
   */
  setSeriesData(id: string, data: unknown, layerIndex?: number): void {
    const entry = this.#series.find((s) => s.id === id);
    if (!entry) return;
    // Bulk replace → onDataChanged should snap the Y range so yScale reflects
    // the new domain synchronously (the long-standing public contract pinned
    // by chart-scales-sync.test). Streaming `appendData` ticks don't set
    // this flag, so per-tick Y can ease both directions for a smooth axis.
    this.#dataReplaceSnapPending = true;

    // Live-track slots carry the previous dataset's last value. Dropping
    // them here means the next data_tick / instant emit seeds the slot
    // from the new last point — without this `renderer.effectiveValue`
    // would read the stale live value and miscompute the trailing
    // segment's Y for one frame after a bulk swap.
    const layerCount = entry.renderer.getLayerCount();
    for (let li = 0; li < layerCount; li++) {
      const key = `${id}:${li}`;
      this.#engine.dropSlot('liveScalar', key);
      this.#engine.dropSlot('liveOHLC', key);
    }

    entry.renderer.setData(data, layerIndex);
  }

  /** Append a new data point to the end of a series (real-time tick). */
  appendData(id: string, point: OHLCInput | TimePointInput, layerIndex?: number): void {
    const entry = this.#series.find((s) => s.id === id);
    if (entry === undefined || entry.renderer.appendPoint === undefined) return;

    entry.renderer.appendPoint(point, layerIndex);

    // Per-point entrance via engine. Bridge resolves the duration zero-skip
    // and the live-slot identity snap; we only need to provide the kind-
    // specific entry duration and the normalized time.
    const kind = this.#rendererKind(entry.renderer);
    if (kind === null) return;

    const duration =
      kind === 'candle'
        ? this.#animationsConfig.series.candlestick.entryMs
        : kind === 'line'
          ? this.#animationsConfig.series.line.entryMs
          : this.#animationsConfig.series.bar.entryMs;

    this.#bridge.emitEntrance({
      seriesId: id,
      layerIdx: layerIndex ?? 0,
      time: normalizeTime(point.time),
      duration,
    });
  }

  /** Update the last data point of a series in place (e.g. live candle update). */
  updateData(id: string, point: OHLCInput | TimePointInput, layerIndex?: number): void {
    const entry = this.#series.find((s) => s.id === id);
    entry?.renderer.updateLastPoint?.(point, layerIndex);
  }

  /**
   * Keep only the most recent `count` points of a series — drop the oldest
   * tail when the series exceeds the cap. Smooth Y-range chase (no snap):
   * unlike {@link setSeriesData}, this does NOT set the bulk-replace snap
   * flag, so streaming windows can roll without per-tick Y jitter.
   *
   * Idempotent: a no-op when the series is already at or below `count`.
   * Use after {@link appendData} in a rolling-window stream:
   * ```ts
   * chart.appendData('feed', point);
   * chart.keepLast('feed', 100);
   * ```
   */
  keepLast(id: string, count: number, layerIndex?: number): void {
    const entry = this.#series.find((s) => s.id === id);
    entry?.renderer.keepLast?.(count, layerIndex);
  }

  /** Update visual options (color, width, etc.) for an existing series. */
  updateSeriesOptions(
    id: string,
    options:
      | Partial<CandlestickSeriesOptions>
      | Partial<LineSeriesOptions>
      | Partial<BarSeriesOptions>
      | Partial<PieSeriesOptions>,
  ): void {
    const entry = this.#series.find((s) => s.id === id);
    if (!entry) return;

    // Framework wrappers (notably Vue's deep watch) replay this method on
    // every render with a fresh options object, usually identical. Bumping
    // `overlayVersion` blindly would invalidate the snapshot cache on every
    // tick and defeat the whole point of memoization.
    //
    // Compare the inputs that actually feed overlays — label + layer colors —
    // before and after the update, and only bump when they really changed.
    const prevLabel = entry.label;
    const prevColors = entry.renderer.getLayerColors().slice();

    // React / Vue / Svelte wrappers replay the user's options on every
    // render via this path. If the chart-level `animations.series.<type>`
    // category is disabled, the per-series force-off must be re-applied
    // here — otherwise a simple parent re-render silently re-enables
    // animations the chart asked to hold off.
    const kind = this.#rendererKind(entry.renderer);
    const forceOff = kind === null ? {} : this.#seriesAnimationForceOff(kind);
    entry.renderer.updateOptions({ ...options, ...forceOff });
    // Keep stored label in sync with options (affects tooltip/legend)
    if ('label' in options && typeof options.label === 'string') {
      entry.label = options.label;
    }
    this.#mainScheduler.markDirty();

    const nextColors = entry.renderer.getLayerColors();
    const colorsChanged = prevColors.length !== nextColors.length || prevColors.some((c, i) => c !== nextColors[i]);
    const labelChanged = prevLabel !== entry.label;
    if (colorsChanged || labelChanged) {
      this.#bumpOverlayVersion();
    }
  }

  /**
   * Batch multiple updates: suppress recomputes until `fn` returns. Exceptions
   * inside `fn` still flush the batch so counters don't leak across calls.
   */
  batch(fn: () => void): void {
    this.#batchDepth++;
    try {
      fn();
    } finally {
      if (--this.#batchDepth <= 0) {
        this.#batchDepth = 0;
        if (this.#batchDataDirty) {
          this.#batchDataDirty = false;
          this.#batchVisualDirty = false;
          this.onDataChanged();
        } else if (this.#batchVisualDirty) {
          this.#batchVisualDirty = false;
          this.#emitYTarget({ kind: 'instant' });
          this.#mainScheduler.markDirty();
        }
        if (this.#batchOverlayDirty) {
          this.#batchOverlayDirty = false;
          this.emit('overlayChange');
        }
      }
    }
  }

  /** Show or hide a series. The series cross-fades over
   *  `animations.viewport.visibilityMs`; the Y range re-fits on the same
   *  schedule (one-shot duration override) so the fade and the axis
   *  adjustment finish on the same frame. Hidden series are excluded
   *  from Y-range computation immediately so the axis can start moving
   *  while the line fades out in parallel.
   */
  setSeriesVisible(seriesId: string, visible: boolean): void {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry || entry.visible === visible) return;

    entry.visible = visible;
    this.#bumpOverlayVersion();

    // Renderer-owned alpha fade — kicks off independently of the engine's
    // Y retarget below so the cross-fade lives next to the geometry that
    // draws it. Pie and other renderers without `setAlpha` ride the binary
    // `entry.visible` flag and skip the fade entirely.
    const visibilityMs = this.#animationsConfig.y.visibilityMs;
    entry.renderer.setAlpha?.(visible ? 1 : 0, visibilityMs);
    this.#mainScheduler.markDirty();

    if (this.#batchDepth > 0) {
      this.#batchVisualDirty = true;

      return;
    }

    // Y reflow still flows through the engine (Phase 2 ownership). The
    // engine's `alpha` slot keeps writing `state.seriesAlpha` for now —
    // chart no longer reads it, so it's a dead write that PR-2 will strip
    // along with the rest of the deprecated slot families.
    const yTarget = this.#computeYTarget();
    this.#yInited = true;
    const now = performance.now();
    this.#bridge.emitVisibility({
      duration: visibilityMs,
      seriesId,
      visible,
      yTarget: yTarget !== null ? { target: yTarget } : null,
      startWall: now,
    });
    this.#applyEngineState(now);
  }

  isSeriesVisible(seriesId: string): boolean {
    return this.#series.find((s) => s.id === seriesId)?.visible ?? true;
  }

  /** Show or hide a specific layer within a multi-layer series. */
  setLayerVisible(seriesId: string, layerIndex: number, visible: boolean): void {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return;

    // Single-layer renderers (candlestick, pie, single-layer line/bar) can't toggle;
    // use setSeriesVisible() instead. Skip to avoid a pointless re-fit/redraw.
    if (entry.renderer.getLayerCount() <= 1) return;
    if (entry.renderer.isLayerVisible(layerIndex) === visible) return;

    entry.renderer.setLayerVisible(layerIndex, visible);
    this.#bumpOverlayVersion();
    if (this.#batchDepth > 0) {
      this.#batchVisualDirty = true;

      return;
    }

    this.#emitYTarget({ kind: 'instant' });
    this.#mainScheduler.markDirty();
  }

  isLayerVisible(seriesId: string, layerIndex: number): boolean {
    const entry = this.#series.find((s) => s.id === seriesId);
    return entry?.renderer.isLayerVisible(layerIndex) ?? true;
  }

  /** Auto-fit the viewport to show all data across every series. */
  fitContent(): void {
    const { first, last } = this.getDataBounds();
    if (first === undefined || last === undefined) return;
    const chartWidth = this.#canvasManager.size.media.width - this.yAxisWidth;
    this.#viewport.fitToData(first, last, { chartWidth });
    // Y and X both ease through the engine — `data_tick` rides the sticky-Y
    // baseline + the cadence-smoothed X duration so the axis and viewport
    // converge on the same frame.
    this.#emitYTarget({ kind: 'data_tick' });
    this.#emitXTarget({ kind: 'data_tick' });
  }

  getVisibleRange() {
    return this.#viewport.visibleRange;
  }

  /**
   * Return the full span of registered data, or `null` before any data has
   * arrived. `{ from: dataStart, to: dataEnd }` mirrors the viewport's own
   * tracking and is cheaper than recomputing from series stores.
   */
  getDataRange(): VisibleRange | null {
    const from = this.#viewport.dataStart;
    const to = this.#viewport.dataEnd;
    if (from === null || to === null) return null;

    return { from, to };
  }

  /**
   * Imperatively set the visible time range. Three forms:
   *
   * - `number N` — show the last N bars from the data tail (anchor right).
   *   Resolved against current data bounds and data interval; keeps
   *   auto-scroll on. No-op if data hasn't loaded yet.
   * - `{ from, to }` — explicit time range. `from`/`to` accept either
   *   epoch milliseconds or `Date`. Cancels any in-flight animation and
   *   applies immediately. Auto-scroll stays on only if the tail is
   *   inside the new range (mirrors pan semantics).
   * - `{ from, bars }` — anchor the visible window at `from` and extend
   *   right by `bars` data intervals. Useful for warm-up windows where
   *   seed points sit on the left and a stream fills the gap on the
   *   right. `from` accepts a `Date` too.
   *
   * Typical use: on mount, zoom to the last N bars while keeping the full
   * buffer available for pan-back history inspection.
   */
  setVisibleRange(spec: VisibleRangeSpec): void {
    if (typeof spec === 'number') {
      // Integer check rejects NaN, Infinity, and non-integers in one call;
      // the floor of 2 matches Viewport's applyRange minimum-span contract.
      if (!Number.isInteger(spec) || spec < 2) return;

      const { first, last } = this.getDataBounds();
      if (first === undefined || last === undefined) return;

      const trimmedFirst = Math.max(first, last - (spec - 1) * this.#dataInterval);
      const chartWidth = this.#canvasManager.size.media.width - this.yAxisWidth;
      this.#viewport.fitToData(trimmedFirst, last, { chartWidth });
      // Programmatic zoom — X snaps to the new window (matches the legacy
      // `setRange` semantics every consumer reads `chart.getVisibleRange()`
      // synchronously after), Y eases via the sticky-Y baseline so the
      // axis re-fit isn't a jarring jump.
      this.#emitXTarget({ kind: 'instant' });
      this.#emitYTarget({ kind: 'data_tick' });

      return;
    }

    if ('bars' in spec) {
      if (!Number.isInteger(spec.bars) || spec.bars < 2) return;

      const from = normalizeTime(spec.from);
      const to = from + spec.bars * this.#dataInterval;
      // Hold the viewport until the data fills the gap on the right —
      // standard streaming warm-up window.
      this.#viewport.setRangeHold({ from, to });
      this.#emitXTarget({ kind: 'instant' });
      this.#emitYTarget({ kind: 'data_tick' });

      return;
    }

    this.#viewport.setRange({ from: normalizeTime(spec.from), to: normalizeTime(spec.to) });
    this.#emitXTarget({ kind: 'instant' });
    this.#emitYTarget({ kind: 'data_tick' });
  }

  getYRange() {
    return this.#viewport.yRange;
  }

  getCrosshairPosition(): CrosshairPosition | null {
    return this.#crosshairPos;
  }

  /**
   * Programmatically set or clear the crosshair. Same effect as the user
   * hovering over `(timeToX(time), valueToY(y))` — emits `crosshairMove`,
   * marks the overlay layer dirty, and lets `<Crosshair>` / `<Tooltip>`
   * react via their normal store subscriptions.
   *
   * Pass `null` to clear (mirrors the pointer-leave path).
   *
   * `y` is optional. Resolution order when omitted:
   *   1. **current crosshair's y** — preserves whatever the chart already
   *      has (real cursor y, or a previously-synthesised value). This is
   *      what makes the cross-chart broadcast pattern work: when an echo
   *      arrives at the chart that originated the hover, the existing y
   *      stays in place and the idempotency check below short-circuits the
   *      loop. Without preservation, the echo would overwrite the source's
   *      real cursor y with the midpoint default and the tooltip would
   *      jitter between cursor and midpoint every mouse-move.
   *   2. **midpoint of the current Y range** — fallback when there is no
   *      current crosshair (first programmatic set on a chart that hasn't
   *      been hovered yet).
   *
   * Idempotent: a call that produces the same `(time, y)` pair as the
   * current crosshair is a no-op (no emit). Combined with the y-preservation
   * above, this lets N charts broadcast their hover to each other without
   * a feedback-loop guard.
   */
  setCrosshair(pos: { time: number; y?: number } | null): void {
    if (pos === null) {
      if (this.#crosshairPos === null) return;
      this.#crosshairPos = null;
      this.#overlayScheduler.markDirty();
      this.emit('crosshairMove', null);
      return;
    }

    const { time } = pos;
    if (!Number.isFinite(time)) return;

    const current = this.#crosshairPos;
    let y: number;
    if (pos.y !== undefined) {
      y = pos.y;
    } else if (current !== null) {
      y = current.y;
    } else {
      const yRange = this.#viewport.yRange;
      y = (yRange.min + yRange.max) / 2;
    }

    // Reject non-finite y same as time — `valueToY(NaN)` produces NaN
    // pixel coords that break overlays anchoring to the crosshair.
    if (!Number.isFinite(y)) return;

    if (current !== null && current.time === time && current.y === y) return;

    const mediaX = this.timeScale.timeToX(time);
    const mediaY = this.yScale.valueToY(y);

    this.#crosshairPos = { mediaX, mediaY, time, y };
    this.#overlayScheduler.markDirty();
    this.emit('crosshairMove', this.#crosshairPos);
  }

  /** Get the last visible value and whether the absolute last point is on screen. */
  getLastValue(seriesId: string): { value: number; isLive: boolean } | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry?.store) return null;

    const last = entry.store.last();
    if (!last) return null;

    const extractValue = (p: OHLCData | TimePoint): number => ('close' in p ? p.close : p.value);

    const { from, to } = this.#viewport.visibleRange;

    // Absolute last is on screen
    if (last.time >= from && last.time <= to) {
      return { value: extractValue(last), isLive: true };
    }

    // Find the last visible point
    const visible = entry.store.getVisibleData(from, to);
    if (visible.length === 0) return null;
    return { value: extractValue(visible[visible.length - 1]), isLive: false };
  }

  /** Get the second-to-last value, useful for computing change. */
  getPreviousClose(seriesId: string): number | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry?.store) return null;
    const all = entry.store.getAll();
    if (all.length < 2) return null;
    const prev = all[all.length - 2];
    return 'close' in prev ? (prev as OHLCData).close : (prev as TimePoint).value;
  }

  getLastData(seriesId: string): OHLCData | TimePoint | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry?.store) return null;
    return entry.store.last() ?? null;
  }

  /** Find the data point closest to the given timestamp within one data interval. */
  getDataAtTime(seriesId: string, time: number): OHLCData | TimePoint | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return null;
    return entry.renderer.getDataAtTime?.(time, this.#dataInterval) ?? null;
  }

  /**
   * Get all layers' data at a given time for multi-layer series (Bar/Line
   * with stacking). Each entry carries the owning `layerIndex` and the
   * snapped sample time — callers must not derive layer identity from the
   * array index, because hidden layers are filtered out.
   */
  getLayerSnapshots(
    seriesId: string,
    time: number,
  ): { layerIndex: number; time: number; value: number; color: string }[] | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry?.visible) return null;

    return entry.renderer.getLayerSnapshots?.(time, this.#dataInterval) ?? null;
  }

  getSeriesIds(): string[] {
    if (!this.#seriesIdCache) {
      this.#seriesIdCache = this.#series.map((s) => s.id);
    }

    return this.#seriesIdCache.slice();
  }

  /**
   * True if any visible series is non-pie (line / bar / candlestick). Used
   * to gate crosshair rendering — a pie-only chart has no meaningful x/y
   * coordinate system, so the dashed hairlines would just be visual noise.
   */
  #hasNonPieSeries(): boolean {
    for (const entry of this.#series) {
      if (!entry.visible) continue;
      if (!(entry.renderer instanceof PieRenderer)) return true;
    }

    return false;
  }

  /**
   * Type of a registered series, or `null` for unknown ids. `'pie'` for
   * `PieRenderer`; everything else is a time-series (`'time'`).
   */
  getSeriesType(seriesId: string): 'pie' | 'time' | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return null;

    return entry.renderer instanceof PieRenderer ? 'pie' : 'time';
  }

  /**
   * Filter `getSeriesIds()` by renderer type. `'pie'` returns pie series,
   * `'time'` returns line/bar/candlestick.
   *
   * - `opts.visibleOnly` — exclude series with `isSeriesVisible=false`; for
   *   multi-layer series also exclude when every layer is hidden.
   * - `opts.singleLayerOnly` — exclude series with more than one layer.
   *   Useful for YLabel fallback priority (stick to a single line first).
   */
  getSeriesIdsByType(type: 'pie' | 'time', opts?: { visibleOnly?: boolean; singleLayerOnly?: boolean }): string[] {
    const visibleOnly = opts?.visibleOnly === true;
    const singleLayerOnly = opts?.singleLayerOnly === true;
    const result: string[] = [];
    for (const entry of this.#series) {
      const isPie = entry.renderer instanceof PieRenderer;
      if (type === 'pie' && !isPie) continue;
      if (type === 'time' && isPie) continue;

      const layerCount = entry.renderer.getLayerCount();
      if (singleLayerOnly && layerCount > 1) continue;

      if (visibleOnly) {
        if (!entry.visible) continue;
        if (layerCount > 1) {
          let anyLayerVisible = false;
          for (let i = 0; i < layerCount; i++) {
            if (entry.renderer.isLayerVisible(i)) {
              anyLayerVisible = true;
              break;
            }
          }
          if (!anyLayerVisible) continue;
        }
      }

      result.push(entry.id);
    }

    return result;
  }

  /**
   * Cumulative top last-value for stacked series — the point a YLabel badge
   * anchors to on the rendered stack head. Falls back to `getLastValue` for
   * series without stacked concepts (Candlestick, single-layer Line/Bar).
   * Returns `null` for unknown ids or empty series.
   */
  getStackedLastValue(seriesId: string): { value: number; isLive: boolean } | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return null;

    const stacked = entry.renderer.getStackedLastValue?.();
    if (stacked) return stacked;

    const raw = this.getLastValue(seriesId);

    return raw;
  }

  /**
   * Per-layer last snapshots with each layer's own `time`. Returns `null`
   * for single-layer renderers or when no visible layer has data. Used by
   * overlay components that must display every layer in last-mode even
   * when layers advance at different rates (ragged streams).
   */
  getLayerLastSnapshots(seriesId: string): { layerIndex: number; time: number; value: number; color: string }[] | null {
    const entry = this.#series.find((s) => s.id === seriesId);

    return entry?.renderer.getLayerLastSnapshots?.() ?? null;
  }

  /**
   * Shallow view of the internal series entries so unit tests can introspect
   * renderer state without exporting a public `getRenderer(id)` (which would
   * leak an implementation detail). Named to discourage use outside of tests.
   *
   * @internal
   */
  listSeriesForTest(): Array<{ id: string; renderer: SeriesRenderer }> {
    return this.#series.map((s) => ({ id: s.id, renderer: s.renderer }));
  }

  /** Get the primary display color for a series. */
  getSeriesColor(seriesId: string): string | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return null;
    const colors = entry.renderer.getLayerColors();
    return colors[0] ?? this.#theme.line.color;
  }

  getSeriesLabel(seriesId: string): string | undefined {
    return this.#series.find((s) => s.id === seriesId)?.label;
  }

  /** Get per-layer colors for a series. Returns null for single-layer non-bar/line series. */
  getSeriesLayers(seriesId: string): { color: string }[] | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return null;
    const count = entry.renderer.getLayerCount();
    if (count <= 1) return null;
    const colors = entry.renderer.getLayerColors();
    return Array.from({ length: count }, (_, i) => ({ color: colors[i % colors.length] }));
  }

  /** Get all slices with computed colors and percentages. Returns null for series without slice data (e.g. candlestick, line, bar). */
  getSliceInfo(seriesId: string): SliceInfo[] | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    return entry?.renderer.getSliceInfo?.(this.#theme) ?? null;
  }

  /** Get hover info (label/value/percent/color) for the currently hovered element, or null. */
  getHoverInfo(seriesId: string): HoverInfo | null {
    const entry = this.#series.find((s) => s.id === seriesId);
    return entry?.renderer.getHoverInfo?.(this.#theme) ?? null;
  }

  /** Apply a new theme and update series colors where appropriate. */
  setTheme(theme: ChartTheme): void {
    const prev = this.#theme;
    this.#theme = theme;
    for (const entry of this.#series) {
      entry.renderer.applyTheme(theme, prev);
    }
    this.#mainScheduler.markDirty();
    this.#bumpOverlayVersion();
  }

  getTheme(): ChartTheme {
    return this.#theme;
  }

  /** Update axis configuration and re-render. */
  setAxis(config: AxisConfig): void {
    const prevYW = this.yAxisWidth;
    const prevXH = this.xAxisHeight;

    this.#axis = config;
    // Sync Y bounds from axis config
    this.#yBounds = { min: config.y?.min, max: config.y?.max };
    this.#yInited = false;
    this.#emitYTarget({ kind: 'instant' });
    if (this.yAxisWidth !== prevYW || this.xAxisHeight !== prevXH) {
      this.updateScales();
    }
    this.#mainScheduler.markDirty();
  }

  /**
   * Apply label-density knobs driven by `<YAxis labelCount=… minLabelSpacing=…>`
   * — kept separate from {@link setAxis} so component props don't force a
   * Y-animation reset. Triggers a viewportChange + repaint so static charts
   * react without waiting for pan/zoom.
   */
  setYAxisLabelDensity(params: { labelCount?: number | null; minLabelSpacing?: number | null }): void {
    let dirty = false;
    if ('labelCount' in params) {
      this.yScale.setLabelCount(params.labelCount ?? null);
      dirty = true;
    }
    if ('minLabelSpacing' in params) {
      this.yScale.setMinSpacing(params.minLabelSpacing ?? null);
      dirty = true;
    }
    if (dirty) {
      this.syncScales();
      this.emit('viewportChange');
      this.#mainScheduler.markDirty();
    }
  }

  /** Label-density knobs for the time axis — mirror of {@link setYAxisLabelDensity}. */
  setTimeAxisLabelDensity(params: { labelCount?: number | null; minLabelSpacing?: number | null }): void {
    let dirty = false;
    if ('labelCount' in params) {
      this.timeScale.setLabelCount(params.labelCount ?? null);
      dirty = true;
    }
    if ('minLabelSpacing' in params) {
      this.timeScale.setMinSpacing(params.minLabelSpacing ?? null);
      dirty = true;
    }
    if (dirty) {
      this.syncScales();
      this.emit('viewportChange');
      this.#mainScheduler.markDirty();
    }
  }

  getMediaSize() {
    return this.#canvasManager.size.media;
  }

  /** Returns layout metrics for the chart area, Y axis, and time axis. */
  getLayout(): ChartLayout {
    const media = this.#canvasManager.size.media;
    const yAxisWidth = this.yAxisWidth;
    const xAxisHeight = this.xAxisHeight;
    return {
      chartArea: { x: 0, y: 0, width: media.width - yAxisWidth, height: media.height - xAxisHeight },
      yAxisWidth,
      xAxisHeight,
    };
  }

  getDataInterval(): number {
    return this.#dataInterval;
  }

  /**
   * Update viewport padding at runtime. Refits the visible time range to
   * current data bounds **only when horizontal padding (left/right) changes**
   * — vertical padding only affects the Y-range computation, so touching it
   * shouldn't reset the user's zoom / auto-scroll state. This matters when
   * a wrapper re-applies padding reactively (e.g. in response to a Title /
   * InfoBar ResizeObserver).
   */
  setPadding(padding: ChartOptions['padding']): void {
    const prev = this.#viewport.getPadding();
    this.#viewport.setPadding(padding);
    const next = this.#viewport.getPadding();
    const horizontalChanged =
      !isSameHorizontalPadding(prev.left, next.left) || !isSameHorizontalPadding(prev.right, next.right);
    const verticalChanged = prev.top !== next.top || prev.bottom !== next.bottom;
    if (horizontalChanged) {
      const { first, last } = this.getDataBounds();
      if (first !== undefined && last !== undefined) {
        const chartWidth = this.#canvasManager.size.media.width - this.yAxisWidth;
        this.#viewport.fitToData(first, last, { chartWidth });
      }
    }
    if (horizontalChanged || verticalChanged) {
      // Horizontal change shifts logicalRange → Y target moves with the new
      // window; vertical change shifts the pixel-padded yRange → renderers
      // need the next setYRange call to pick up the new top/bottom gutters.
      this.#emitYTarget({ kind: 'instant' });
    }
    this.syncScales();
    this.#mainScheduler.markDirty();
    // Vertical changes need their own emit: fitToData's viewport 'change'
    // fired before the Y re-fit, so subscribers that landed on it saw a stale
    // yScale. Re-emit after syncScales pushes the new yRange so React
    // components (YLabel, YAxis) pick up the final scale. Covers both
    // vertical-only (no prior emit) and combined changes (first emit stale).
    if (verticalChanged) {
      this.emit('viewportChange');
    }
  }

  /** Show or hide the background grid. Takes effect on the next render frame. */
  setGrid(grid: { visible: boolean }): void {
    this.#grid = grid.visible;
    this.#mainScheduler.markDirty();
  }

  /**
   * Set the visual state for one side of the chart. Typically called in
   * response to the `onEdgeReached` callback:
   *   - `loading` while a history fetch is in flight,
   *   - `no-data` once the fetch confirmed there's nothing more,
   *   - `idle` when the host no longer wants any edge affordance.
   * The state persists until replaced. `has-more` is accepted for API
   * symmetry and currently renders identically to `idle`.
   */
  setEdgeState(side: EdgeSide, state: EdgeState): void {
    if (this.#edgeStates[side] === state) return;
    this.#edgeStates[side] = state;
    this.#overlayScheduler.markDirty();
  }

  /** Read the current host-declared state for a given edge. */
  getEdgeState(side: EdgeSide): EdgeState {
    return this.#edgeStates[side];
  }

  /** Notify chart that a YLabel is present (affects right padding). */
  setYLabel(has: boolean): void {
    this.#hasYLabel = has;
    this.updateViewportPadding();
  }

  /**
   * Dispatch a crosshair move to every renderer that supports spatial hover
   * (currently: pie). Any change in hover index schedules a main-layer redraw.
   */
  #updateHover(pos: CrosshairPosition | null): void {
    const size = this.#canvasManager.size;
    const vpad = this.#viewport.getPadding();
    const padding = {
      top: vpad.top * size.verticalPixelRatio,
      bottom: vpad.bottom * size.verticalPixelRatio,
    };
    let changed = false;
    for (const entry of this.#series) {
      if (!entry.renderer.hitTest || !entry.renderer.setHoverIndex) continue;
      let index = -1;
      if (pos) {
        const bx = pos.mediaX * size.horizontalPixelRatio;
        const by = pos.mediaY * size.verticalPixelRatio;
        index = entry.renderer.hitTest(bx, by, size.bitmap.width, size.bitmap.height, padding);
      }
      if (entry.renderer.setHoverIndex(index)) {
        changed = true;
      }
    }
    if (changed) this.#mainScheduler.markDirty();
  }

  private updateViewportPadding(): void {
    // TODO: auto-detect padding from series types
  }

  /** Tear down the chart: cancel animations, remove listeners, and detach the canvas. */
  destroy(): void {
    for (const entry of this.#series) entry.renderer.dispose();
    this.#series = [];
    this.#seriesIdCache = null;
    this.#viewport.destroy();
    this.#mainScheduler.destroy();
    this.#overlayScheduler.destroy();
    this.#interactions?.destroy();
    this.#canvasManager.destroy();
    this.#perfHud?.destroy();
    this.#perfHud = null;
    // Only tear down the monitor if we created it. Caller-supplied monitors
    // may be shared across multiple charts or consumed by host telemetry.
    if (this.#ownsPerfMonitor) this.#perfMonitor?.destroy();
    this.#perfMonitor = null;
    this.#ownsPerfMonitor = false;
    this.removeAllListeners();
  }

  /** The attached performance monitor, or `null` when instrumentation is disabled. */
  getPerfMonitor(): PerfMonitor | null {
    return this.#perfMonitor;
  }

  /** Compute the earliest and latest timestamps across all series. */
  private getDataBounds(): { first: number | undefined; last: number | undefined } {
    let first: number | undefined;
    let last: number | undefined;
    for (const entry of this.#series) {
      if (!entry.visible) continue;
      if (!entry.store) continue;
      const f = entry.store.first();
      const l = entry.store.last();
      if (f && (first === undefined || f.time < first)) first = f.time;
      if (l && (last === undefined || l.time > last)) last = l.time;
    }
    return { first, last };
  }

  /** Total data points across all series at last onDataChanged — used to detect batch vs tick. */
  #prevDataLength = 0;

  /** Set by `setSeriesData`/bulk-replace paths so the next `onDataChanged`
   * snaps the Y range (instead of easing) and `yScale.getRange()` reflects
   * the new domain synchronously. Cleared by `onDataChanged` after each run. */
  #dataReplaceSnapPending = false;

  private onDataChanged(): void {
    if (this.#batchDepth > 0) {
      this.#batchDataDirty = true;
      return;
    }

    this.updateDataInterval();

    const { first, last } = this.getDataBounds();
    if (first !== undefined) this.#viewport.setDataStart(first);
    if (last !== undefined) this.#viewport.setDataEnd(last);

    // Detect how much data changed — batch load vs single tick
    let totalLength = 0;
    for (const entry of this.#series) {
      // Multi-layer renderers expose getTotalLength(); single-layer uses entry.store.
      if (entry.renderer.getTotalLength) {
        totalLength += entry.renderer.getTotalLength();
      } else if (entry.store) {
        totalLength += entry.store.length;
      }
    }
    const added = totalLength - this.#prevDataLength;
    const isBatchLoad = added > 5;
    this.#prevDataLength = totalLength;

    // X target computed inside the data block; default null = no X claim
    // (no autoscroll, no fit). Engine eases visual via the data_tick emit
    // below; first-paint / bulk-replace go through `instant` for a snap.
    let xTarget: VisibleRange | null = null;
    if (first !== undefined && last !== undefined) {
      // Logical, not visual — "has the viewport ever been committed?" is a
      // logical state question.
      const { from, to } = this.#viewport.logicalRange;
      const uninitialized = from === 0 && to === 0;
      const chartWidth = this.#canvasManager.size.media.width - this.yAxisWidth;

      if (uninitialized) {
        // First data load — fit immediately. Viewport snaps to its preset
        // capacity (`maxVisibleBars * dataInterval`); when the data is
        // smaller than that, it sits flush with the data span. Streaming
        // charts that want a warm-up window should call
        // `chart.setVisibleRange({ from, bars })` (or pass
        // `viewport.initialRange: { from, bars }`); that arms
        // `viewport.#holdUntilFilled`.
        this.#viewport.fitToData(first, last, { chartWidth });
        // One-shot `initialVisibleRange` (e.g. "last 35 bars") — applied
        // here so the Y range computed by the following `#emitYTarget` snaps
        // to the *initial-window* data rather than the full dataset. Folds
        // post-mount `setVisibleRange` calls into the first paint.
        if (this.#initialVisibleRange !== undefined) {
          this.setVisibleRange(this.#initialVisibleRange);
          this.#initialVisibleRange = undefined;
        }
        xTarget = this.#viewport.logicalRange;
      } else if (isBatchLoad && this.#viewport.autoScroll) {
        this.#viewport.fitToData(first, last, { chartWidth });
        xTarget = this.#viewport.logicalRange;
      } else if (!isBatchLoad && this.#viewport.autoScroll) {
        // Single streaming tick — preserve any pan offset across ticks via
        // `_prevDataEnd` (viewport.computeStreamingTargetX encapsulates the
        // legacy `scrollToEnd` target math without animating). Cadence EMA
        // sizes the next slide so the viewport keeps moving through to the
        // next producer tick instead of settling at a fixed 250 ms and
        // sitting idle.
        this.#cadence.observe(performance.now());
        xTarget = this.#viewport.computeStreamingTargetX(last, chartWidth);
      }
    }

    // Snap Y/X only on a true bulk replace (`chart.setSeriesData` flipped
    // `#dataReplaceSnapPending`) or on first paint (forced inside
    // `#emitYAndX` when `#yInited`/`#xInited` are false). React-batched
    // bursts and `isBatchLoad`-style fits still flow through `data_tick`
    // so the engine's X slot rides its linear curve into the new tail —
    // a Phase-2 `instant` here would snap and produce a jump-per-commit
    // pattern visible as "X teleports between batches".
    const replaceSnap = this.#dataReplaceSnapPending;
    this.#dataReplaceSnapPending = false;

    // Capture "was this the first onDataChanged call that actually had
    // data" *before* `#emitYTarget` flips `#yInited`. Initial mounts where
    // data flows in asynchronously (e.g. `useOHLCStream` first emits `[]`
    // then later `setData(history)`) hit this path on the second call;
    // the first (empty) call returns early from `#computeYTarget` without
    // setting `#yInited`.
    const isFirstDataPaint = !this.#yInited && first !== undefined;

    // Bulk replaces (full dataset swap) and batch loads land on entirely
    // new tick values. If the tick trackers stay armed with the previous
    // dataset they'd fade the old labels out and the new ones in over
    // the next 250 ms, briefly showing "ghost" grid lines from the prior
    // range. Reset so the dataset swap snaps the same way the Y emit below
    // is about to snap the Y bound.
    if (replaceSnap || isBatchLoad) {
      this.yScale.tickTracker.reset();
      this.timeScale.tickTracker.reset();
    }

    const yKind: 'instant' | 'data_tick' = replaceSnap ? 'instant' : 'data_tick';
    // Combined Y+X emit. Previously this was two `bridge.emit*` calls each
    // with its own `#applyEngineState` (engine.tick + viewport push +
    // syncScales). Streaming ticks at 60 ms × 8 charts in the stress group
    // turn that into 480 redundant engine ticks / second — combining the
    // claims into a single event keeps the engine merge algorithm intact
    // (Y and X are independent slot processors anyway) and halves the
    // per-data-point engine work.
    this.#emitYAndX({ kind: yKind, xTarget });
    // Re-sync scales so React components read correct yScale values.
    this.syncScales();

    // On the very first paint with data, render synchronously so the
    // canvas comes up alongside the DOM (YLabel, axis labels) in the
    // same browser paint. Subsequent updates go through `markDirty` so
    // streaming ticks coalesce per RAF and Y-range easing gets at least
    // one frame to advance before painting.
    if (isFirstDataPaint) {
      this.renderMain();
    } else {
      this.#mainScheduler.markDirty();
    }
    this.emit('dataUpdate');
    this.#bumpOverlayVersion();
  }

  private updateDataInterval(): void {
    for (const entry of this.#series) {
      if (!entry.store) continue;
      const all = entry.store.getAll();
      if (all.length >= 2) {
        const times = all.slice(0, 20).map((d) => d.time);
        this.#dataInterval = detectInterval(times);
        this.#viewport.setDataInterval(this.#dataInterval);
        break;
      }
    }
  }

  /** Whether the Y range has been initialized (first snap vs smooth lerp).
   *  Pre-init Y emits are forced to `instant` so the first paint snaps to
   *  data regardless of the caller's requested kind. Also reset by paths
   *  that intentionally invalidate the current Y baseline (axis bound
   *  change, empty viewport). */
  #yInited = false;
  /** Whether the engine's X slot has received its first emit. Pre-init X
   *  emits are forced to `instant` so first paint snaps to the fitted
   *  range — without this guard the engine would ease from `{0,0}` into
   *  the new target and the very first frame would render with a
   *  zero-width X domain. */
  #xInited = false;

  /**
   * One-shot `setVisibleRange` argument applied on the first data arrival.
   * Captured at chart construction from {@link ChartOptions.viewport.initialRange};
   * cleared the moment it's consumed so subsequent data swaps don't snap
   * back to the initial window.
   */
  #initialVisibleRange: VisibleRangeSpec | undefined;

  /** Last Y bounds the engine resolved into {@link AnimationState.yRange}.
   *  Used by {@link renderMain} to detect Y movement frame-to-frame so
   *  `viewportChange` only emits when the Y range actually shifted — DOM
   *  axis labels subscribe to that event and re-renders on every tick are
   *  expensive. Initialised to NaN so the first real Y emit always passes
   *  the change check. */
  #prevYMin = Number.NaN;
  #prevYMax = Number.NaN;

  /**
   * Sample data inside `targetVisible` and return the unbounded [min, max] of
   * the visible series, or `null` when nothing is in view. Bounds are NOT
   * applied here — the caller composes them via {@link resolveBound}.
   *
   * `targetVisible` is the X *destination* (logicalRange), not the animating
   * current. Sampling against a moving X would make Y chase a definition of
   * "in view" that shifts every frame; passing the destination explicitly
   * keeps Y on a stable target so X and Y converge together.
   */
  private computeTargetYRange(
    targetVisible: VisibleRange,
    allValues: number[] | null,
  ): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;

    for (const entry of this.#series) {
      if (!entry.visible) continue;

      // If the renderer provides a custom value range (e.g. stacked totals), use it
      if (entry.renderer.getValueRange) {
        const r = entry.renderer.getValueRange(targetVisible.from, targetVisible.to);
        if (r) {
          if (r.max > max) max = r.max;
          if (r.min < min) min = r.min;
          allValues?.push(r.min, r.max);
          continue;
        }
      }
      if (!entry.store) continue;
      const visible = entry.store.getVisibleData(targetVisible.from, targetVisible.to);
      for (const point of visible) {
        if ('high' in point) {
          const ohlc = point as OHLCData;
          // Skip non-finite values (null / undefined / NaN / ±Infinity). Without
          // the guard, `Infinity` poisons max, `-Infinity` poisons min, and
          // `null` coerces to 0, collapsing the range to a single flat line.
          if (Number.isFinite(ohlc.high)) {
            if (ohlc.high > max) max = ohlc.high;
            allValues?.push(ohlc.high);
          }
          if (Number.isFinite(ohlc.low)) {
            if (ohlc.low < min) min = ohlc.low;
            allValues?.push(ohlc.low);
          }
        } else {
          const line = point as TimePoint;
          if (Number.isFinite(line.value)) {
            if (line.value > max) max = line.value;
            if (line.value < min) min = line.value;
            allValues?.push(line.value);
          }
        }
      }
    }

    if (min === Infinity || max === -Infinity) return null;

    return { min, max };
  }

  /**
   * Sample the visible data window and return the resolved Y bounds, or
   * `null` when no series has data inside the X destination range.
   * Sampling runs against `logicalRange` (the X target, not the animating
   * current) so Y stays on a stable target while X eases — both dimensions
   * converge together. Clears {@link #yInited} on empty so the next emit
   * with valid data lands as an instant snap.
   */
  #computeYTarget(): { min: number; max: number } | null {
    const targetVisible = this.#viewport.logicalRange;

    // Only collect individual values when bounds use a function/percentage (rare).
    const needsAllValues =
      (this.#yBounds.min !== undefined && this.#yBounds.min !== 'auto' && typeof this.#yBounds.min !== 'number') ||
      (this.#yBounds.max !== undefined && this.#yBounds.max !== 'auto' && typeof this.#yBounds.max !== 'number');
    const allValues: number[] | null = needsAllValues ? [] : null;

    const raw = this.computeTargetYRange(targetVisible, allValues);
    if (raw === null) {
      this.#yInited = false;
      return null;
    }

    const min = this.resolveBound(this.#yBounds.min, raw.min, raw.max, allValues ?? [], 'min');
    const max = this.resolveBound(this.#yBounds.max, raw.max, raw.min, allValues ?? [], 'max');

    return { min, max };
  }

  /**
   * Compute the Y target and route it through {@link AnimationBridge} with
   * the requested event kind. Single emit point for every Y-driving code
   * path (data ingest, visibility-toggle layers, axis change, gesture).
   *
   * - `instant` — zero-duration snap, used for first paint, bulk replace,
   *   `setAxis`, `setPadding`, layer-visibility toggles, and the post-
   *   construction `setVisibleRange` / `fitContent` paths.
   * - `data_tick` — streaming append. Preserves the asymmetric sticky-Y
   *   baseline: fast outward expand keeps a new extreme inside the axis
   *   (no canvas-edge clip), slow inward contract avoids reflowing the
   *   whole chart when a one-tick outlier scrolls out of the window.
   * - `gesture` — pan / zoom. Symmetric `y.gestureMs` settle so the axis
   *   converges within ~1 frame per wheel tick instead of trailing through
   *   the long sticky contract budget.
   *
   * Pre-`#yInited` state forces `instant` regardless of the requested kind
   * so first paint always snaps to data.
   *
   * The trailing {@link #applyEngineState} call ticks the engine at the current
   * wall clock so synchronous readers (`chart.getYRange()` immediately after
   * `setSeriesData` / `setSeriesVisible`) observe the new range without
   * waiting for the next RAF. For zero-duration emits this lands at target
   * on the same call; for eased kinds the transition starts from current
   * and progresses on subsequent renderMain ticks.
   */
  #emitYTarget(opts: { kind: 'instant' | 'data_tick' | 'gesture' }): void {
    const target = this.#computeYTarget();
    if (target === null) return;

    const firstPaint = !this.#yInited;
    this.#yInited = true;

    const kind = firstPaint ? 'instant' : opts.kind;
    // Capture wall once: passing the same value as `startWall` on the emit
    // and as `now` to the engine tick keeps `effectiveNow === startWall` so
    // a zero-duration event isn't pruned by microsecond drift before the
    // slot processor sees it.
    const now = performance.now();

    if (kind === 'instant') {
      this.#bridge.emitInstant({ yTarget: { target }, startWall: now });
    } else if (kind === 'data_tick') {
      const dataTickMs = this.#animationsConfig.x.dataTickMs;
      this.#bridge.emitDataTick({
        duration: dataTickMs > 0 ? dataTickMs : DEFAULT_HERMITE_EXPAND,
        xTarget: null,
        yTarget: {
          target,
          expandMs: DEFAULT_HERMITE_EXPAND,
          contractMs: DEFAULT_HERMITE_CONTRACT,
        },
        startWall: now,
      });
    } else {
      const gestureMs = this.#animationsConfig.y.gestureMs;
      this.#bridge.emitGesture({
        duration: gestureMs,
        yTarget: { target },
        startWall: now,
      });
    }

    this.#applyEngineState(now);
  }

  /**
   * Single-event Y + X emit, used by the streaming / bulk-replace data
   * ingest path where both targets land on the same `effectiveNow`.
   * Replaces two back-to-back `#emitYTarget` + `#emitXTarget` calls (each
   * with their own `engine.tick` + viewport push + `syncScales`) with one
   * `bridge.emit*` + one `#applyEngineState`. Engine merge resolves the Y
   * and X slot claims independently per its priority-by-kind rules — the
   * combined event carries no semantic difference, just lower per-tick
   * overhead. Pre-`#yInited` / `#xInited` state forces `instant` so first
   * paint snaps both axes atomically.
   */
  #emitYAndX(opts: { kind: 'instant' | 'data_tick'; xTarget: VisibleRange | null }): void {
    const yTarget = this.#computeYTarget();
    if (yTarget === null && opts.xTarget === null) return;

    const firstPaint = !this.#yInited || !this.#xInited;
    if (yTarget !== null) this.#yInited = true;
    if (opts.xTarget !== null) this.#xInited = true;

    const kind = firstPaint ? 'instant' : opts.kind;
    const now = performance.now();

    if (kind === 'instant') {
      // First paint / bulk replace also seeds live slots with each series'
      // current last value. Without this the slot is born only on the next
      // `data_tick` emit (`#processLiveScalarSlots` creates it with
      // `current = item.target` of that event), which means the very first
      // live-value retarget on a new dataset SNAPS to the new target instead
      // of easing from the previous frame's displayed value. The renderer
      // then draws the new value against a yScale that's still mid-ease,
      // which can place coordinates far outside the canvas for one frame.
      const live = this.#collectLiveTargets();
      const allLiveScalar = [...live.eased.scalar, ...live.snap.scalar];
      const allLiveOHLC = [...live.eased.ohlc, ...live.snap.ohlc];
      this.#bridge.emitInstant({
        yTarget: yTarget !== null ? { target: yTarget } : undefined,
        xTarget: opts.xTarget ?? undefined,
        liveScalar: allLiveScalar.length > 0 ? allLiveScalar : undefined,
        liveOHLC: allLiveOHLC.length > 0 ? allLiveOHLC : undefined,
        startWall: now,
      });
    } else {
      // Streaming `data_tick`. Y carries the asymmetric sticky-Y baseline
      // (fast expand / slow contract); X duration comes from the cadence
      // EMA so the slide stays in lockstep with the producer. Live last-
      // point retargets (line/bar scalar, candlestick OHLC) ride the same
      // event so the displayed last point eases in lockstep with X scroll.
      const dataTickMs = this.#animationsConfig.x.dataTickMs;
      const xDuration = dataTickMs > 0 ? this.#cadence.pickDuration(dataTickMs) : 0;
      const live = this.#collectLiveTargets();
      this.#bridge.emitDataTick({
        duration: xDuration,
        xTarget: opts.xTarget,
        yTarget:
          yTarget !== null
            ? {
                target: yTarget,
                expandMs: DEFAULT_HERMITE_EXPAND,
                contractMs: DEFAULT_HERMITE_CONTRACT,
              }
            : null,
        liveScalar: live.eased.scalar.length > 0 ? live.eased.scalar : undefined,
        liveOHLC: live.eased.ohlc.length > 0 ? live.eased.ohlc : undefined,
        startWall: now,
      });

      // Snap-required live retargets (`smoothMs: 0` series) ride a parallel
      // `instant` event. Higher priority (4 vs data_tick=1) wins the slot
      // against any in-flight tick claim, and zero duration lands the slot
      // at target on this frame — visually a snap while X still scrolls.
      if (live.snap.scalar.length > 0 || live.snap.ohlc.length > 0) {
        this.#bridge.emitInstant({
          liveScalar: live.snap.scalar.length > 0 ? live.snap.scalar : undefined,
          liveOHLC: live.snap.ohlc.length > 0 ? live.snap.ohlc : undefined,
          startWall: now,
        });
      }
    }

    this.#applyEngineState(now);
  }

  /**
   * Walk every visible series and pack its last point as a live-track
   * retarget. Series with `smoothMs > 0` go into the `eased.*` buckets,
   * which ride the next `data_tick` (the live value lerps over the same
   * duration as the X scroll). Series with `smoothMs <= 0` go into the
   * `snap.*` buckets, which the chart routes through a separate `instant`
   * emit — that event preempts any in-flight `data_tick` claim on those
   * slots, so the displayed last value lands at target immediately even
   * while X is still scrolling smoothly.
   */
  #collectLiveTargets(): {
    eased: { scalar: LiveScalarTarget[]; ohlc: LiveOHLCTarget[] };
    snap: { scalar: LiveScalarTarget[]; ohlc: LiveOHLCTarget[] };
  } {
    const eased = { scalar: [] as LiveScalarTarget[], ohlc: [] as LiveOHLCTarget[] };
    const snap = { scalar: [] as LiveScalarTarget[], ohlc: [] as LiveOHLCTarget[] };

    for (const entry of this.#series) {
      if (!entry.visible) continue;

      const kind = this.#rendererKind(entry.renderer);
      if (kind === null) continue;

      const smoothMs =
        kind === 'candle'
          ? this.#animationsConfig.series.candlestick.smoothMs
          : kind === 'line'
            ? this.#animationsConfig.series.line.smoothMs
            : this.#animationsConfig.series.bar.smoothMs;
      const targetBucket = smoothMs <= 0 ? snap : eased;

      if (kind === 'candle') {
        const last = entry.store?.last() as OHLCData | undefined;
        if (last !== undefined) {
          targetBucket.ohlc.push({ seriesId: entry.id, layerIdx: 0, target: last });
        }
        continue;
      }

      // Multi-layer scalar — iterate layers and push only those with data.
      const layerCount = entry.renderer.getLayerCount();
      const snapshots = entry.renderer.getLayerLastSnapshots?.();
      if (snapshots !== null && snapshots !== undefined) {
        for (const s of snapshots) {
          targetBucket.scalar.push({ seriesId: entry.id, layerIdx: s.layerIndex, target: s.value });
        }
        continue;
      }

      // Single-layer line/bar (or stacked renderers without per-layer snapshots).
      if (layerCount === 1) {
        const last = entry.renderer.getLastValue?.();
        if (last !== null && last !== undefined) {
          targetBucket.scalar.push({ seriesId: entry.id, layerIdx: 0, target: last });
        }
      }
    }

    return { eased, snap };
  }

  /**
   * Route the current logical X range through the engine. Mirrors
   * {@link #emitYTarget} but for the X slot.
   *
   * - `instant` — first paint, bulk replace, `setAxis`, `setPadding`, layer
   *   visibility, batch-end flush. Engine snaps X (visual lands at target
   *   this tick).
   * - `data_tick` — streaming append (with autoScroll), batch load,
   *   `fitContent`, `setVisibleRange`. Engine eases X over the cadence-
   *   smoothed duration so the viewport keeps sliding through to the next
   *   producer tick instead of settling early.
   * - `gesture` — pan / zoom. Engine eases over `x.gestureMs` (default 0 →
   *   instant). Priority-by-kind merge guarantees the gesture preempts any
   *   in-flight `data_tick` on the X slot.
   *
   * `opts.xTarget` overrides the source: streaming feeds pass the
   * `computeStreamingTargetX` result (with offset preservation) instead of
   * the just-snapped `viewport.logicalRange`.
   */
  #emitXTarget(opts: { kind: 'instant' | 'data_tick' | 'gesture'; xTarget?: VisibleRange | null }): void {
    if (opts.xTarget === null) return;
    const target = opts.xTarget ?? this.#viewport.logicalRange;
    // Pre-init guard: viewport hasn't been fit yet, target is {0,0}.
    if (target.to <= target.from) return;

    const firstPaint = !this.#xInited;
    this.#xInited = true;
    const kind = firstPaint ? 'instant' : opts.kind;

    const now = performance.now();

    if (kind === 'instant') {
      this.#bridge.emitInstant({ xTarget: target, startWall: now });
    } else if (kind === 'data_tick') {
      const floor = this.#animationsConfig.x.dataTickMs;
      const duration = floor > 0 ? this.#cadence.pickDuration(floor) : 0;
      this.#bridge.emitDataTick({
        duration,
        xTarget: target,
        yTarget: null,
        startWall: now,
      });
    } else {
      const gestureMs = this.#animationsConfig.x.gestureMs;
      this.#bridge.emitGesture({
        duration: gestureMs,
        xTarget: target,
        startWall: now,
      });
    }

    this.#applyEngineState(now);
  }

  /**
   * Diff the new tick values against the tracker's current set; when
   * something entered or exited, emit a `tickFade` event so the engine's
   * `state.tickOpacity` map can drive both the canvas grid lines and the
   * DOM axis labels through the same opacity curve. Pre-armed (initial
   * mount, dataset swap) the emit's `duration: 0` routes through the
   * zero-duration guard so the tick set snaps to full alpha without an
   * opening fade.
   */
  #emitTickFade(tracker: AxisTickTracker, next: readonly number[], _axis: 'y' | 'time'): void {
    // Tracker owns its own opacity animators now — pushing the next set
    // diffs internally and starts the appropriate fades. No engine event
    // emit; chart.renderMain calls `tracker.tick(now)` per frame to
    // advance them in lockstep with the rest of the chart's animation.
    tracker.setCurrentTicks(next);
  }

  /**
   * Tick the engine at the given wall clock and push the resolved X / Y
   * ranges into the viewport + scales. Called from every emit path so that
   * synchronous readers (`chart.getYRange()`, `chart.getVisibleRange()`
   * immediately after `setSeriesData` / `setSeriesVisible`) see the new
   * values without waiting for the next RAF — matches the legacy contract
   * pinned by `data-update-sync`, `visibility-batch`, and the `y-label`
   * repositioning tests.
   *
   * The caller passes the same wall it used as the event's `startWall` so
   * `effectiveNow === startWall` and the prune step keeps zero-duration
   * events long enough for the slot processor to snap them.
   */
  #applyEngineState(now: number): void {
    const state = this.#engine.tick(now);
    const size = this.#canvasManager.size;
    if (size.media.width === 0 || size.media.height === 0) return;

    const hasMinBound = this.#yBounds.min !== undefined && this.#yBounds.min !== 'auto';
    const hasMaxBound = this.#yBounds.max !== undefined && this.#yBounds.max !== 'auto';
    const chartHeight = size.media.height - this.xAxisHeight;
    this.#viewport.setYRange(state.yRange.min, state.yRange.max, chartHeight, hasMinBound, hasMaxBound);
    this.#viewport.setVisualRange(state.xRange);
    this.#prevYMin = state.yRange.min;
    this.#prevYMax = state.yRange.max;
    this.syncScales();
  }

  /** Resolve an {@link AxisBound} to a concrete numeric value. */
  private resolveBound(
    bound: AxisBound | undefined,
    autoValue: number,
    otherValue: number,
    values: number[],
    side: 'min' | 'max',
  ): number {
    if (bound === undefined || bound === 'auto') return autoValue;
    if (typeof bound === 'number') return bound;
    if (typeof bound === 'function') return bound(values);
    // Parse percentage string like "+10%", "-5%"
    const match = String(bound).match(/^([+-]?)\s*(\d+(?:\.\d+)?)\s*%$/);
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      const pct = parseFloat(match[2]) / 100;
      const dataRange = Math.abs(otherValue - autoValue) || Math.abs(autoValue) || 1;
      return autoValue + sign * pct * dataRange * (side === 'max' ? 1 : -1);
    }
    return autoValue;
  }

  /**
   * Lightweight scale sync: updates timeScale/yScale from current viewport state
   * without advancing the Y smoothing animation. Called from the viewport 'change'
   * handler so DOM axis components always read fresh coordinates on re-render.
   */
  private syncScales(): void {
    const size = this.#canvasManager.size;
    if (size.media.width === 0 || size.media.height === 0) return;

    const chartWidth = size.media.width - this.yAxisWidth;
    const chartHeight = size.media.height - this.xAxisHeight;

    this.timeScale.update(this.#viewport.visibleRange, chartWidth, size.horizontalPixelRatio, this.#dataInterval);
    this.yScale.update(this.#viewport.yRange, chartHeight, size.verticalPixelRatio);
  }

  /**
   * Refresh timeScale + yScale against current viewport state. Identical to
   * {@link syncScales}; kept as a separate method so callers can grep for
   * the post-mutation refresh path (resize, axis-bound change). The legacy
   * version also drove the Y animator — that path now lives entirely on the
   * engine, refreshed once per renderMain after {@link AnimationEngine.tick}.
   */
  private updateScales(): void {
    this.syncScales();
  }

  /** Expensive: background, grid, all series. Only on data/viewport/resize change. */
  private renderMain(timestamp?: number): void {
    const size = this.#canvasManager.size;
    if (size.media.width === 0 || size.media.height === 0) return;

    // Engine owns both X and Y animation. Prefer the RAF-provided timestamp
    // so deterministic test harnesses (installRaf) drive the engine's dt
    // from synthetic frame time instead of the real wall clock.
    const now = typeof timestamp === 'number' ? timestamp : performance.now();

    const animationState = this.#engine.tick(now);
    if (animationState.animating) {
      this.#mainScheduler.markDirty();
    }

    // Push the engine-resolved X / Y ranges into viewport (X is the cached
    // visual the rest of the chart reads via `viewport.visibleRange`; Y
    // applies pixel padding from `viewport.padding`). Detect Y movement
    // frame-to-frame so `viewportChange` only emits when the axis shifted —
    // DOM axis labels subscribe to that event and re-renders aren't free.
    this.#viewport.setVisualRange(animationState.xRange);
    const yMin = animationState.yRange.min;
    const yMax = animationState.yRange.max;
    const yChanged = yMin !== this.#prevYMin || yMax !== this.#prevYMax;
    if (yChanged) {
      const hasMinBound = this.#yBounds.min !== undefined && this.#yBounds.min !== 'auto';
      const hasMaxBound = this.#yBounds.max !== undefined && this.#yBounds.max !== 'auto';
      const chartHeight = size.media.height - this.xAxisHeight;
      this.#viewport.setYRange(yMin, yMax, chartHeight, hasMinBound, hasMaxBound);
      this.#prevYMin = yMin;
      this.#prevYMax = yMax;
    }

    this.updateScales();

    // Re-engage tail-following when a user pan brings the destination back
    // into the data zone. Reads the logical X target (bridge.lastXTarget)
    // so the flip happens at the *destination*, not one or two frames
    // earlier when the eased visual dips through.
    this.#autoscroll.tick(this.#viewport.dataEnd);

    if (yChanged) {
      this.emit('viewportChange');
    }

    // Tick-tracker animation state — set inside the useMainLayer callback,
    // read by the settled-check below. Declared here so both blocks share
    // the same lexical scope.
    let yTickAnimating = false;
    let timeTickAnimating = false;

    this.#canvasManager.useMainLayer((scope) => {
      const { context, bitmapSize } = scope;
      const chartBitmapWidth = (size.media.width - this.yAxisWidth) * size.horizontalPixelRatio;
      const chartBitmapHeight = (size.media.height - this.xAxisHeight) * size.verticalPixelRatio;

      // Clear canvas (background gradient is applied via CSS on the container)
      context.clearRect(0, 0, bitmapSize.width, bitmapSize.height);

      context.save();
      context.beginPath();
      context.rect(0, 0, chartBitmapWidth, chartBitmapHeight);
      context.clip();

      // Diff current tick sets against the previous frame's and route the
      // entering / exiting tick values through the engine. The engine's
      // tickFade slot owns the 0→1 / 1→0 opacity ease; the tracker is now
      // a passive holder of the current set (plus the previous, for the
      // diff). Each surface that reads ticks (canvas grid, DOM axis
      // labels) sources opacity from `state.tickOpacity` via the same
      // snapshot helper so they animate in lockstep frame-for-frame.
      const yTickValues = this.yScale.niceTickValues();
      const timeTickValues = this.timeScale.niceTickValues(this.#dataInterval).ticks;
      this.#emitTickFade(this.yScale.tickTracker, yTickValues, 'y');
      this.#emitTickFade(this.timeScale.tickTracker, timeTickValues, 'time');
      this.yScale.tickTracker.tick(now);
      this.timeScale.tickTracker.tick(now);
      const yTickSnap = this.yScale.tickTracker.snapshot();
      const timeTickSnap = this.timeScale.tickTracker.snapshot();
      yTickAnimating = yTickSnap.isAnimating;
      timeTickAnimating = timeTickSnap.isAnimating;
      // The engine's overall `animating` flag already covers the fade —
      // renderMain marks dirty unconditionally when state.animating is
      // true (see the early `engine.tick` block). No extra emit needed
      // here; React / Svelte / Vue axis components subscribe to
      // `viewportChange` (which fires on Y change) for re-render kicks,
      // and to `tickFrame` for the in-between opacity advances. Emit
      // `tickFrame` whenever this snapshot reads a fading tick so DOM
      // surfaces refresh without a synthetic Y-change.
      if (yTickSnap.isAnimating || timeTickSnap.isAnimating) {
        this.emit('tickFrame');
      }

      if (this.#grid) {
        renderGrid({
          scope,
          timeScale: this.timeScale,
          yScale: this.yScale,
          theme: this.#theme,
          yTicks: yTickSnap,
          timeTicks: timeTickSnap,
        });
      }

      const vpad = this.#viewport.getPadding();
      const padding = { top: vpad.top, bottom: vpad.bottom };
      const perfMon = this.#perfMonitor;
      for (const entry of this.#series) {
        // Renderer-owned per-series alpha drives the show/hide fade. A
        // hidden series with alpha at 0 is fully gone — skip. A hidden
        // series mid-fade still renders at its fading alpha; the
        // `entry.visible` flag exists only to gate Y-range inclusion, not
        // rendering. Renderers without `getAlpha` (pie) fall back to the
        // binary visible flag.
        const alpha = entry.renderer.getAlpha?.() ?? (entry.visible ? 1 : 0);
        if (alpha <= 0) continue;

        const renderArgs = {
          scope,
          timeScale: this.timeScale,
          yScale: this.yScale,
          theme: this.#theme,
          dataInterval: this.#dataInterval,
          padding,
          state: animationState,
          seriesId: entry.id,
        };

        const prevAlpha = context.globalAlpha;
        if (alpha < 1) context.globalAlpha = prevAlpha * alpha;

        if (perfMon) {
          const s0 = performance.now();
          entry.renderer.render(renderArgs);
          // Stamp per-series samples with the current frame timestamp so the
          // monitor's time-window trim picks them up in step with the main
          // frame sample recorded at the bottom of this callback.
          perfMon.recordSeries(entry.id, performance.now() - s0, now);
        } else {
          entry.renderer.render(renderArgs);
        }

        if (alpha < 1) context.globalAlpha = prevAlpha;
      }

      context.restore();
    });

    // Generic animation poll — any renderer that still needs a frame keeps us going.
    let seriesNeedsAnim = false;
    for (const entry of this.#series) {
      if (entry.renderer.needsAnimation) {
        seriesNeedsAnim = true;
        this.#mainScheduler.markDirty();
        break;
      }
    }

    // Arm the tick fade trackers only once the entire chart has reached a
    // settled state — viewport animation done, no series entrance animation,
    // and no tracker fades in flight. Until then, tick churn from the initial
    // mount (fitToData, `setVisibleRange` deep-link, streaming pre-roll) all
    // snaps so the user doesn't see a long opening fade.
    // Arm the tick fade trackers the first time the entire chart reaches a
    // settled state — viewport animation done, no series entrance, no
    // tracker fades in flight. Initial mount snaps every transient tick
    // set; from the first quiescent frame on, set changes fade in/out.
    // We never disarm: `niceTickValues` typically returns the same set
    // across consecutive frames once the tick interval is resolved, so
    // streaming + zoom don't churn the tracker — only real set changes do.
    const trackersStillFading = yTickAnimating || timeTickAnimating;
    // Engine `animating` covers both X (engine X slot) and Y (transition);
    // viewport no longer has its own X animator since Phase 2 step 2.
    if (!animationState.animating && !seriesNeedsAnim && !trackersStillFading) {
      this.yScale.tickTracker.markArmed();
      this.timeScale.tickTracker.markArmed();
    }

    // Main layer changed — overlay needs to redraw on top
    this.renderOverlay();
  }

  /** Cheap overlay: crosshair, nearest-point dots, pulse animation, edge indicator. */
  private renderOverlay(_timestamp?: number): void {
    const size = this.#canvasManager.size;
    if (size.media.width === 0 || size.media.height === 0) return;

    // Determine whether any renderer wants a persistent overlay tick (e.g. line pulse).
    let overlayAnimates = false;
    for (const entry of this.#series) {
      if (entry.visible && entry.renderer.overlayNeedsAnimation) {
        overlayAnimates = true;
        break;
      }
    }

    // The loading-state edge indicator animates a spinner; keep the overlay ticking.
    const edgeAnimates = this.#edgeStates.left === 'loading' || this.#edgeStates.right === 'loading';
    // Any non-idle edge needs a single redraw; only `loading` needs continuous frames.
    const edgeVisible = this.#edgeStates.left !== 'idle' || this.#edgeStates.right !== 'idle';

    this.#canvasManager.useOverlayLayer((scope) => {
      // Guard inside callback — useOverlayLayer clears the canvas first,
      // so we must always enter it to erase stale crosshair/dots on mouseleave.
      if (!this.#crosshairPos && !overlayAnimates && !edgeVisible) return;

      const chartBitmapWidth = (size.media.width - this.yAxisWidth) * size.horizontalPixelRatio;
      const chartBitmapHeight = (size.media.height - this.xAxisHeight) * size.verticalPixelRatio;

      scope.context.save();
      scope.context.beginPath();
      scope.context.rect(0, 0, chartBitmapWidth, chartBitmapHeight);
      scope.context.clip();

      // Base crosshair lines on top of the clipped area. Skip when the only
      // visible series is pie — crosshair hairlines read as time/price
      // coordinates, which have no meaning on a pie and would just obscure
      // the disk.
      if (this.#crosshairPos && this.#hasNonPieSeries()) {
        const bx = this.#crosshairPos.mediaX * size.horizontalPixelRatio;
        const by = this.#crosshairPos.mediaY * size.verticalPixelRatio;
        renderCrosshair(scope, bx, by, this.#theme);
      }

      // Dispatch to each renderer's overlay hook — crosshair dots, pulses, etc.
      const ovpad = this.#viewport.getPadding();
      const overlayPadding = { top: ovpad.top, bottom: ovpad.bottom };
      const overlayState = this.#engine.getAnimationState();
      for (const entry of this.#series) {
        if (!entry.visible) continue;
        entry.renderer.drawOverlay?.({
          scope,
          timeScale: this.timeScale,
          yScale: this.yScale,
          theme: this.#theme,
          dataInterval: this.#dataInterval,
          padding: overlayPadding,
          crosshair: this.#crosshairPos,
          state: overlayState,
          seriesId: entry.id,
        });
      }

      // Edge indicators last — they paint over any series overlay that happened
      // to land in the overshoot area.
      if (edgeVisible) {
        this.drawEdgeIndicators(scope, size.media.height - this.xAxisHeight);
      }

      scope.context.restore();
    });

    // Keep overlay animating while any renderer still requests it and its animated
    // content is within the visible time range. Renderers that don't expose
    // hasOverlayContentInRange fall back to "assume visible".
    if (overlayAnimates) {
      const { from, to } = this.timeScale.getRange();
      let visibleLast = false;
      for (const entry of this.#series) {
        if (!entry.visible || !entry.renderer.overlayNeedsAnimation) continue;
        if (entry.renderer.hasOverlayContentInRange?.(from, to) ?? true) {
          visibleLast = true;
          break;
        }
      }
      if (visibleLast) this.#overlayScheduler.markDirty();
    }

    // Spinner needs a frame cadence of its own, independent of series overlays.
    if (edgeAnimates) this.#overlayScheduler.markDirty();
  }

  private drawEdgeIndicators(
    scope: Parameters<Parameters<CanvasManager['useOverlayLayer']>[0]>[0],
    chartMediaHeight: number,
  ): void {
    const now = performance.now();
    for (const side of ['left', 'right'] as const) {
      const state = this.#edgeStates[side];
      if (state === 'idle' || state === 'has-more') continue;
      const boundaryTime = this.resolveEdgeBoundary(side);
      if (boundaryTime === null) continue;
      renderEdgeIndicator({
        scope,
        timeScale: this.timeScale,
        theme: this.#theme,
        chartMediaHeight,
        boundaryTime,
        side,
        state,
        now,
      });
    }
  }

  /**
   * Pick the boundary time to anchor the edge indicator at. Prefer the
   * cached value emitted by the most recent `edgeReached` — that's the
   * *exact* point the user overshot. Fall back to the current data edge
   * when no gesture has fired yet (host might invoke `setEdgeState`
   * directly on mount to show a "no-data" marker from the start).
   */
  private resolveEdgeBoundary(side: EdgeSide): number | null {
    const cached = this.#edgeBoundaries[side];
    if (cached !== null) return cached;
    const { first, last } = this.getDataBounds();
    return side === 'left' ? (first ?? null) : (last ?? null);
  }
}

/**
 * Shallow-compare two horizontal padding values (pixels or `{ intervals }`).
 * Used by `setPadding` to decide whether a viewport refit is needed.
 */
function isSameHorizontalPadding(a: HorizontalPadding, b: HorizontalPadding): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'object' && typeof b === 'object') return a.intervals === b.intervals;
  return false;
}
