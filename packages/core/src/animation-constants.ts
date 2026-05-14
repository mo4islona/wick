/**
 * Shared animation defaults. All time knobs are in milliseconds; the suffix
 * `Ms` is standard across the public API.
 *
 * These are the *built-in* defaults. Resolution order for any per-series
 * animation field is: per-series option → `ChartOptions.animations.points.*`
 * → these constants.
 */

/**
 * Default duration for every coordinated animation knob (entrance, live-value
 * smoothing, Y-range chase, post-gesture rebound, programmatic fit). Sharing
 * one number means a streaming tick's X re-fit, Y range update, and last-
 * point live-track all arrive at their settled state on the same frame —
 * the "lockstep arrival" guarantee from animation-unification.md.
 *
 * The pulse cycle period and the per-event input-response ease deliberately
 * keep their own constants below: pulse is a periodic loop (period, not
 * duration), and input-response defaults to instant-apply for backward
 * compatibility (opt in via `animations.viewport.inputResponseMs`).
 */
const DEFAULT_ANIMATION_MS = 250;

/** Entrance tween duration for a new candle/bar/line point. */
export const DEFAULT_ENTER_MS = DEFAULT_ANIMATION_MS;

/**
 * Live-value chase duration (ms) for the displayed last point on `updateData`
 * ticks. Animator-driven cubic ease — after `DEFAULT_SMOOTH_MS` ms with no
 * new updates, the displayed value reaches exactly the actual last value.
 */
export const DEFAULT_SMOOTH_MS = DEFAULT_ANIMATION_MS;

/** Pulse cycle period for the line's last-point halo. One full sine cycle.
 * Distinct from {@link DEFAULT_ANIMATION_MS} — this is a periodic loop, not
 * a one-shot transition. */
export const DEFAULT_PULSE_MS = 600;

/** Rebound (snap-back) animation duration after pan/zoom overshoot. */
export const DEFAULT_REBOUND_MS = DEFAULT_ANIMATION_MS;

/**
 * Per-event ease applied to user pan/zoom commits. Logical state advances
 * synchronously (gesture math, edge detection, autoscroll all read the
 * committed target); the visual range eases over this duration so a single
 * mouse event isn't a teleport and back-to-back wheel/trackpad events
 * interpolate smoothly through the same animator.
 *
 * Defaults to `0` (instant apply) — opt in via
 * `animations.viewport.inputResponseMs` (suggested value 60). The default is
 * conservative because the animated visual range diverges from the committed
 * target until the ease completes; consumers that read
 * `chart.getVisibleRange()` immediately after a wheel/pan expect the new
 * value, and animating it would surprise existing integrations.
 */
export const DEFAULT_INPUT_RESPONSE_MS = 0;

/**
 * Short-ease applied to the Y animator while a user gesture is active.
 * The default sticky-Y contract duration (2500 ms) is intentionally long
 * for streaming feeds — outliers leaving the window shouldn't reflow the
 * whole chart — but during pan/zoom the user explicitly chose a new
 * view, so contractions should converge in roughly one frame per wheel
 * tick instead of crawling over the full contract budget. The chart
 * passes this as a per-call override to `setTarget`; the engine respects
 * it for that single retarget and restores its built-in baseline for
 * subsequent (post-gesture) data updates.
 */
export const INTERACT_Y_AXIS_MS = 100;

/**
 * After the last user gesture event we keep treating the chart as
 * "interactive" for this many ms — i.e. the short-ease override stays
 * active across the tiny gaps between wheel events on a continuous
 * trackpad zoom. When the grace window finally elapses, the chart
 * zeroes the animator's velocity (`snap(current)`) before the next
 * streaming retarget so the long-baseline ease starts from rest
 * instead of inheriting the gesture-time velocity (which produces a
 * visible overshoot on the first post-gesture tick).
 */
export const INTERACT_GRACE_MS = 200;

/**
 * Default duration (ms) for {@link ChartInstance.setSeriesVisible} fade
 * transitions — the cross-fade applied to the series alpha AND the
 * one-shot Y-range duration override used for the same toggle, so the
 * fade and the axis re-fit settle on the same frame.
 */
export const DEFAULT_VISIBILITY_MS = 250;
