/**
 * Axis-label fade timing — shared between {@link TimeAxis} and {@link YAxis}.
 *
 * The fade is a pure CSS opacity transition, not Animator-driven, because the
 * label set itself is rebuilt on every render: a tick that "leaves" the
 * range becomes a separate DOM node fading out while a new node fades in,
 * and inline `transition` is the cheapest way to crossfade them without a
 * per-tick Animator instance.
 *
 * The duration matches the chart-level `DEFAULT_ENTER_MS` / `streamTick` so
 * label transitions land in lockstep with the X re-fit, Y range chase, and
 * series live-track. Cleanup buffer leaves the node mounted past the
 * visible fade so React doesn't unmount it mid-transition.
 */

const AXIS_LABEL_FADE_MS = 250;

/** Inline `style.transition` value the axis label spans use. */
export const AXIS_LABEL_FADE_CSS = `opacity ${AXIS_LABEL_FADE_MS / 1000}s ease`;

/** Time after which a faded-out tick can be dropped from the persistent map.
 * `2 * AXIS_LABEL_FADE_MS` — one transition plus a frame margin. */
export const AXIS_LABEL_CLEANUP_MS = AXIS_LABEL_FADE_MS * 2;
