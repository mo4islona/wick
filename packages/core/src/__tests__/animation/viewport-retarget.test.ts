/**
 * Viewport-level retarget continuity.
 *
 * The viewport's animation engine is now {@link Animator}; this suite pins the
 * "retarget mid-flight preserves visual position" contract specifically at the
 * viewport surface. Failing assertions here mean a streaming chart will jitter
 * or jump on rapid back-to-back retargets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Viewport } from '../../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;

describe('viewport retarget continuity', () => {
  let now = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    now = 0;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function makeViewport(): Viewport {
    const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(100 * INTERVAL);
    v.fitToData(0, 100 * INTERVAL, { chartWidth: CHART_WIDTH });

    return v;
  }

  it('mid-animation scrollToEnd retarget does not jump visualRange', () => {
    const v = makeViewport();

    let lastTime = 100 * INTERVAL;
    now = 1_000;
    lastTime += INTERVAL;
    v.setDataEnd(lastTime);
    v.scrollToEnd(lastTime, CHART_WIDTH);

    // Halfway through the streamTick animation (250 ms → +125 ms).
    now = 1_125;
    v.tick(now);
    const midVisual = v.visibleRange.to;
    expect(v.animating).toBe(true);

    // New tick arrives — retarget mid-flight. Visual must not jump.
    lastTime += INTERVAL;
    v.setDataEnd(lastTime);
    v.scrollToEnd(lastTime, CHART_WIDTH);

    expect(v.visibleRange.to).toBeCloseTo(midVisual, 5);
  });

  it('logicalRange snaps to retarget target while visualRange continues to animate', () => {
    const v = makeViewport();
    now = 0;
    v.setDataEnd(101 * INTERVAL);
    v.scrollToEnd(101 * INTERVAL, CHART_WIDTH);

    const target = v.logicalRange.to;
    expect(target).toBeCloseTo(101 * INTERVAL + 3 * INTERVAL, 5);

    // visualRange has not moved yet — animation still at t=0.
    expect(v.visibleRange.to).not.toBeCloseTo(target, 5);

    // After the animation completes, visual catches up.
    for (let i = 0; i < 20; i++) {
      now += 16;
      v.tick(now);
    }
    expect(v.visibleRange.to).toBeCloseTo(target, 5);
  });

  it('repeated streaming retargets converge to the latest target', () => {
    const v = makeViewport();
    const rightPad = 3 * INTERVAL;
    let lastTime = 100 * INTERVAL;

    now = 0;
    for (let i = 0; i < 10; i++) {
      lastTime += INTERVAL;
      v.setDataEnd(lastTime);
      v.scrollToEnd(lastTime, CHART_WIDTH);
      now += 16;
      v.tick(now);
    }

    // Drain.
    for (let i = 0; i < 30; i++) {
      now += 16;
      v.tick(now);
    }

    expect(v.visibleRange.to).toBeCloseTo(lastTime + rightPad, -1);
    expect(v.logicalRange.to).toBeCloseTo(lastTime + rightPad, -1);
    expect(v.animating).toBe(false);
  });

  it('fitToData(animated=true) animates from visualRange, not from a snapshot', () => {
    const v = makeViewport();

    // Move the viewport to a known state, animated.
    now = 0;
    v.setDataEnd(150 * INTERVAL);
    v.scrollToEnd(150 * INTERVAL, CHART_WIDTH);

    // Halfway: visual is mid-tween.
    now = 75;
    v.tick(now);
    const midVisual = { ...v.visibleRange };

    // Issue an animated fitToData. Visual must not jump.
    v.fitToData(0, 200 * INTERVAL, { chartWidth: CHART_WIDTH, animated: true });

    expect(v.visibleRange.from).toBeCloseTo(midVisual.from, 5);
    expect(v.visibleRange.to).toBeCloseTo(midVisual.to, 5);
  });
});
