/**
 * Chart constructor options — the public `ChartOptions` shape plus the
 * three resolver helpers (`resolvePadding`, `resolveMaxVisibleBars`,
 * `resolvePerfOptions`) chart construction runs at instantiation time.
 *
 * Lives in its own module so chart.ts stays focused on the runtime
 * controller; option types / defaults / merge logic doesn't need to be
 * read together with the render loop.
 */

import type { AnimationsConfig } from '../animation/config';
import { PerfMonitor, type PerfMonitorOptions } from '../perf/perf-monitor';
import type { ChartTheme } from '../theme/types';
import type { AxisConfig, HorizontalPadding, VisibleRangeSpec } from '../types';
import { DEFAULT_MAX_VISIBLE_BARS, MIN_VISIBLE_BARS } from './pan-zoom-math';

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

/** Options passed when creating a new ChartInstance. */
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
    right?: HorizontalPadding;
    left?: HorizontalPadding;
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
     * arrives. Same shape as `ChartInstance.setVisibleRange` (a bar count,
     * an explicit `{from, to}` window, or a `{from, bars}` warm-up pair).
     * Calling `setVisibleRange` after mount via `useEffect` runs post-paint
     * and visually re-zooms the chart on the next frame; this option folds
     * the same intent into the first render so the very first paint
     * already shows the requested window.
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
   * Animation control. Grouped as `axis: { y, x, ticks }` (axis-side
   * behaviour), `toggle` (series visibility — alpha + Y refit), and
   * `series.{line,candlestick,bar,pie}` (per-series-type data tweens).
   * See {@link AnimationsConfig} for the full shape and defaults.
   *
   * Shorthands:
   * - `animations: true` (or omitted) uses built-in defaults.
   * - `animations: false` disables every animation category.
   *
   * Per-series options (`entryMs`, `smoothMs`, etc.) override chart-level
   * defaults unless the category is explicitly `false` — then the chart-
   * level gate wins.
   */
  animations?: boolean | AnimationsConfig;
  /**
   * Invoked after the user releases a pan/zoom gesture that pulled the
   * viewport past a data edge by more than 10% of the visible range. Hosts
   * typically respond by prefetching more history and calling
   * `ChartInstance.setEdgeState` to show a spinner or "no more data"
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

// =============================================================================
// Perf
// =============================================================================

export interface ResolvedPerfOptions {
  monitor: PerfMonitor | null;
  /** True when the monitor was constructed here; false for caller-supplied
   *  monitors we must not destroy. */
  ownsMonitor: boolean;
  showHud: boolean;
}

/**
 * Collapse the polymorphic `perf` option into a concrete monitor + HUD
 * decision. Returning `{ monitor: null }` preserves the zero-instrumentation
 * path — no Proxy, no timing, no HUD.
 */
export function resolvePerfOptions(input: ChartOptions['perf']): ResolvedPerfOptions {
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

// =============================================================================
// Padding
// =============================================================================

export interface ResolvedPadding {
  top: number;
  bottom: number;
  right: HorizontalPadding;
  left: HorizontalPadding;
}

const DEFAULT_PADDING: ResolvedPadding = {
  top: 20,
  bottom: 20,
  right: { intervals: 3 },
  left: { intervals: 0 },
};

export function resolvePadding(input: ChartOptions['padding']): ResolvedPadding {
  return {
    top: input?.top ?? DEFAULT_PADDING.top,
    bottom: input?.bottom ?? DEFAULT_PADDING.bottom,
    right: input?.right ?? DEFAULT_PADDING.right,
    left: input?.left ?? DEFAULT_PADDING.left,
  };
}

/**
 * Shallow-compare two horizontal padding values (pixels or `{ intervals }`).
 * Used by `setPadding` to decide whether a viewport refit is needed.
 */
export function isSameHorizontalPadding(a: HorizontalPadding, b: HorizontalPadding): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'object' && typeof b === 'object') return a.intervals === b.intervals;

  return false;
}

// =============================================================================
// Viewport / data
// =============================================================================

/**
 * Resolve the `options.viewport.maxVisibleBars` config into a clamped
 * integer. Mirrors the validation the viewport used to do in its constructor.
 */
export function resolveMaxVisibleBars(input?: number): number {
  if (input === undefined) return DEFAULT_MAX_VISIBLE_BARS;
  if (!Number.isFinite(input)) return DEFAULT_MAX_VISIBLE_BARS;

  return Math.max(MIN_VISIBLE_BARS, Math.floor(input));
}
