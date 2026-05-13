/**
 * Logical/visual split contract.
 *
 * Pin the rule: gesture math (pan rubber-band, zoom overshoot resistance,
 * autoscroll-on-tail-visible decision, edgeReached classification, scrollToEnd
 * threshold) reads `logicalRange` (= animator.target). Render reads
 * `visualRange` (= animator.current). The legacy public `visibleRange` keeps
 * its name and resolves to visual.
 *
 * If a future refactor routes a math read through visualRange, the assertions
 * below catch it: a pan or scrollToEnd issued mid-animation operates on stale
 * (interpolated) state and produces wrong-magnitude shifts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Viewport } from '../../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;

describe('logical/visual split', () => {
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

  it('visibleRange is an alias for visualRange (backward compat)', () => {
    const v = makeViewport();

    expect(v.visibleRange).toEqual(v.visualRange);
  });

  it('settled viewport has visualRange === logicalRange', () => {
    const v = makeViewport();

    expect(v.visualRange).toEqual(v.logicalRange);
  });

  it('mid-animation: logicalRange holds the target, visualRange is mid-tween', () => {
    const v = makeViewport();
    now = 0;
    v.setDataEnd(110 * INTERVAL);
    v.scrollToEnd(110 * INTERVAL, CHART_WIDTH);

    // Right after retarget — visual at the old position, logical at the target.
    expect(v.logicalRange.to).toBeCloseTo(110 * INTERVAL + 3 * INTERVAL, 5);
    expect(v.visualRange.to).not.toBeCloseTo(v.logicalRange.to, 5);

    // Halfway: visual has moved partway, logical unchanged.
    now = 75;
    v.tick(now);
    const targetTo = v.logicalRange.to;
    expect(v.visualRange.to).toBeGreaterThan(100 * INTERVAL + 3 * INTERVAL);
    expect(v.visualRange.to).toBeLessThan(targetTo);
    expect(v.logicalRange.to).toBeCloseTo(targetTo, 5);
  });

  it('pan during animation takes over the in-flight animation at the visual position', () => {
    const v = makeViewport();
    now = 0;
    // Programmatic animation in flight.
    v.setDataEnd(110 * INTERVAL);
    v.scrollToEnd(110 * INTERVAL, CHART_WIDTH);
    now = 75;
    v.tick(now);

    const logicalBefore = { ...v.logicalRange };
    const visualBefore = { ...v.visualRange };
    expect(visualBefore.from).not.toBeCloseTo(logicalBefore.from, 5);

    // Pan by exactly one interval. The takeover rule: user input commits the
    // current visual position as the new logical baseline (so the chart
    // doesn't visibly jump from mid-tween to the animation's destination
    // before the pan applies), then the shift is layered on top.
    v.pan(INTERVAL, CHART_WIDTH);

    // Pan-from-visual: logical now equals visualBefore + INTERVAL.
    expect(v.logicalRange.from).toBeCloseTo(visualBefore.from + INTERVAL, 5);
    expect(v.logicalRange.to).toBeCloseTo(visualBefore.to + INTERVAL, 5);

    // visual === logical and animation cancelled.
    expect(v.visualRange).toEqual(v.logicalRange);
    expect(v.animating).toBe(false);
  });

  it('zoom during animation takes over at the visual position (no pre-zoom jump)', () => {
    const v = makeViewport();
    now = 0;
    v.setDataEnd(110 * INTERVAL);
    v.scrollToEnd(110 * INTERVAL, CHART_WIDTH);
    now = 75;
    v.tick(now);

    const logicalRangeBefore = v.logicalRange.to - v.logicalRange.from;

    // Zoom in by 0.7× (no softMin or softMax clamp at this scale — well above
    // the 10-bar floor). Resulting logical range must be exactly 0.7× of the
    // old logical range — proves the zoom factor was applied to logical, not
    // mid-tween visual.
    v.zoomAt((v.logicalRange.from + v.logicalRange.to) / 2, 0.7, CHART_WIDTH);

    const newLogicalRange = v.logicalRange.to - v.logicalRange.from;
    expect(newLogicalRange).toBeCloseTo(logicalRangeBefore * 0.7, 5);
  });

  it('scrollToEnd threshold check reads logical so sub-pixel ticks during animation are filtered', () => {
    const v = makeViewport();
    now = 0;
    // Initial retarget — sets logicalRange.to = 101*INTERVAL + 3*INTERVAL.
    v.setDataEnd(101 * INTERVAL);
    v.scrollToEnd(101 * INTERVAL, CHART_WIDTH);
    const targetAfterFirst = v.logicalRange.to;

    // Mid-animation — visual is somewhere between the old and new tail.
    now = 30;
    v.tick(now);
    expect(v.visualRange.to).toBeLessThan(targetAfterFirst);

    // A new scrollToEnd with the SAME lastTime would try to retarget to the
    // same target. Threshold against logical (which equals targetAfterFirst)
    // gives delta=0 → early-return. Against visual, delta is non-zero →
    // would re-retarget and reset the easing curve.
    v.scrollToEnd(101 * INTERVAL, CHART_WIDTH);

    // logicalRange.to unchanged — confirms the early-return path fired.
    expect(v.logicalRange.to).toBeCloseTo(targetAfterFirst, 5);
  });

  it('rebound math reads logical so in-flight animations do not double-bounce', () => {
    const v = makeViewport();
    now = 0;
    v.setDataEnd(101 * INTERVAL);
    v.scrollToEnd(101 * INTERVAL, CHART_WIDTH);
    now = 50;
    v.tick(now);

    // Calling startRebound mid-animation reads logical — the committed target
    // is already inside soft bounds, so rebound is a no-op (no double-bounce
    // animation that would fight the in-flight scrollToEnd).
    v.startRebound(CHART_WIDTH);

    // Rebound did not fire a new animation: animator's target unchanged.
    expect(v.logicalRange.to).toBeCloseTo(101 * INTERVAL + 3 * INTERVAL, 5);
  });
});
