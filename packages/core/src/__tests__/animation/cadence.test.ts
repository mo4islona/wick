/**
 * Streaming cadence suite. The {@link StreamingCadence} module is the
 * chart-side observer that turns real wall-clock arrival intervals between
 * `setSeriesData(..., {streaming: true, append: true})` calls into a
 * smoothed cadence the X spring's settle time tracks.
 *
 * Tests:
 *  - EMA convergence over a steady cadence
 *  - bg-tab burst filter (gap < MIN_OBSERVE_GAP_MS)
 *  - idle preserve (gap >= STREAM_IDLE_RESET, EMA frozen)
 *  - floor clamp on `pickSettleMs(floor)`
 *  - ceiling clamp (SETTLE_MS_MAX)
 *  - slack multiplier applied above floor
 *  - `pause()` resets the inter-arrival tracker without dropping the EMA
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
    for (let i = 0; i < 12; i++) {
      now += 100;
      cadence.observe(now);
    }

    expect(cadence.emaMs).toBeCloseTo(100, 0);
  });

  // ---------------------------------------------------------------------------
  // Idle preservation — large gaps don't poison the EMA
  // ---------------------------------------------------------------------------

  it('idle gap >= STREAM_IDLE_RESET preserves the EMA instead of flooding it', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 12; i++) {
      now += 100;
      cadence.observe(now);
    }
    const beforeIdle = cadence.emaMs;

    now += 10_000;
    cadence.observe(now);
    expect(cadence.emaMs).toBeCloseTo(beforeIdle, 5);

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

    for (let i = 0; i < 10; i++) {
      now += 1;
      cadence.observe(now);
    }
    expect(cadence.emaMs).toBeCloseTo(beforeBurst, 5);
  });

  // ---------------------------------------------------------------------------
  // pickSettleMs clamps
  // ---------------------------------------------------------------------------

  it('pickSettleMs returns floor when EMA*slack is below it', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 10; i++) {
      now += 50;
      cadence.observe(now);
    }
    // EMA ~50; with default slack 3.0 = 150; floor 250 → 250.
    expect(cadence.pickSettleMs(250)).toBeCloseTo(250, 0);
  });

  it('pickSettleMs returns ema*slack when above floor', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 12; i++) {
      now += 1000;
      cadence.observe(now);
    }
    // EMA ~1000; with default slack 3.0 = 3000; floor 200 → 3000.
    expect(cadence.pickSettleMs(200)).toBeCloseTo(3000, -2);
  });

  it('pickSettleMs ceiling is SETTLE_MS_MAX (5000ms)', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 6; i++) {
      now += 4900;
      cadence.observe(now);
    }
    // EMA ≈ 4900, *3.0 = 14700; clamped to 5000.
    expect(cadence.pickSettleMs(0)).toBeLessThanOrEqual(5000);
  });

  it('pickSettleMs honors a custom slack multiplier', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 12; i++) {
      now += 500;
      cadence.observe(now);
    }
    // EMA ~500; slack 2 = 1000; floor 200 → 1000.
    expect(cadence.pickSettleMs(200, 2)).toBeCloseTo(1000, -1);
  });

  // ---------------------------------------------------------------------------
  // No measurement yet
  // ---------------------------------------------------------------------------

  it('pickSettleMs without any observed samples returns `floor` unchanged', () => {
    const cadence = new StreamingCadence();
    expect(cadence.pickSettleMs(250)).toBe(250);

    cadence.observe(1000);
    expect(cadence.pickSettleMs(250)).toBe(250);
  });

  // ---------------------------------------------------------------------------
  // pause()
  // ---------------------------------------------------------------------------

  it('pause() drops the inter-arrival baseline without touching the EMA', () => {
    const cadence = new StreamingCadence();

    let now = 1000;
    cadence.observe(now);
    for (let i = 0; i < 10; i++) {
      now += 40;
      cadence.observe(now);
    }
    const ema = cadence.emaMs;
    expect(ema).toBeCloseTo(40, 0);

    cadence.pause();
    now += 160;
    cadence.observe(now);
    expect(cadence.emaMs).toBeCloseTo(ema, 5);

    now += 40;
    cadence.observe(now);
    expect(cadence.emaMs).toBeCloseTo(40, 0);
  });
});
