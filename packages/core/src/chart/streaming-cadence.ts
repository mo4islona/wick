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
 * Upper bound for `pickDuration()`. A user-configured floor too long, or an
 * extreme measured gap, will not drag the streaming ease past this — it'd
 * stop feeling responsive.
 */
const SCROLL_TO_END_MAX = 5000;

/**
 * Tracks the real wall-clock inter-arrival gap between streaming append
 * events and exposes an exponentially-smoothed cadence the chart uses to
 * size the next X autoScroll retarget. EMA over the raw gap keeps the
 * sliding viewport in lockstep with the producer through small jitter, and
 * the two-sided gap filter rejects bg-tab bursts and idle pauses without
 * dropping the smoothing state.
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
   * Pick a settle duration for the next X retarget. `floor` is the
   * user-configured minimum (typically `animations.x.dataTick`). The result
   * is clamped to `[floor, SCROLL_TO_END_MAX]`; if no EMA has accumulated
   * yet, the floor is returned as-is.
   */
  pickDuration(floor: Milliseconds): Milliseconds {
    if (this.#emaMs === 0) return floor;

    return Math.min(SCROLL_TO_END_MAX, Math.max(floor, this.#emaMs));
  }

  /** Test-only — the current EMA. Hidden behind a getter to keep state read-only. */
  get emaMs(): number {
    return this.#emaMs;
  }
}
