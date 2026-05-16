/**
 * Single source of truth for animation durations across the chart.
 *
 * Every transition that goes through {@link Animator.setTarget} should resolve
 * its duration from this object so that the visual model stays consistent —
 * e.g. an X re-fit and the matching Y re-range share the same timing budget
 * and arrive at their targets on the same frame.
 *
 * User-facing knobs (`yAxisMs`, `entryMs`, `smoothMs`, `reboundMs`) override
 * these defaults; the constants here describe the unconfigured baseline.
 */
/** Coordinated default — every "settling" animation (X re-fit, Y chase,
 * rebound, fit, entrance) shares this duration so a single triggering event
 * produces lockstep arrival across the X viewport, Y range, and last-bar
 * live-track. Pulse cycles and per-event input ease use their own values. */
const SHARED_ANIMATION_MS = 250;

export const ANIM = {
  /** Per-event retarget for live pan / zoom gestures. Intentionally short
   * (and `0` by default in `DEFAULT_X_GESTURE`) — input animation is opt-in;
   * this is the suggested duration when enabling. */
  inputResponse: 60,
  /** Streaming data tick: new point appended, viewport + Y range + last-bar
   * tracker all retarget with this duration so they land in lockstep. */
  streamTick: SHARED_ANIMATION_MS,
  /** Explicit fit-to-data / batch reflow. */
  fit: SHARED_ANIMATION_MS,
  /** Post-gesture rubber-band snap-back. Configurable per Viewport instance
   * via `reboundMs`; this is the unconfigured default. */
  rebound: SHARED_ANIMATION_MS,
  /** Y-range chase when only Y bounds change (no new data, no user input). */
  yChase: SHARED_ANIMATION_MS,
  /** Per-point entrance default. */
  entryDefault: SHARED_ANIMATION_MS,
} as const;

export type AnimKey = keyof typeof ANIM;
