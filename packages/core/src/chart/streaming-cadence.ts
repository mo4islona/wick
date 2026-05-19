import type { Milliseconds } from '../animation';

/**
 * Real wall-clock gap (ms) at or above which an `observe()` call is treated
 * as the start of a new stream session — the EMA is preserved (so the next
 * normal-cadence tick doesn't snap to a 5-second slide derived from the
 * pause), but no new sample is folded in.
 */
const STREAM_IDLE_RESET = 5000;

/**
 * Background-tab burst filter. Browsers buffer rAF / setTimeout in inactive
 * tabs and flush them all at once on visibility return — gaps below this
 * threshold are skipped so the EMA isn't poisoned by the burst.
 */
const MIN_OBSERVE_GAP_MS = 5;

/** EMA smoothing factor. Lower = slower adapt, higher = noisier. */
const CADENCE_EMA_ALPHA = 0.3;

/**
 * Upper bound returned by {@link pickSettleMs}. A pathological measured gap
 * shouldn't translate into a settle time longer than this — the spring would
 * stop feeling responsive.
 */
const SETTLE_MS_MAX = 5000;

/**
 * Tracks the real wall-clock inter-arrival gap between streaming append
 * events and exposes an exponentially-smoothed cadence the chart uses to
 * size the X spring's settle time. Spring math is velocity-continuous; the
 * cadence just keeps `settleMs` slightly longer than the producer's tick
 * interval so the spring never settles between ticks (no stop-and-go).
 */
export class StreamingCadence {
  #lastWall = 0;
  #emaMs = 0;

  /** Fold a new arrival into the EMA. Pass `performance.now()` from the host. */
  observe(now: number): void {
    if (this.#lastWall > 0) {
      const gap = now - this.#lastWall;
      if (gap >= MIN_OBSERVE_GAP_MS && gap < STREAM_IDLE_RESET) {
        this.#emaMs = this.#emaMs === 0 ? gap : CADENCE_EMA_ALPHA * gap + (1 - CADENCE_EMA_ALPHA) * this.#emaMs;
      }
      // gap < MIN_OBSERVE_GAP_MS  — bg-tab burst, skip.
      // gap >= STREAM_IDLE_RESET  — real stream idle, skip (preserve EMA).
    }

    this.#lastWall = now;
  }

  /**
   * Reset the inter-arrival tracker without dropping the EMA. The next
   * `observe()` is treated as a session restart so a skipped-tick window
   * (e.g. ViewportEngine gesture lock-out) doesn't poison the EMA with the
   * gap-during-gesture wall-time. EMA is preserved so the post-gesture
   * cadence picks up where streaming left off.
   */
  pause(): void {
    this.#lastWall = 0;
  }

  /**
   * Pick a settle time for the X spring sized to the current cadence. The
   * spring should still be mid-flight when the next data tick arrives —
   * otherwise its velocity decays toward zero between ticks and the slide
   * reads as a bell-curve pulse (accelerate → peak → decelerate → restart).
   *
   * `floor` is the user-configured baseline (typically `animations.axis.x.settle`);
   * returned value is `max(floor, ema * slack)` clamped at {@link SETTLE_MS_MAX}.
   * The `slack` multiplier (default 3.0) means the spring's 99 %-settle
   * window is ~3 × the measured cadence — at any one tick the spring is at
   * roughly the 1/3 point of its decay, with significant velocity that
   * carries seamlessly into the next retarget. Lower slack (e.g., 1.2)
   * leaves the spring closer to settled by the next tick and reintroduces
   * the bell-curve pulse; higher slack (e.g., 5) tightens the visual lag
   * but makes the slide feel laggier behind the live tail.
   */
  pickSettleMs(floor: Milliseconds, slack = 3.0): Milliseconds {
    if (this.#emaMs === 0) return floor;

    return Math.min(SETTLE_MS_MAX, Math.max(floor, this.#emaMs * slack));
  }

  /**
   * Current EMA value. Hidden behind a getter to keep state read-only.
   * @internal Test-only; not part of the production API.
   */
  get emaMs(): number {
    return this.#emaMs;
  }
}
