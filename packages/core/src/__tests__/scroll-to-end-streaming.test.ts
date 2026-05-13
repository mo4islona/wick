/**
 * Regression test for a user-reported bug: after the rubber-band scroll rework,
 * the candlestick page stopped following the last point during live streaming.
 *
 * The failure mode: scrollToEnd's threshold logic was eating legitimate
 * per-bar updates, leaving the visible range stuck one bar behind the head.
 *
 * These tests drive the Viewport directly — no Canvas, no React — so they
 * capture the exact sequence Chart.onDataChanged produces during streaming
 * and assert that the visible window stays pinned to the latest bar's right
 * padding.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;

function makeViewport(): Viewport {
  const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
  v.setDataInterval(INTERVAL);
  v.setDataStart(0);
  v.setDataEnd(100 * INTERVAL);
  v.fitToData(0, 100 * INTERVAL, { chartWidth: CHART_WIDTH });
  return v;
}

/** Run the animation to completion. */
function completeAnimation(v: Viewport): void {
  // Multiple ticks to cover 150ms + safety margin.
  const now = performance.now();
  for (let i = 0; i < 20; i++) v.tick(now + i * 20);
}

describe('scrollToEnd streaming regression', () => {
  it('pins the right edge to the latest bar after a sequence of new-bar updates', () => {
    const v = makeViewport();
    const rightPad = 3 * INTERVAL;

    let lastTime = 100 * INTERVAL;
    for (let i = 0; i < 10; i++) {
      lastTime += INTERVAL;
      v.setDataEnd(lastTime);
      v.scrollToEnd(lastTime, CHART_WIDTH);
      completeAnimation(v);
    }

    // Right edge must now sit exactly at lastTime + rightPad (within 1 unit).
    expect(v.visibleRange.to).toBeCloseTo(lastTime + rightPad, -1);
  });

  it('updateLast-style re-scrollToEnd with unchanged lastTime is a cheap no-op (no animation)', () => {
    const v = makeViewport();
    const lastTime = 100 * INTERVAL;
    const targetTo = lastTime + 3 * INTERVAL;
    // Already pinned: visibleRange.to equals target.
    expect(v.visibleRange.to).toBeCloseTo(targetTo, -1);

    v.scrollToEnd(lastTime, CHART_WIDTH);
    expect(v.animating).toBe(false);
    // Many repeats simulating updateLast bursts shouldn't accumulate drift.
    for (let i = 0; i < 50; i++) v.scrollToEnd(lastTime, CHART_WIDTH);
    expect(v.animating).toBe(false);
    expect(v.visibleRange.to).toBeCloseTo(targetTo, -1);
  });

  it('continuous streaming where each new bar arrives before the prior animation finishes', () => {
    const v = makeViewport();
    const rightPad = 3 * INTERVAL;
    let lastTime = 100 * INTERVAL;

    // Emit a new bar every 60ms — the 150ms scroll animation is always mid-flight.
    let simNow = performance.now();
    for (let i = 0; i < 30; i++) {
      lastTime += INTERVAL;
      v.setDataEnd(lastTime);
      v.scrollToEnd(lastTime, CHART_WIDTH);
      // Advance mock clock by 60ms and tick the animation partway.
      simNow += 60;
      v.tick(simNow);
    }
    // Let any in-flight animation finish.
    for (let i = 0; i < 10; i++) {
      simNow += 20;
      v.tick(simNow);
    }

    // After 30 new bars, the right edge must track the latest, not lag behind.
    expect(v.visibleRange.to).toBeCloseTo(lastTime + rightPad, -1);
  });

  it('rapid micro-updates (updateLast + occasional new bar) still converge to the pinned right edge', () => {
    const v = makeViewport();
    const rightPad = 3 * INTERVAL;
    let lastTime = 100 * INTERVAL;

    let simNow = performance.now();
    for (let i = 0; i < 60; i++) {
      // 9 of 10 ticks are updateLast on the same bar; every 10th adds a new bar.
      if (i % 10 === 9) {
        lastTime += INTERVAL;
        v.setDataEnd(lastTime);
      }
      v.scrollToEnd(lastTime, CHART_WIDTH);
      simNow += 50;
      v.tick(simNow);
    }
    // Drain to settle.
    for (let i = 0; i < 20; i++) {
      simNow += 20;
      v.tick(simNow);
    }

    expect(v.visibleRange.to).toBeCloseTo(lastTime + rightPad, -1);
  });
});
