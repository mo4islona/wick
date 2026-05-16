import type { AnimationState } from '../animation/viewport-engine';
import type { BitmapCoordinateSpace } from '../canvas-manager';
import type { TimeScale } from '../scales/time-scale';
import type { YScale } from '../scales/y-scale';
import type { ChartTheme } from '../theme/types';
import type { OHLCData, TimePoint } from '../types';

/**
 * Vertical padding reserved at the top/bottom of the chart area.
 *
 * **Unitless on its own** — the unit is fixed by the call site:
 *  - In {@link SeriesRenderContext} / {@link OverlayRenderContext}: **CSS pixels**
 *    (multiply by `scope.verticalPixelRatio` to convert to bitmap pixels).
 *  - In {@link SeriesRenderer.hitTest}: **bitmap pixels** (the chart pre-scales
 *    so the values align with the `bx`/`by` bitmap-space pointer coords).
 *
 * Time-based renderers absorb this implicitly via the YScale's value range,
 * but spatial renderers (Pie) need the raw pixel reservation to keep their
 * layout out of the Title / InfoBar overlay regions.
 */
export interface RenderPadding {
  top: number;
  bottom: number;
}

export interface SeriesRenderContext {
  scope: BitmapCoordinateSpace;
  timeScale: TimeScale;
  yScale: YScale;
  theme: ChartTheme;
  dataInterval: number;
  /** Vertical padding in **CSS pixels** — see {@link RenderPadding}. */
  padding: RenderPadding;
  /**
   * Engine-owned animation state — pulse phase, live values, entry
   * progress. Optional during the Phase 2 migration: renderers that
   * haven't been ported yet keep reading their own state and ignore this.
   */
  state?: AnimationState;
  /**
   * The id under which the chart registered this series — used by
   * stateful per-series lookups (`state.pulsePhase.get(seriesId)`,
   * `state.seriesAlpha.get(seriesId)`).
   */
  seriesId?: string;
}

/** Overlay render state passed to {@link SeriesRenderer.drawOverlay}. */
export interface OverlayRenderContext {
  scope: BitmapCoordinateSpace;
  timeScale: TimeScale;
  yScale: YScale;
  theme: ChartTheme;
  dataInterval: number;
  /** Vertical padding in **CSS pixels** — see {@link RenderPadding}. */
  padding: RenderPadding;
  /** Current crosshair position, or null when none. */
  crosshair: { mediaX: number; mediaY: number; time: number; y: number } | null;
  /**
   * Engine-owned animation state. Pulse renderers read `state.pulsePhase`
   * here so the halo cycles off the same clock the rest of the chart uses.
   */
  state?: AnimationState;
  /** The chart-side id for this series. See {@link SeriesRenderContext.seriesId}. */
  seriesId?: string;
}

/** Shape returned by {@link SeriesRenderer.getHoverInfo} / per-slice entries of {@link SeriesRenderer.getSliceInfo}. */
export interface HoverInfo {
  label: string;
  value: number;
  percent: number;
  color: string;
}

export type SliceInfo = HoverInfo;

/**
 * Every series renderer implements this interface. Chart dispatches uniformly —
 * any type-specific behavior is opted into via the optional members below.
 *
 * Single-layer renderers (Candlestick, Pie) default most layer methods to no-ops.
 * Multi-layer renderers (Line, Bar) override them against each internal store.
 */
export interface SeriesRenderer {
  /** Paint the series on the main layer. */
  render(ctx: SeriesRenderContext): void;

  /** Optional: return the effective min/max for auto-range (e.g. stacked totals). */
  getValueRange?(from: number, to: number): { min: number; max: number } | null;

  // --- Data ingest ---------------------------------------------------------

  /**
   * Replace the series' data. For multi-layer renderers (Line, Bar), `layerIndex`
   * selects which internal store to target; defaults to 0.
   */
  setData(data: unknown, layerIndex?: number): void;

  /** Append a single point (real-time tick). Optional — not all renderers support streaming. */
  appendPoint?(point: unknown, layerIndex?: number): void;

  /** Replace the last point in place (live candle update). Optional. */
  updateLastPoint?(point: unknown, layerIndex?: number): void;

  /**
   * Keep only the last `count` points; drop the oldest. No-op when the series
   * is already at or below the cap. Smooth Y-range update — does NOT trigger
   * the snap that {@link setData} forces.
   */
  keepLast?(count: number, layerIndex?: number): void;

  // --- Layer model ---------------------------------------------------------

  /** Number of visual layers the renderer owns. Default: 1. */
  getLayerCount(): number;
  /** Show/hide a layer. No-op for single-layer renderers. */
  setLayerVisible(index: number, visible: boolean): void;
  /** Current visibility of a layer. */
  isLayerVisible(index: number): boolean;
  /** Per-layer colors. Single-layer renderers return `[primary]`. */
  getLayerColors(): string[];

  // --- Theme ---------------------------------------------------------------

  /** Apply a new theme. Each renderer decides what that means for itself. */
  applyTheme(theme: ChartTheme, prevTheme: ChartTheme): void;

