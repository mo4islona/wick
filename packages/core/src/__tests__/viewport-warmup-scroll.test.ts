/**
 * Regression test: streaming charts that start from a single data point used to
 * scroll right with every new tick, keeping only the latest point visible.
 *
 * The fix routes warm-up ticks through `fitToData` while the data still sits
 * inside the natural fit-to-data viewport. These tests pin that contract by
 * driving `Viewport` directly and reproducing the decision `Chart.onDataChanged`
 * makes between `fitToData` and `scrollToEnd`.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;
const RIGHT_INTERVALS = 3;

function makeViewport(): Viewport {
  const v = new Viewport({
    padding: { right: { intervals: RIGHT_INTERVALS }, left: { intervals: 0 } },
  });
  v.setDataInterval(INTERVAL);

  return v;
}

function completeAnimation(v: Viewport): void {
  const now = performance.now();
  for (let i = 0; i < 30; i++) v.tick(now + i * 20);
}

/**
 * Mirrors the decision in `Chart.onDataChanged` for non-batch tick updates:
 * fit while the warm-up predicate holds, otherwise scroll. Centralised here so
 * tests express the same policy the production code applies.
 */
function appendTick(v: Viewport, first: number, last: number): void {
  v.setDataStart(first);
  v.setDataEnd(last);

  if (v.dataFitsCurrentViewport(CHART_WIDTH)) {
    v.fitToData(first, last, CHART_WIDTH, true);
  } else {
    v.scrollToEnd(last, CHART_WIDTH);
  }
}

describe('viewport warm-up scroll', () => {
  it('keeps the single-point viewport anchored — no scroll on a repeated identical tick', () => {
    const v = makeViewport();
    const t1 = 100 * INTERVAL;

    v.setDataStart(t1);
    v.setDataEnd(t1);
    v.fitToData(t1, t1, CHART_WIDTH);
    completeAnimation(v);

    const fromBefore = v.visibleRange.from;
    const toBefore = v.visibleRange.to;

    appendTick(v, t1, t1);
    completeAnimation(v);

    expect(v.visibleRange.from).toBeCloseTo(fromBefore, -1);
    expect(v.visibleRange.to).toBeCloseTo(toBefore, -1);
  });

  it('grows the right edge as sparse points arrive while the left edge stays put', () => {
    const v = makeViewport();
    const t1 = 100 * INTERVAL;

    v.setDataStart(t1);
    v.setDataEnd(t1);
    v.fitToData(t1, t1, CHART_WIDTH);
    completeAnimation(v);

    const initialFrom = v.visibleRange.from;
    expect(initialFrom).toBeCloseTo(t1, -1);

    let last = t1;
    for (let i = 1; i <= 5; i++) {
      last = t1 + i * INTERVAL;
      appendTick(v, t1, last);
      completeAnimation(v);

      expect(v.visibleRange.from).toBeCloseTo(initialFrom, -1);
      expect(v.visibleRange.to).toBeCloseTo(last + RIGHT_INTERVALS * INTERVAL, -1);
    }
  });

  it('falls through to scrollToEnd once the data fills the viewport', () => {
    const v = makeViewport();
    const t1 = 100 * INTERVAL;

    v.setDataStart(t1);
    v.setDataEnd(t1);
    v.fitToData(t1, t1, CHART_WIDTH);
    completeAnimation(v);

    // Warm-up phase: viewport grows with each tick, left edge anchored at t1.
    for (let i = 1; i <= 20; i++) {
      appendTick(v, t1, t1 + i * INTERVAL);
      completeAnimation(v);
    }

    // The viewport's right edge is now well past t1 — at this point the next
    // ticks should still warm up. We force the boundary by draining many more
    // ticks until the predicate flips: dataFits stays true until something
    // outside changes the range. To exercise the streaming branch, simulate a
    // wider data span than the current viewport range by panning right
    // (shrinking the visible-from-data left margin via setRange).
    const before = v.visibleRange;
    const narrower: { from: number; to: number } = {
      from: before.to - 10 * INTERVAL,
      to: before.to,
    };
    v.setRange(narrower);

    expect(v.dataFitsCurrentViewport(CHART_WIDTH)).toBe(false);

    const next = (v.dataEnd as number) + INTERVAL;
    appendTick(v, t1, next);
    completeAnimation(v);

    // After the streaming branch kicks in, the right edge tracks the new tail
    // (with right padding), confirming `scrollToEnd` ran rather than refit.
    expect(v.visibleRange.to).toBeCloseTo(next + RIGHT_INTERVALS * INTERVAL, -1);
    // And the left edge has advanced (no longer anchored at t1).
    expect(v.visibleRange.from).toBeGreaterThan(t1);
  });

  it('does not steal a user-pan offset — predicate is false after panning', () => {
    const v = makeViewport();
    const t1 = 100 * INTERVAL;

    v.setDataStart(t1);
    v.setDataEnd(t1 + 5 * INTERVAL);
    v.fitToData(t1, t1 + 5 * INTERVAL, CHART_WIDTH);
    completeAnimation(v);

    // Simulate a user pan: shift the visible window left so the data tail sits
    // past the right edge. setRange disables autoScroll when the tail leaves
    // the window — but the warm-up predicate must independently report `false`
    // so that even with autoScroll re-enabled, the warm-up branch won't snap
    // the pan back to fit.
    const range = v.visibleRange.to - v.visibleRange.from;
    v.setRange({ from: v.visibleRange.from - 2 * INTERVAL, to: v.visibleRange.from - 2 * INTERVAL + range });

    expect(v.dataFitsCurrentViewport(CHART_WIDTH)).toBe(false);
  });
});
