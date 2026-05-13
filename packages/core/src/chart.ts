import { Animator, easeLinear, easeOutCubic } from './animation';
import {
  DEFAULT_ENTER_MS,
  DEFAULT_INPUT_RESPONSE_MS,
  DEFAULT_PULSE_MS,
  DEFAULT_REBOUND_MS,
  DEFAULT_SMOOTH_MS,
  DEFAULT_Y_AXIS_MS,
  INTERACT_Y_AXIS_MS,
  STREAMING_Y_IDLE_RESET_MS,
} from './animation-constants';
import { CanvasManager } from './canvas-manager';
import { renderCrosshair } from './components/crosshair';
import { renderEdgeIndicator } from './components/edge-indicator';
import { renderGrid } from './components/grid';
import { TimeSeriesStore } from './data/store';
import { EventEmitter } from './events';
import { InteractionHandler } from './interactions/handler';
import { registerChartViewport } from './internal/test-handles';
import { PerfHud } from './perf/perf-hud';
import { PerfMonitor, type PerfMonitorOptions } from './perf/perf-monitor';
import { RenderScheduler } from './render-scheduler';
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
 * Time-value or boolean used throughout the animation API. `false` disables
 * the category; a number configures its duration/time-constant in milliseconds
 * (`0` also disables, useful when the caller wants a number shape).
 */
export type AnimationTime = number | false;

/**
 * Chart-level animation configuration. Two independent domains so per-series
 * defaults can't bleed into viewport-interaction timings.
 *
 * **Two layers — chart-level vs per-series.** The same data-animation knobs
 * live on both layers; remember which is which:
 *
 * | Field | Chart-level (here) | Per-series option |
 * | ----- | ------------------ | ----------------- |
 * | Entry duration | {@link AnimationsConfig.points}`.enterMs` | `<XSeries options={{ entryMs }}>` (canonical name; `enterMs` is a `@deprecated` alias) |
 * | Live smoothing | `points.smoothMs` | `options={{ smoothMs }}` |
 * | Line pulse period | `points.pulseMs` | `<LineSeries options={{ pulseMs }}>` |
 *
 * Resolution: per-series option **wins** (it's the override). The chart-
 * level field acts as the default for every series that didn't set its own
 * override — *except* when the chart-level category is explicitly `false`,
 * which is a hard disable that overrides per-series too.
 *
 * - `points` — applied to data: entrance tween, live-tracking smoothing of
 *   the last candle/bar/line value, line pulse cadence.
 * - `viewport` — applied to viewport interactions: post-gesture rebound,
 *   Y-axis range chase, optional per-event ease for pan/zoom. Has no
 *   per-series equivalent — these are chart-level only.
 *
 * All settling animations share a 250 ms default so the X re-fit, Y range
 * update, and last-bar live-track all settle on the same frame on a
 * streaming tick. Pulse cycle period (600 ms) and `inputResponseMs` (0,
 * opt-in) keep their own values.
 */
