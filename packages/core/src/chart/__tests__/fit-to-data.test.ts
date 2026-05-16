/**
 * computeFitToData — pure-function unit tests.
 *
 * Covers the cases the old `viewport.test.ts::fitToData` suite asserted
 * through the now-deleted `Viewport.fitToData` wrapper: basic span fit,
 * zero padding pinning the right edge to lastTime, pixel padding scaled by
 * chartWidth, interval padding adding N * dataInterval, max-bars cap
 * anchoring right.
 */
import { describe, expect, it } from 'vitest';

import { computeFitToData } from '../fit-to-data';

const INTERVAL = 60_000;

describe('computeFitToData', () => {
  it('fits the visible range around the data span (default padding)', () => {
    const range = computeFitToData({
      firstTime: 1_000_000,
      lastTime: 7_000_000,
      dataInterval: INTERVAL,
      maxVisibleBars: 200,
      chartWidth: 800,
      padding: { left: { intervals: 0 }, right: { intervals: 3 } },
    });
    expect(range.from).toBeLessThanOrEqual(1_000_000);
    expect(range.to).toBeGreaterThanOrEqual(7_000_000);
  });

  it('zero padding places lastTime exactly at the right edge', () => {
    const range = computeFitToData({
      firstTime: 0,
      lastTime: 6_000_000,
      dataInterval: INTERVAL,
      maxVisibleBars: 200,
      chartWidth: 800,
      padding: { left: { intervals: 0 }, right: { intervals: 0 } },
    });
    expect(range.from).toBe(0);
    expect(range.to).toBe(6_000_000);
  });

  it('right padding as pixels is proportional to chart width', () => {
    // right: 80px on 800px wide chart = 10% of dataSpan → pr = (80/800)*18_000_000 = 1_800_000
    const range = computeFitToData({
      firstTime: 0,
      lastTime: 18_000_000,
      dataInterval: INTERVAL,
      maxVisibleBars: 200,
      chartWidth: 800,
      padding: { left: 0, right: 80 },
    });
    expect(range.to).toBeCloseTo(18_000_000 + 1_800_000, 0);
  });

  it('right padding as intervals adds N * dataInterval', () => {
    const range = computeFitToData({
      firstTime: 0,
      lastTime: 18_000_000,
      dataInterval: INTERVAL,
      maxVisibleBars: 200,
      chartWidth: 800,
      padding: { left: { intervals: 0 }, right: { intervals: 3 } },
    });
    expect(range.to).toBeCloseTo(18_000_000 + 3 * INTERVAL, 0);
  });

  it('overflow caps the span at maxVisibleBars * dataInterval, anchored right', () => {
    const range = computeFitToData({
      firstTime: 0,
      lastTime: 500 * INTERVAL, // 500 bars data, cap at 50
      dataInterval: INTERVAL,
      maxVisibleBars: 50,
      chartWidth: 800,
      padding: { left: { intervals: 0 }, right: { intervals: 3 } },
    });
    expect(range.to).toBe(500 * INTERVAL + 3 * INTERVAL);
    expect(range.to - range.from).toBe(50 * INTERVAL);
  });

  it('zero chartWidth + pixel padding still produces a valid range (pixel pad becomes 0)', () => {
    const range = computeFitToData({
      firstTime: 0,
      lastTime: 100 * INTERVAL, // 100 bars — under the 200-bar cap
      dataInterval: INTERVAL,
      maxVisibleBars: 200,
      chartWidth: 0,
      padding: { left: 50, right: 50 },
    });
    expect(range.from).toBe(0);
    expect(range.to).toBe(100 * INTERVAL);
  });
});
