/**
 * Single source of truth for animation durations across the chart.
 *
 * User-facing knobs (`animations.x.dataTick`, `animations.y.*`,
 * `animations.series.*.entry|smooth`, etc.) override these defaults; the
 * constants here describe the unconfigured baseline.
 */

/** Coordinated default — every "settling" animation (X re-fit, Y chase,
 *  entrance, fit) shares this duration so a single triggering event lands
 *  X, Y and per-series live-track on the same frame. */
const SHARED_ANIMATION_MS = 250;

export const ANIM = {
  /** Per-event retarget for live pan / zoom gestures. Intentionally short
   *  (and `0` by default in `DEFAULT_X_GESTURE`) — input animation is opt-in;
   *  this is the suggested duration when enabling. */
  inputResponse: 60,
  /** Streaming data tick: new point appended, X / Y / last-bar tracker all
   *  retarget with this duration so they arrive in lockstep. */
  streamTick: SHARED_ANIMATION_MS,
  /** Explicit fit-to-data / batch reflow. */
  fit: SHARED_ANIMATION_MS,
  /** Y-range chase when only Y bounds change (no new data, no user input). */
  yChase: SHARED_ANIMATION_MS,
  /** Per-point entrance default. */
  entryDefault: SHARED_ANIMATION_MS,
} as const;

export type AnimKey = keyof typeof ANIM;
