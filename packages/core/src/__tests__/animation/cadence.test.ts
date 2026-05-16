/**
 * Streaming cadence suite. The {@link StreamingCadence} module is the
 * chart-side observer that turns real wall-clock arrival intervals between
 * `setSeriesData(..., {streaming: true, append: true})` calls into a
 * smoothed duration the X autoScroll retarget uses to size its slide.
 *
 * Tests:
 *  - EMA convergence over a steady cadence
 *  - bg-tab burst filter (gap < MIN_OBSERVE_GAP_MS)
 *  - idle preserve (gap >= STREAM_IDLE_RESET, EMA frozen)
 *  - floor clamp on `pickDuration(floor)`
 *  - ceiling clamp (SCROLL_TO_END_MAX)
 *  - `observe` is callable many times (chart loops it on every append)
 */
import { describe, expect, it } from 'vitest';

import { StreamingCadence } from '../../chart/streaming-cadence';

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
    expect(cadence.pickDuration(0)).toBeCloseTo(100, 0);
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
  // Clamps on `pickDuration`
  // ---------------------------------------------------------------------------

  it('pickDuration clamps the measured cadence below `floor` to floor', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 10; i++) {
      now += 50;
      cadence.observe(now);
    }
    // Measured ~50 ms; floor=250 → clamped up.
    expect(cadence.pickDuration(250)).toBeCloseTo(250, 0);
  });

  it('pickDuration clamps an extreme measured cadence to the SCROLL_TO_END_MAX ceiling', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    // Largest legal individual sample is just below STREAM_IDLE_RESET (5000).
    for (let i = 0; i < 6; i++) {
      now += 4900;
      cadence.observe(now);
    }
    // EMA should have climbed close to 4900; pickDuration ceiling = 5000.
    expect(cadence.pickDuration(0)).toBeLessThanOrEqual(5000);
  });

  // ---------------------------------------------------------------------------
  // No measurement yet → pickDuration returns floor
  // ---------------------------------------------------------------------------

  it('pickDuration without any observed samples returns `floor` unchanged', () => {
    const cadence = new StreamingCadence();
    expect(cadence.pickDuration(250)).toBe(250);

    // One sample is not enough to seed the EMA (the first observe just
    // records the wall stamp).
    cadence.observe(1000);
    expect(cadence.pickDuration(250)).toBe(250);
  });
});