export interface AnimationsConfig {
  /**
   * Data-series animations. `false` disables every point animation (entrance,
   * live-smoothing, pulse) across every series — overrides any per-series
   * option set on the same fields. An object overrides individual categories;
   * omitted fields fall back to the built-in defaults.
   *
   * Per-series options (`<LineSeries options={{ entryMs, smoothMs, pulseMs }}>`)
   * win over chart-level numeric values. The chart-level field becomes the
   * default for series that don't set their own.
   */
  points?:
    | false
    | {
        /**
         * Per-point entrance duration (ms). Default: 250.
         * Per-series equivalent: `<XSeries options={{ entryMs }}>` (note the
         * `y` — chart-level uses `enterMs`, per-series uses `entryMs` for
         * historical reasons; both refer to the same animation). `false` /
         * `0` disables.
         */
        enterMs?: AnimationTime;
        /**
         * Live-value chase duration (ms) for the displayed last point on
         * `updateData` ticks. Animator-driven cubic ease — after this many ms
         * with no new updates, the displayed value reaches exactly the
         * actual last value. Default: 250. Per-series equivalent:
         * `options={{ smoothMs }}`. `false` / `0` snaps.
         */
        smoothMs?: AnimationTime;
        /**
         * Pulse cycle period (ms) for the line last-point halo — periodic,
         * not a one-shot transition. Default: 600. Per-series equivalent:
         * `<LineSeries options={{ pulseMs }}>`. `false` / `0` disables.
         */
        pulseMs?: AnimationTime;
      };
  /**
   * Viewport interaction animations. `false` disables both rebound and Y-axis
   * smoothing — viewport changes snap instantly.
   */
  viewport?:
    | false
    | {
        /** Rebound (snap-back) duration after pan/zoom overshoot (ms). Default: 350. */
        reboundMs?: AnimationTime;
        /**
         * Y-axis range transition duration in wall-clock milliseconds. The Y
         * min and max each ride their own {@link Animator} that retargets on
         * data updates and eases toward the new bound over this many ms.
         * Default `250` (shares the lockstep-arrival budget with viewport and
         * live-track). Inward contraction always eases. Outward expansion
         * eases when the per-point entrance is enabled (the entering candle's
         * fade masks the brief overshoot); when entrance is hard-disabled
         * (`points.enterMs === 0`), Y bounds snap outward to keep new
         * highs/lows from clipping at the canvas edge. `false` / `0` snaps
         * the Y range instantly on every update.
         */
        yAxisMs?: AnimationTime;
        /**
         * Per-event ease applied to user pan/zoom commits. Logical state
         * advances synchronously (gesture math, edge detection, autoscroll
         * all read the committed target); the visual range eases over this
         * duration so back-to-back wheel/trackpad events interpolate
         * smoothly through the same animator.
         *
         * Default `0` (instant-apply, matches the long-standing pre-Phase-5
         * behaviour). Opt in via `inputResponseMs: 60` for an eased pan/zoom
         * feel — the default is conservative because the animated visual
         * range diverges from the committed target until the ease completes,
         * and existing consumers reading `chart.getVisibleRange()`
         * synchronously after a wheel/pan expect the new value.
         */
        inputResponseMs?: AnimationTime;
      };
}

/**
 * Resolved, flat view of {@link AnimationsConfig} — every field concrete.
 * `0` in any numeric field means "disabled" (matches {@link AnimationTime}).
 *
 * @internal
 */
export interface ResolvedAnimationsConfig {
  points: {
    enterMs: number;
    smoothMs: number;
    pulseMs: number;
  };
  viewport: {
    reboundMs: number;
    yAxisMs: number;
    inputResponseMs: number;
  };
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
 * Normalize an {@link AnimationTime} against a default. `false` or `0`
 * collapses to `0` (the "disabled" marker in the resolved config); any
 * other number flows through untouched; `undefined` falls back to the
 * built-in default.
 */
function resolveTime(value: AnimationTime | undefined, fallback: number): number {
  if (value === false || value === 0) return 0;
  if (value === undefined) return fallback;

  return value;
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
    return {
      points: { enterMs: 0, smoothMs: 0, pulseMs: 0 },
      viewport: { reboundMs: 0, yAxisMs: 0, inputResponseMs: 0 },
    };
  }

  // `true` (or undefined) means "all defaults on" — fall through to the
  // default-resolution path with no overrides.
  const cfg = input === true || input === undefined ? undefined : input;
  const rawPoints = cfg?.points;
  const rawViewport = cfg?.viewport;

  const points =
    rawPoints === false
      ? { enterMs: 0, smoothMs: 0, pulseMs: 0 }
      : {
          enterMs: resolveTime(rawPoints?.enterMs, DEFAULT_ENTER_MS),
          smoothMs: resolveTime(rawPoints?.smoothMs, DEFAULT_SMOOTH_MS),
          pulseMs: resolveTime(rawPoints?.pulseMs, DEFAULT_PULSE_MS),
        };

  const viewport =
    rawViewport === false
      ? { reboundMs: 0, yAxisMs: 0, inputResponseMs: 0 }
      : {
          reboundMs: resolveTime(rawViewport?.reboundMs, DEFAULT_REBOUND_MS),
          yAxisMs: resolveTime(rawViewport?.yAxisMs, DEFAULT_Y_AXIS_MS),
          inputResponseMs: resolveTime(rawViewport?.inputResponseMs, DEFAULT_INPUT_RESPONSE_MS),
        };

  return { points, viewport };
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
    this.#onEdgeReached = options?.onEdgeReached;
    this.#initialVisibleRange = options?.viewport?.initialRange;

