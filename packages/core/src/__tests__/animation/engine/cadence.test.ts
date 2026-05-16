/**
 * Streaming cadence suite. The {@link StreamingCadence} module observes the
 * real wall-clock arrival cadence on `appendData` calls. The EMA is kept
 * for telemetry / future use; the chart's X data_tick now slides over a
 * fixed `floor` so producer cadence does not stretch the duration into
 * sub-pixel quantization territory (see `pickDuration` for the rationale).
 *
 * Tests:
 *  - EMA convergence over a steady cadence
 *  - bg-tab burst filter (gap < MIN_OBSERVE_GAP_MS)
 *  - idle preserve (gap >= STREAM_IDLE_RESET, EMA frozen)
 *  - `pickDuration` always returns the floor regardless of EMA state
 *  - `observe` is callable many times (chart loops it on every append)
 */
import { describe, expect, it } from 'vitest';

import { StreamingCadence } from '../../../chart/streaming-cadence';

describe('StreamingCadence', () => {
  // ---------------------------------------------------------------------------
  // EMA convergence
  // ---------------------------------------------------------------------------

  it('EMA converges to a steady cadence within a handful of samples', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    // Feed a steady 100ms cadence.
    for (let i = 0; i < 12; i++) {
      now += 100;
      cadence.observe(now);
    }

    // EMA must have converged near 100 — α=0.3 over 12 samples is well past
    // 99% of the way regardless of the initial value.
    expect(cadence.emaMs).toBeCloseTo(100, 0);
  });

  // ---------------------------------------------------------------------------
  // Idle preservation — large gaps don't poison the EMA
  // ---------------------------------------------------------------------------

  it('idle gap >= STREAM_IDLE_RESET preserves the EMA instead of flooding it', () => {
    const cadence = new StreamingCadence();

    // Warm-up — get the EMA close to 100.
    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 12; i++) {
      now += 100;
      cadence.observe(now);
    }
    const beforeIdle = cadence.emaMs;

    // 10 s pause — way past STREAM_IDLE_RESET (5000 ms).
    now += 10_000;
    cadence.observe(now);
    expect(cadence.emaMs).toBeCloseTo(beforeIdle, 5);

    // Next normal observation should fold in normally.
    now += 100;
    cadence.observe(now);
    expect(cadence.emaMs).toBeCloseTo(100, 0);
  });

  // ---------------------------------------------------------------------------
  // bg-tab burst filter — sub-5ms gaps don't poison the EMA
  // ---------------------------------------------------------------------------

  it('bg-tab burst filter rejects gap < MIN_OBSERVE_GAP_MS without dropping the running EMA', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 10; i++) {
      now += 100;
      cadence.observe(now);
    }
    const beforeBurst = cadence.emaMs;

    // Simulate a burst: 10 rAFs flushed back-to-back, each 1 ms apart.
    for (let i = 0; i < 10; i++) {
      now += 1;
      cadence.observe(now);
    }
    expect(cadence.emaMs).toBeCloseTo(beforeBurst, 5);
  });

  // ---------------------------------------------------------------------------
  // pickDuration always returns the floor
  // ---------------------------------------------------------------------------

  it('pickDuration returns the floor unchanged for a fast measured cadence', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 10; i++) {
      now += 50;
      cadence.observe(now);
    }
    // Measured ~50 ms; floor=250 wins.
    expect(cadence.pickDuration(250)).toBe(250);
  });

  it('pickDuration returns the floor unchanged for a slow measured cadence — does not stretch to the EMA', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    // 4900 ms per sample — close to the STREAM_IDLE_RESET cap.
    for (let i = 0; i < 6; i++) {
      now += 4900;
      cadence.observe(now);
    }
    // EMA has climbed near 4900; pickDuration must still return floor.
    expect(cadence.emaMs).toBeGreaterThan(1000);
    expect(cadence.pickDuration(250)).toBe(250);
  });

  it('pickDuration without any observed samples returns `floor` unchanged', () => {
    const cadence = new StreamingCadence();
    expect(cadence.pickDuration(250)).toBe(250);

    // One sample is not enough to seed the EMA (the first observe just
    // records the wall stamp).
    cadence.observe(1000);
    expect(cadence.pickDuration(250)).toBe(250);
  });
});
