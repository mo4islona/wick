import type { Milliseconds } from '../animation/time';

/**
 * Real wall-clock gap (ms) at or above which an `observe()` call is treated
 * as the start of a new stream session — no new sample is folded in.
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
 * Tracks the real wall-clock inter-arrival gap between streaming append
 * events. The EMA is exposed for telemetry / future use, but
 * {@link pickDuration} no longer stretches the slide to match it — see
 * the comment there for the reason.
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
   * Pick a settle duration for the next X retarget. Always returns the
   * caller-supplied floor.
   *
   * Earlier versions stretched the duration to `max(floor, emaMs)` so a
   * slow-producer slide stayed in lockstep with cadence. That backfired on
   * candle feeds: at 5 s/bar the slide ran for 5 s too, covering one ~13 px
   * bar over ~300 frames — visibly sub-pixel-per-frame, which the canvas
   * rounds into 1 px jumps every ~24 frames (the "jerky slide" the user
   * reports). A fixed `floor` slides the viewport quickly (≤ 250 ms) and
   * then idles between bars; the slide is fast enough that pixel
   * quantization isn't perceptible.
   */
  pickDuration(floor: Milliseconds): Milliseconds {
    return floor;
  }

  /** Test-only — the current EMA. Hidden behind a getter to keep state read-only. */
  get emaMs(): number {
    return this.#emaMs;
  }
}
