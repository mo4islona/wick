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
 * Y-axis range chase duration (ms). Drives the two `Animator<number>`s on
 * the Y bounds — wall-clock cubic ease, settles after this many ms with no
 * new data. `0` / `false` snaps the Y range instantly every frame.
 */
export const DEFAULT_Y_AXIS_MS = DEFAULT_ANIMATION_MS;

/**
 * Y-range chase duration applied to the first frame after a user pan/zoom
 * event. Short enough that each wheel tick converges within ~1 frame (no
 * perceived "rubber" trailing the gesture), long enough that the per-event
 * motion still reads as smooth rather than as discrete teleports. Once the
 * gesture stops, current ≈ target, and the next frame switches back to the
 * full {@link DEFAULT_Y_AXIS_MS} ease without any visible motion.
 */
export const INTERACT_Y_AXIS_MS = 100;

/**
 * Cap for the adaptive Y-range chase duration on streaming ticks. A long-
 * interval feed (daily candles, etc.) would otherwise stretch the linear
 * Y ease over hours; we never need the chase to outlast a few seconds of
 * motion to hide the per-tick step. Mirrors `SCROLL_TO_END_MAX_MS` in
 * `viewport.ts`.
 */
export const STREAMING_Y_MAX_MS = 5_000;

/**
 * Inter-arrival above this resets the Y streaming measurement to the
 * baseline `yAxisMs` — a long pause means the previous cadence is stale,
 * so the next tick eases over a normal frame instead of a multi-second
 * slide. Mirrors `STREAM_IDLE_RESET_MS` in `viewport.ts`.
 */
export const STREAMING_Y_IDLE_RESET_MS = 2_000;
