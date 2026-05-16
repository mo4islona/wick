/**
 * Shared animation defaults. All numeric values are milliseconds; the
 * historical `Ms` suffix has been dropped — the unit is now fixed.
 *
 * Resolution order for any per-series animation field is: per-series option
 * → `ChartOptions.animations.series.<type>.*` → these constants.
 */

// =============================================================================
// Internal shared defaults
// =============================================================================

/**
 * Shared baseline for series entry / smoothing. The public per-series-type
 * constants below alias these — same value today, but separately named so
 * any one series type can be tuned independently in future without touching
 * the shared base.
 */
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
 * instead of crawling over the full contract budget. The chart passes this
 * as a per-call override to `retarget`; the engine respects it for that
 * single call and restores its built-in baseline for subsequent (post-
 * gesture) data updates.
 */
export const DEFAULT_Y_GESTURE = 100;

/**
 * After the last user gesture event we keep treating the chart as
 * "interactive" for this many ms — i.e. the short-ease override stays
 * active across the tiny gaps between wheel events on a continuous
 * trackpad zoom. When the grace window finally elapses, the chart zeroes
 * the animator's velocity (`snap(current)`) before the next streaming
 * retarget so the long-baseline ease starts from rest instead of
 * inheriting the gesture-time velocity (which produces a visible
 * overshoot on the first post-gesture tick).
 */
export const INTERACT_GRACE_MS = 200;

/**
 * Default duration for {@link ChartInstance.setSeriesVisible} fade
 * transitions — the cross-fade applied to the series alpha AND the
 * one-shot Y-range duration override used for the same toggle, so the
 * fade and the axis re-fit settle on the same frame.
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
// Legacy (kept; full removal lands in a later phase)
// =============================================================================

/** Rebound (snap-back) animation duration after pan/zoom overshoot. */
export const DEFAULT_REBOUND_MS = 250;