  /**
   * Shallow-merge new visual options into the renderer's configuration.
   * Each renderer narrows the parameter in its concrete signature.
   */
  // biome-ignore lint/suspicious/noExplicitAny: each renderer narrows this in its concrete signature
  updateOptions(options: any): void;

  // --- Spatial hover (pie / future scatter / heatmap) ----------------------

  /**
   * Hit-test a bitmap-space coordinate; return the hovered index or -1. Optional.
   * `padding` is in **bitmap pixels** (already scaled by `verticalPixelRatio`)
   * so its values align with the `bx`/`by`/`bitmapWidth`/`bitmapHeight` arguments
   * — the hit area then matches the painted geometry exactly.
   */
  hitTest?(bx: number, by: number, bitmapWidth: number, bitmapHeight: number, padding?: RenderPadding): number;
  /** Set the currently hovered index. Returns true if the value changed. Optional. */
  setHoverIndex?(index: number): boolean;
  /** Get info about the currently hovered element, or null. Optional. */
  getHoverInfo?(theme: ChartTheme): HoverInfo | null;

  // --- Generic data queries (tooltips/legends) -----------------------------

  /** Pie-style breakdown of all elements. Optional. */
  getSliceInfo?(theme: ChartTheme): SliceInfo[] | null;
  /** Last data value for the series, or null if empty. Optional. */
  getLastValue?(): number | null;
  /** Nearest data point to a given time, or null. Optional. */
  getDataAtTime?(time: number, interval: number): TimePoint | OHLCData | null;

  /**
   * For multi-layer renderers: nearest data point per visible layer at `time`.
   * Each entry carries the owning `layerIndex` (so filtered hidden layers
   * don't shift the caller's identity mapping) and the **resolved sample
   * time** of the snapped point (not the query time). Used by Chart for
   * tooltips/legends.
   * Returns null for single-layer renderers or when no visible layer has data.
   */
  getLayerSnapshots?(
    time: number,
    interval: number,
  ): { layerIndex: number; time: number; value: number; color: string }[] | null;

  /**
   * Stacked last value — cumulative top of the rendered stack for multi-layer
   * renderers. Falls back to `getLastValue()` behavior for single-layer
   * renderers (or when no layer is visible). Chart uses this to anchor a
   * `<YLabel />` at the same point the canvas paints the stack head.
   */
  getStackedLastValue?(): { value: number; isLive: boolean } | null;

  /**
   * Per-layer last snapshots, each with its own `time`. Useful for ragged
   * multi-layer series where layers advance independently — last-mode
   * overlays need to show each layer at its true last time, not at the
   * primary layer's time.
   * Returns null for single-layer renderers or when no visible layer has data.
   */
  getLayerLastSnapshots?(): { layerIndex: number; time: number; value: number; color: string }[] | null;

  /** Total data points across all owned stores. Used by Chart for batch-load detection. */
  getTotalLength?(): number;

  // --- Animation & overlays ------------------------------------------------

  /**
   * Abort in-flight entrance animations (per-point/per-bar intros). Called
   * when the user pans or zooms — continuing to tween bar fills while the
   * chart is being dragged reads as flicker.
   *
   * Live-tracking smoothing (the halo/last-value lerp) is NOT cancelled here;
   * that motion is subtle and shouldn't jump when the viewport moves.
   */
  cancelEntranceAnimations?(): void;

  /**
   * Start a series-level alpha cross-fade. Chart calls this on
   * `setSeriesVisible` so the show/hide animation lives next to the geometry
   * that owns it. `target` is the destination opacity in `[0, 1]` and
   * `durationMs <= 0` snaps. Optional — renderers that don't need a fade
   * (e.g. pie) leave it unimplemented; the chart falls back to a binary
   * visibility flag.
   */
  setAlpha?(target: number, durationMs: number): void;

  /** Current series-level opacity in `[0, 1]`. Chart applies it as `globalAlpha` during render. */
  getAlpha?(): number;

  /** True while the renderer has an active animation (Chart polls per frame). */
  readonly needsAnimation?: boolean;
  /**
   * Optional overlay hook. Chart invokes this during the overlay pass so each
   * renderer can paint type-specific overlays (crosshair dots, pulse dots).
   */
  drawOverlay?(ctx: OverlayRenderContext): void;
  /** True when the renderer wants the overlay layer to keep ticking (pulse animations, etc.). */
  readonly overlayNeedsAnimation?: boolean;
  /**
   * True if the renderer has overlay content (e.g. pulse dots) whose positions fall within
   * [from, to]. Chart uses this to stop scheduling overlay frames when animated content is
   * fully off-screen. Default when omitted: assume visible (safe, may waste CPU).
   */
  hasOverlayContentInRange?(from: number, to: number): boolean;

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Subscribe to data-changed notifications (any internal store update).
   * Returns an unsubscribe function.
   */
  onDataChanged?(listener: () => void): () => void;
  /** Tear down listeners and any owned resources. */
  dispose(): void;
}
