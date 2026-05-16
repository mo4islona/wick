/**
 * computeStreamingTarget — pure-function unit tests.
 *
 * Covers the cases the old viewport-level suites (`scroll-to-end-streaming`,
 * `viewport-scroll-pan-preserve`, `viewport-scroll-subthreshold`,
 * `viewport-zoom-scroll`'s streaming-target half) used to assert through
 * the now-deleted `Viewport.computeStreamingTargetX` wrapper:
 *
 * - First call lands the right edge at `lastTime + rightPad`.
 * - Pan offset is preserved across successive ticks (slide-by-advance, not snap-to-tail).
 * - Sub-threshold deltas (`updateLast` bursts on the same bar) return null.
 * - `holdUntilFilled` flag suppresses the slide until data fills the window.
 * - Zoom / pan past `dataEnd` clamps the preserved offset at `rightPad`.
 */
import { describe, expect, it } from 'vitest';

import type { VisibleRange } from '../../types';
import { computeStreamingTarget } from '../streaming-target';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;
const RIGHT_PAD_INTERVALS = 3;
const RIGHT_PAD = RIGHT_PAD_INTERVALS * INTERVAL;
const PADDING_RIGHT = { intervals: RIGHT_PAD_INTERVALS };

/** Mirrors the post-`fitToData` logical range: data [0, 100*INTERVAL] + 3-bar right pad. */
function primedLogical(): VisibleRange {
  return { from: 0, to: 100 * INTERVAL + RIGHT_PAD };
}

describe('computeStreamingTarget', () => {
  it('first call lands the right edge at lastTime + rightPad', () => {
    const result = computeStreamingTarget({
      currentLogical: primedLogical(),
      lastTime: 101 * INTERVAL,
      prevDataEnd: 100 * INTERVAL,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: false,
    });

    expect(result.newLogical).not.toBeNull();
    expect(result.newLogical?.to).toBeCloseTo(101 * INTERVAL + RIGHT_PAD, -1);
  });

  it('preserves pan offset across successive ticks (slide-by-advance, not snap)', () => {
    // Pan left by 1 interval: logical.to = data tail + 2 intervals (vs. natural 3).
    const panned: VisibleRange = { from: -49 * INTERVAL, to: 102 * INTERVAL };
    const result = computeStreamingTarget({
      currentLogical: panned,
      lastTime: 101 * INTERVAL,
      prevDataEnd: 100 * INTERVAL,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: false,
    });

    // anchorTo (102) − prevDataEnd (100) = 2, clamped to [0, rightPad=3], preserved.
    expect(result.newLogical).not.toBeNull();
    expect(result.newLogical!.to - 101 * INTERVAL).toBe(2 * INTERVAL);
  });

  it('repeated commits with chart-side prevDataEnd advance keep the offset constant', () => {
    // Pan by 2 intervals: logical.to = data tail + 1 interval.
    let logical: VisibleRange = { from: -49 * INTERVAL, to: 101 * INTERVAL };
    let prevDataEnd = 100 * INTERVAL;

    for (let i = 1; i <= 5; i++) {
      const newDataEnd = (100 + i) * INTERVAL;
      const result = computeStreamingTarget({
        currentLogical: logical,
        lastTime: newDataEnd,
        prevDataEnd,
        dataInterval: INTERVAL,
        paddingRight: PADDING_RIGHT,
        chartWidth: CHART_WIDTH,
        holdUntilFilled: false,
      });
      expect(result.newLogical).not.toBeNull();
      expect(result.newLogical!.to - newDataEnd).toBe(1 * INTERVAL);

      // Caller commits and advances prevDataEnd.
      logical = result.newLogical!;
      prevDataEnd = newDataEnd;
    }
  });

  it('sub-threshold delta on the same lastTime returns newLogical=null', () => {
    const logical = primedLogical();
    // First call accepts the shift.
    const first = computeStreamingTarget({
      currentLogical: logical,
      lastTime: 101 * INTERVAL,
      prevDataEnd: 100 * INTERVAL,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: false,
    });
    expect(first.newLogical).not.toBeNull();

    // After caller commits, a second call on the SAME lastTime is sub-threshold.
    const second = computeStreamingTarget({
      currentLogical: first.newLogical!,
      lastTime: 101 * INTERVAL,
      prevDataEnd: 101 * INTERVAL,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: false,
    });
    expect(second.newLogical).toBeNull();
  });

  it('sub-threshold ticks do not corrupt prevDataEnd: caller must keep prevDataEnd pinned', () => {
    // Pan slightly left: logical.to = data tail + 2 intervals.
    const logical: VisibleRange = { from: -49 * INTERVAL, to: 102 * INTERVAL };
    const prevDataEnd = 100 * INTERVAL;

    // 50 sub-threshold `updateLast`-style calls on the same dataEnd.
    for (let i = 0; i < 50; i++) {
      const result = computeStreamingTarget({
        currentLogical: logical,
        lastTime: 100 * INTERVAL,
        prevDataEnd,
        dataInterval: INTERVAL,
        paddingRight: PADDING_RIGHT,
        chartWidth: CHART_WIDTH,
        holdUntilFilled: false,
      });
      // sub-threshold → no commit, no prevDataEnd advance by caller.
      expect(result.newLogical).toBeNull();
    }

    // Real new bar — offset preserved (caller never advanced prevDataEnd).
    const newDataEnd = 101 * INTERVAL;
    const real = computeStreamingTarget({
      currentLogical: logical,
      lastTime: newDataEnd,
      prevDataEnd,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: false,
    });
    expect(real.newLogical).not.toBeNull();
    expect(real.newLogical!.to - newDataEnd).toBe(2 * INTERVAL);
  });

  it('holdUntilFilled returns null + reengageAutoScroll while data fits the warm-up window', () => {
    // Warm-up window from 0 to 50 * INTERVAL.
    const logical: VisibleRange = { from: 0, to: 50 * INTERVAL };
    const result = computeStreamingTarget({
      currentLogical: logical,
      lastTime: 40 * INTERVAL, // still inside the window
      prevDataEnd: null,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: true,
    });

    expect(result.newLogical).toBeNull();
    expect(result.reengageAutoScroll).toBe(true);
    expect(result.releaseHold).toBe(false);
  });

  it('holdUntilFilled releases + commits once data reaches the right edge', () => {
    const logical: VisibleRange = { from: 0, to: 50 * INTERVAL };
    const result = computeStreamingTarget({
      currentLogical: logical,
      lastTime: 50 * INTERVAL, // tail caught up
      prevDataEnd: null,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: true,
    });

    expect(result.newLogical).not.toBeNull();
    expect(result.releaseHold).toBe(true);
  });

  it('post-zoom past dataEnd: offset clamps to rightPad on the next streaming tick', () => {
    // Simulate logical post-zoom that left right-edge well past dataEnd + rightPad.
    const zoomed: VisibleRange = { from: 80 * INTERVAL, to: 130 * INTERVAL };
    const result = computeStreamingTarget({
      currentLogical: zoomed,
      lastTime: 101 * INTERVAL,
      prevDataEnd: 100 * INTERVAL,
      dataInterval: INTERVAL,
      paddingRight: PADDING_RIGHT,
      chartWidth: CHART_WIDTH,
      holdUntilFilled: false,
    });

    expect(result.newLogical).not.toBeNull();
    const offset = result.newLogical!.to - 101 * INTERVAL;
    // rawOffset = 130 − 100 = 30 intervals, clamped to [0, rightPad=3].
    expect(offset).toBeLessThanOrEqual(RIGHT_PAD + 1);
    expect(offset).toBeGreaterThanOrEqual(0);
  });
});