    const resolvedPerf = resolvePerfOptions(options?.perf);
    this.#perfMonitor = resolvedPerf.monitor;
    this.#ownsPerfMonitor = resolvedPerf.ownsMonitor;

    this.#canvasManager = new CanvasManager(container, this.#perfMonitor ?? undefined);
    this.#viewport = new Viewport({
      padding: options?.padding,
      reboundMs: this.#animationsConfig.viewport.reboundMs,
      maxVisibleBars: options?.viewport?.maxVisibleBars,
    });
    registerChartViewport(this, this.#viewport);
    this.timeScale = new TimeScale();
    this.yScale = new YScale();

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
      ? new InteractionHandler(
          this.#canvasManager.canvas,
          this.#viewport,
          this.timeScale,
          this.yScale,
          this.#animationsConfig.viewport.inputResponseMs,
        )
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

    // While the user is actively panning/zooming, the Y-range chase uses a
    // shorter ease (see INTERACT_Y_AXIS_MS) so it converges within ~1 frame
    // per wheel tick instead of trailing the gesture through the full 250 ms
    // ease. The flag is read-and-cleared by updateYRange on the next frame —
    // no time window needed: after the last wheel tick, current ≈ target, so
    // switching back to the long ease produces no visible motion.
    this.#viewport.on('interact', () => {
      this.#interactPending = true;
    });

    this.#canvasManager.on('resize', () => {
      // Render synchronously — canvas.width/height assignment clears the canvas,
      // so we must redraw immediately in the same frame to avoid a black flash.
      // Snap Y range: canvas dimensions changed structurally.
      this.updateScales(true);
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
  #seriesAnimationDefaults(kind: 'candle' | 'bar' | 'line'): Record<string, unknown> {
    const { enterMs, smoothMs, pulseMs } = this.#animationsConfig.points;
    // `enterAnimation` style stays per-series — chart-level config only
    // influences durations. `pulseMs` is line-only; bars/candles ignore it.
    return kind === 'line' ? { enterMs, smoothMs, pulseMs } : { enterMs, smoothMs };
  }

  /**
   * Chart-level animation overrides — these *win over* any per-series value
   * because `animations.points: false` (or any category set to `false`) is
   * documented as a hard disable. Merged AFTER user options in the
   * `addXSeries` wrappers.
   */
  #seriesAnimationForceOff(): Record<string, unknown> {
    const { enterMs, smoothMs, pulseMs } = this.#animationsConfig.points;
    const out: Record<string, unknown> = {};
    if (enterMs === 0) out.enterMs = 0;
    if (smoothMs === 0) out.smoothMs = 0;
    if (pulseMs === 0) out.pulseMs = 0;

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
      ...this.#seriesAnimationForceOff(),
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
      ...this.#seriesAnimationForceOff(),
    });

    return this.#registerSeries(renderer, renderer.store, rest);
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
      ...this.#seriesAnimationForceOff(),
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
      this.updateViewportPadding();
      this.#mainScheduler.markDirty();
      this.emit('seriesChange');
      this.#bumpOverlayVersion();
    }
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
    entry.renderer.setData(data, layerIndex);
  }

  /** Append a new data point to the end of a series (real-time tick). */
  appendData(id: string, point: OHLCInput | TimePointInput, layerIndex?: number): void {
    const entry = this.#series.find((s) => s.id === id);
    entry?.renderer.appendPoint?.(point, layerIndex);
  }

  /** Update the last data point of a series in place (e.g. live candle update). */
  updateData(id: string, point: OHLCInput | TimePointInput, layerIndex?: number): void {
    const entry = this.#series.find((s) => s.id === id);
    entry?.renderer.updateLastPoint?.(point, layerIndex);
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
    // render via this path. If the chart-level `animations.points` category
    // is disabled, the per-series force-off must be re-applied here —
    // otherwise a simple parent re-render silently re-enables animations
    // the chart asked to hold off.
    entry.renderer.updateOptions({ ...options, ...this.#seriesAnimationForceOff() });
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
          this.updateYRange(true);
          this.#mainScheduler.markDirty();
        }
        if (this.#batchOverlayDirty) {
          this.#batchOverlayDirty = false;
          this.emit('overlayChange');
        }
      }
    }
  }

  /** Show or hide a series. Hidden series are not rendered and excluded from Y-range. */
  setSeriesVisible(seriesId: string, visible: boolean): void {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry || entry.visible === visible) return;

    entry.visible = visible;
    this.#bumpOverlayVersion();
    if (this.#batchDepth > 0) {
      this.#batchVisualDirty = true;

      return;
    }

    this.updateYRange(true);
    this.#mainScheduler.markDirty();
  }

  isSeriesVisible(seriesId: string): boolean {
    return this.#series.find((s) => s.id === seriesId)?.visible ?? true;
  }

  /** Show or hide a specific layer within a multi-layer series. */
  setLayerVisible(seriesId: string, layerIndex: number, visible: boolean): void {
    const entry = this.#series.find((s) => s.id === seriesId);
    if (!entry) return;

    // Single-layer renderers (candlestick, pie, single-layer line/bar) can't toggle;
    // use setSeriesVisible() instead. Skip to avoid a pointless updateYRange/redraw.
    if (entry.renderer.getLayerCount() <= 1) return;
    if (entry.renderer.isLayerVisible(layerIndex) === visible) return;

    entry.renderer.setLayerVisible(layerIndex, visible);
    this.#bumpOverlayVersion();
    if (this.#batchDepth > 0) {
      this.#batchVisualDirty = true;

      return;
    }

    this.updateYRange(true);
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
    this.#viewport.fitToData(first, last, { chartWidth, animated: true });
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

      return;
    }

    if ('bars' in spec) {
      if (!Number.isInteger(spec.bars) || spec.bars < 2) return;

      const from = normalizeTime(spec.from);
      const to = from + spec.bars * this.#dataInterval;
      // Hold the viewport until the data fills the gap on the right —
      // standard streaming warm-up window.
      this.#viewport.setRangeHold({ from, to });

      return;
    }

    this.#viewport.setRange({ from: normalizeTime(spec.from), to: normalizeTime(spec.to) });
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
    this.updateYRange(true);
    if (this.yAxisWidth !== prevYW || this.xAxisHeight !== prevXH) {
      this.updateScales(true);
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
  /**
   * Replace the chart-level animation configuration at runtime. Updates the
   * resolved durations and propagates them to every dependent subsystem:
   *
   * - viewport: reboundMs (next rebound), inputResponseMs (next pan/zoom).
   * - per-frame: yAxisMs (next render).
   * - existing series: only the **hard-disable** signal (0 / false) is pushed
   *   into renderers — that's the documented contract on
   *   {@link AnimationsConfig.points}, "chart-level `false` wins over per-
   *   series". Numeric chart-level changes update the default for *new*
   *   series but leave existing per-series overrides intact, which avoids
   *   silently clobbering custom values on every prop update from a React
   *   wrapper.
   *
   * In-flight animations are NOT cancelled — the new durations apply to the
   * next animation that fires. To force-snap the current animation, call
   * the relevant API explicitly (e.g. `setRange`) afterwards.
   */
  setAnimations(animations: ChartOptions['animations']): void {
    const next = resolveAnimationsConfig(animations);
    this.#animationsConfig = next;
    this.#viewport.setReboundMs(next.viewport.reboundMs);
    this.#interactions?.setInputResponseMs(next.viewport.inputResponseMs);

    // Hard-disable signal only. Numeric updates flow through to new series
    // via `#seriesAnimationDefaults` at addSeries time; existing series keep
    // whatever they were configured with.
    const force: Record<string, 0> = {};
    if (next.points.enterMs === 0) force.entryMs = 0;
    if (next.points.smoothMs === 0) force.smoothMs = 0;
    if (next.points.pulseMs === 0) force.pulseMs = 0;
    if (Object.keys(force).length > 0) {
      for (const entry of this.#series) {
        entry.renderer.updateOptions?.(force);
      }
    }

    // Y-range smoothing reads `yAxisMs` from `#animationsConfig` on each
    // frame, so the next render picks up the new duration without a poke.
    this.#mainScheduler.markDirty();
  }

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
    if (verticalChanged) {
      // Refit yRange against the new padding — otherwise valueToY keeps
      // mapping with the old top/bottom gutters until the next full render.
      this.updateYRange(true);
    }
    this.syncScales();
    this.#mainScheduler.markDirty();
    // Vertical changes need their own emit: fitToData's viewport 'change'
    // fires *before* updateYRange runs, so subscribers that land on it see
    // a stale yScale. Re-emit after syncScales pushes the new yRange so
    // React components (YLabel, YAxis) pick up the final scale. Covers both
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

    if (first !== undefined && last !== undefined) {
      // Logical, not visual — "has the viewport ever been committed?" is a
      // logical state question. Mid-tween visual could still read {0,0} as
      // it lerps off the initial state, but logical flips on first commit.
      const { from, to } = this.#viewport.logicalRange;
      const uninitialized = from === 0 && to === 0;
      const chartWidth = this.#canvasManager.size.media.width - this.yAxisWidth;

      if (uninitialized) {
        // First data load — fit immediately. Viewport snaps to its preset
        // capacity (`maxVisibleBars * dataInterval`); when the data is
        // smaller than that, it sits flush with the data span (no empty
        // right-side gap). Streaming charts that want a warm-up window —
        // viewport stretched to `maxVisibleBars` with new ticks filling
        // the right gap before tail-scrolling — should call
        // `chart.setVisibleRange({ from, bars })` (or pass
        // `viewport.initialRange: { from, bars }`); that's the explicit
        // signal that arms `viewport.#holdUntilFilled`.
        this.#viewport.fitToData(first, last, { chartWidth });
        // One-shot `initialVisibleRange` (e.g. "last 35 bars") — applied
        // here so the Y range computed by the following updateYRange snaps
        // to the *initial-window* data rather than the full dataset. Folds
        // post-mount `setVisibleRange` calls into the first paint.
        if (this.#initialVisibleRange !== undefined) {
          this.setVisibleRange(this.#initialVisibleRange);
          this.#initialVisibleRange = undefined;
        }
      } else if (isBatchLoad && this.#viewport.autoScroll) {
        this.#viewport.fitToData(first, last, { chartWidth, animated: true });
      } else if (!isBatchLoad && this.#viewport.autoScroll) {
        // Single streaming tick. `scrollToEnd` keeps the visible range size
        // constant (no scale animation); its internal warm-up guard no-ops
        // while the new point still fits in the current viewport, and only
        // pans once the data reaches the right edge. Pan disables autoScroll
        // explicitly; zoom leaves it alone.
        this.#viewport.scrollToEnd(last, chartWidth);
      }
    }

    // Snap Y range on batch loads, on first init (handled inside updateYRange),
    // or when the caller signalled a bulk replace via `#dataReplaceSnapPending`.
    // Smooth on streaming ticks otherwise — `streaming: true` on the regular
    // single-tick path makes the Y chase share `scrollToEnd`'s adaptive-
    // duration + linear-easing treatment so axis labels don't wobble between
    // ticks.
    const replaceSnap = this.#dataReplaceSnapPending;
    this.#dataReplaceSnapPending = false;
    const ySnap = isBatchLoad || replaceSnap;

    // Capture "was this the first onDataChanged call that actually had
    // data" *before* updateYRange flips `#yInited`. Initial mounts where
    // data flows in asynchronously (e.g. `useOHLCStream` first emits `[]`
    // then later `setData(history)`) hit this path on the second call;
    // the first (empty) call returns early inside updateYRange without
    // setting `#yInited`.
    const isFirstDataPaint = !this.#yInited && first !== undefined;

    // Bulk replaces (full dataset swap) and batch loads land on entirely
    // new tick values. If the tick trackers stay armed with the previous
    // dataset they'd fade the old labels out and the new ones in over
    // the next 250 ms, briefly showing "ghost" grid lines from the prior
    // range. Reset so the dataset swap snaps the same way `updateYRange`
    // is about to snap the Y bound.
    if (replaceSnap || isBatchLoad) {
      this.yScale.tickTracker.reset();
      this.timeScale.tickTracker.reset();
    }

    this.updateYRange(ySnap, { streaming: !ySnap });
    // Re-sync scales so React components read correct yScale values.
    // The earlier viewport 'change' (from fitToData) fired before updateYRange,
    // so yScale was stale at that point.
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

  /** Animates the Y-axis lower bound. Streaming `appendData` ticks retarget
   * this animator so the bound eases toward the latest data extreme over
   * `viewport.yAxisMs`. Inward contraction (chart settling tighter as old
   * extremes leave the window) always eases. Outward expansion (new low)
   * eases when the per-point entrance is enabled — the entering candle's
   * fade masks the brief overshoot; when entrance is hard-disabled
   * (`points.enterMs === 0`), the new extreme would render at full alpha
   * and clip at the canvas edge for the duration of the ease, so
   * {@link updateYRange} snaps the bound outward in that case.
   *
   * Bulk replaces (`setSeriesData`) flow through the snap branch in
   * {@link updateYRange} via `#dataReplaceSnapPending`, so `yScale.getRange()`
   * reflects the new domain on the same frame — the long-standing public-API
   * contract pinned by `chart-scales-sync.test`. */
  readonly #yMinAnimator = new Animator<number>({
    initial: 0,
    duration: DEFAULT_Y_AXIS_MS,
    easing: easeOutCubic,
    lerp: (a, b, t) => a + (b - a) * t,
  });
  /** Animates the Y-axis upper bound — mirror of {@link #yMinAnimator}. */
  readonly #yMaxAnimator = new Animator<number>({
    initial: 0,
    duration: DEFAULT_Y_AXIS_MS,
    easing: easeOutCubic,
    lerp: (a, b, t) => a + (b - a) * t,
  });
  /** Whether the Y range has been initialized (first snap vs smooth lerp). */
  #yInited = false;
  /**
   * One-shot `setVisibleRange` argument applied on the first data arrival.
   * Captured at chart construction from {@link ChartOptions.viewport.initialRange};
   * cleared the moment it's consumed so subsequent data swaps don't snap
   * back to the initial window.
   */
  #initialVisibleRange: VisibleRangeSpec | undefined;

  /** Wall-clock timestamp of the previous streaming-mode `updateYRange` call.
   * Used to size the next Y chase to the measured tick inter-arrival, so the
   * Y animator slides at constant velocity through high-frequency streams
   * instead of restarting a 250 ms ease-out on every tick (visible wobble in
   * the axis labels). Mirrors `Viewport#lastScrollWall`; not shared because
   * `updateScales(snap)` and other off-stream callers shouldn't reset it. */
  #lastYStreamingWall = 0;

  /** @internal Test-only accessor for streaming cadence anchor. */
  get _lastYStreamingWall(): number {
    return this.#lastYStreamingWall;
  }

  /**
   * Set by the viewport `interact` listener on every user pan/zoom event;
   * read-and-cleared by `updateYRange` on the next frame to apply the short
   * gesture-time Y chase ({@link INTERACT_Y_AXIS_MS}).
   */
  #interactPending = false;

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

  private updateYRange(snap = false, opts: { now?: number; streaming?: boolean } = {}): void {
    const { now, streaming } = opts;
    // Y target is sampled against the X *destination* (logicalRange) so Y
    // stays stable while X animates — otherwise Y chases a moving definition
    // of "in view" and never converges with X.
    const targetVisible = this.#viewport.logicalRange;

    // Only collect individual values when bounds use a function/percentage (rare)
    const needsAllValues =
      (this.#yBounds.min !== undefined && this.#yBounds.min !== 'auto' && typeof this.#yBounds.min !== 'number') ||
      (this.#yBounds.max !== undefined && this.#yBounds.max !== 'auto' && typeof this.#yBounds.max !== 'number');
    const allValues: number[] | null = needsAllValues ? [] : null;

    const raw = this.computeTargetYRange(targetVisible, allValues);
    if (raw === null) {
      // No visible data — force a snap on next data appearance so stale range isn't reused
      this.#yInited = false;
      return;
    }

    // Apply Y bounds
    const targetMin = this.resolveBound(this.#yBounds.min, raw.min, raw.max, allValues ?? [], 'min');
    const targetMax = this.resolveBound(this.#yBounds.max, raw.max, raw.min, allValues ?? [], 'max');

    const baseYAxisMs = this.#animationsConfig.viewport.yAxisMs;
    // During an active user pan/zoom, shorten the Y chase so it converges
    // within ~1 frame per wheel tick — the full 250 ms ease feels rubbery
    // because every retarget restarts from a position still trailing the
    // previous one. We don't outright snap (which would jitter labels) — a
    // short ease keeps the motion smooth without lagging the gesture. Skip
    // the override when the user has already disabled animation
    // (yAxisMs ≤ 0) or asked for an even shorter chase.
    const interacting = this.#interactPending;
    this.#interactPending = false;
    const yAxisMs = interacting && baseYAxisMs > INTERACT_Y_AXIS_MS ? INTERACT_Y_AXIS_MS : baseYAxisMs;
    const useSnap = !this.#yInited || snap || yAxisMs <= 0;

    // Streaming ticks: size the chase to the measured inter-arrival interval and
    // switch easing to linear so mid-flight retargets keep constant velocity.
    // The fixed 250 ms ease-out otherwise wobbles when ticks arrive faster than
    // the ease completes — the axis decelerates near each retarget point and
    // visibly stutters on every tick. Skip during user gestures (the
    // `interacting` short ease handles those).
    const useStreamingChase = streaming === true && !useSnap && !interacting;
    let streamingDuration = yAxisMs;
    if (useStreamingChase) {
      const wallNow = now ?? performance.now();
      const measured = this.#lastYStreamingWall > 0 ? wallNow - this.#lastYStreamingWall : 0;
      this.#lastYStreamingWall = wallNow;
      // Idle reset: a long pause invalidates the cadence; fall back to the
      // baseline `yAxisMs` so the post-pause first tick doesn't ride a
      // multi-second slide derived from the stale interval. We then cap
      // adaptive duration at `yAxisMs` (not `max(yAxisMs, measured)`) so a
      // slow feed (500 ms+ inter-arrival) doesn't leave the animator
      // mid-tween when the next tick arrives — that produces a continuous
      // "creep" of the Y bound that reads worse than a clean 250 ms ease
      // followed by an idle gap. Bound the floor at 16 ms so fast feeds
      // still get a smoothly-rendered chase rather than a snap.
      if (measured > 0 && measured <= STREAMING_Y_IDLE_RESET_MS) {
        streamingDuration = Math.min(yAxisMs, Math.max(16, measured));
      }
    } else if (streaming === false) {
      // Explicit non-streaming path (batch load, initial mount snap) resets
      // the cadence anchor so a later stream starts fresh. Tri-state: only
      // the explicit `streaming: false` callers wipe the wall; per-frame
      // `renderMain → updateScales → updateYRange` polls (where `streaming`
      // is left undefined) leave it alone so the cadence measurement
      // actually survives between streaming ticks.
      this.#lastYStreamingWall = 0;
    }
    const yEasing = useStreamingChase ? easeLinear : undefined;
    const yDuration = useStreamingChase ? streamingDuration : yAxisMs;

    if (useSnap) {
      this.#yMinAnimator.snap(targetMin);
      this.#yMaxAnimator.snap(targetMax);
      this.#yInited = true;
    } else {
      // Streaming path. Inward contraction is always eased — the data has
      // already been drawn at its position, the bound just shrinks toward
      // it, no clipping risk.
      //
      // Outward expansion is conditional. Easing the bound toward a new
      // high/low leaves the new extreme rendered above (or below) the
      // current bound for the duration of the ease. That's invisible only
      // while the entering candle/bar fades in over an `entryMs` window
      // longer than `yAxisMs`. If the user disabled the per-point entrance
      // (`animations.points: false`, or per-series `entryMs: 0` /
      // `entryAnimation: 'none'`), the new extreme renders at full alpha
      // from frame 0 — easing the bound would clip the wick at the canvas
      // edge for ~yAxisMs. We snap outward in that case.
      //
      // Bulk replaces flow through the `useSnap` branch above via the
      // `#dataReplaceSnapPending` flag, so `yScale.getRange()` still
      // reflects new data synchronously after `setSeriesData`.
      // Use chart-level entrance gate: hard-disabled (0 / false) at the
      // chart level forces entrance off for every series, so expansion
      // would clip — snap outward. Numeric chart-level lets per-series
      // entrance defaults flow through; the common "default everything on"
      // case eases outward smoothly.
      const easeOutward = this.#animationsConfig.points.enterMs > 0;

      if (targetMin < this.#yMinAnimator.current && !easeOutward) {
        this.#yMinAnimator.snap(targetMin);
      } else {
        this.#yMinAnimator.setTarget(targetMin, { duration: yDuration, now, easing: yEasing });
      }
      if (targetMax > this.#yMaxAnimator.current && !easeOutward) {
        this.#yMaxAnimator.snap(targetMax);
      } else {
        this.#yMaxAnimator.setTarget(targetMax, { duration: yDuration, now, easing: yEasing });
      }
    }

    // Advance the animators to the current frame timestamp. `setTarget` already
    // moved `current` to `now` internally, so the tick on the same frame is a
    // no-op for newly-retargeted animators; on subsequent frames it advances
    // toward the target. `tick` is the only place the animator's `current`
    // changes, so we must call it before reading values out below.
    const tickNow = now ?? performance.now();
    const minAnimating = this.#yMinAnimator.tick(tickNow);
    const maxAnimating = this.#yMaxAnimator.tick(tickNow);
    if (minAnimating || maxAnimating) {
      this.#mainScheduler.markDirty();
    }

    // Only add padding for sides without explicit bounds
    const hasMinBound = this.#yBounds.min !== undefined && this.#yBounds.min !== 'auto';
    const hasMaxBound = this.#yBounds.max !== undefined && this.#yBounds.max !== 'auto';
    const chartHeight = this.#canvasManager.size.media.height - this.xAxisHeight;
    this.#viewport.setYRange(
      this.#yMinAnimator.current,
      this.#yMaxAnimator.current,
      chartHeight,
      hasMinBound,
      hasMaxBound,
    );
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

  private updateScales(snap = false, now?: number): void {
    const size = this.#canvasManager.size;
    if (size.media.width === 0 || size.media.height === 0) return;

    const chartWidth = size.media.width - this.yAxisWidth; // Y axis
    const chartHeight = size.media.height - this.xAxisHeight; // time axis

    this.timeScale.update(this.#viewport.visibleRange, chartWidth, size.horizontalPixelRatio, this.#dataInterval);
    this.yScale.update(this.#viewport.yRange, chartHeight, size.verticalPixelRatio);
    this.updateYRange(snap, { now });
    this.yScale.update(this.#viewport.yRange, chartHeight, size.verticalPixelRatio);
  }

  /** Expensive: background, grid, all series. Only on data/viewport/resize change. */
  private renderMain(timestamp?: number): void {
    const size = this.#canvasManager.size;
    if (size.media.width === 0 || size.media.height === 0) return;

    // Advance viewport animation in the same frame as render. Prefer the RAF-provided
    // timestamp so deterministic test harnesses (installRaf) drive
    // smoothing dt from synthetic frame time instead of the real wall clock.
    const now = typeof timestamp === 'number' ? timestamp : performance.now();
    const stillAnimating = this.#viewport.tick(now);
    if (stillAnimating) {
      this.#mainScheduler.markDirty();
    }

    this.updateScales(false, now);

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

      // Feed the shared tick trackers with the current tick sets so grid lines
      // and DOM axis labels fade in lockstep. We sync ticks here (rather than
      // inside renderGrid) so the trackers still advance even when the grid
      // is disabled — the DOM axes still need fade state.
      const yTickValues = this.yScale.niceTickValues();
      const timeTickValues = this.timeScale.niceTickValues(this.#dataInterval).ticks;
      this.yScale.tickTracker.setCurrentTicks(yTickValues);
      this.timeScale.tickTracker.setCurrentTicks(timeTickValues);
      const yTick = this.yScale.tickTracker.tick(now);
      const timeTick = this.timeScale.tickTracker.tick(now);
      yTickAnimating = yTick.animating;
      timeTickAnimating = timeTick.animating;
      if (yTick.animating || timeTick.animating) {
        this.#mainScheduler.markDirty();
      }
      // Emit on any opacity change — large `dt` can one-shot a fade-in to
      // settled in a single tick, and DOM axis components still need that
      // refresh signal even though `animating` is now false.
      if (yTick.moved || timeTick.moved || yTick.animating || timeTick.animating) {
        this.emit('tickFrame');
      }

      if (this.#grid) {
        renderGrid({
          scope,
          timeScale: this.timeScale,
          yScale: this.yScale,
          theme: this.#theme,
          yTicks: this.yScale.tickTracker.snapshot(),
          timeTicks: this.timeScale.tickTracker.snapshot(),
        });
      }

      const vpad = this.#viewport.getPadding();
      const padding = { top: vpad.top, bottom: vpad.bottom };
      const perfMon = this.#perfMonitor;
      for (const entry of this.#series) {
        if (!entry.visible) continue;

        const renderArgs = {
          scope,
          timeScale: this.timeScale,
          yScale: this.yScale,
          theme: this.#theme,
          dataInterval: this.#dataInterval,
          padding,
        };

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
    if (!stillAnimating && !seriesNeedsAnim && !trackersStillFading) {
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
