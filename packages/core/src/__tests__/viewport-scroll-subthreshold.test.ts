/**
 * Issue 6 — `_prevDataEnd` used to be folded forward on every `scrollToEnd`
 * call, including the branches that early-return without retargeting the
 * animation (retarget-delta below threshold, or pending shift below
 * threshold). Sub-threshold streaming ticks therefore advanced
 * `_prevDataEnd` past the fixed animation target, eventually producing a
 * negative raw offset that clamped to 0 and snapped the viewport to bare
 * `dataEnd` — silently discarding the user's pan offset.
 *
 * Fix contract: `_prevDataEnd` advances only when the call actually
 * (re)targets the animation.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;

function primed(): Viewport {
  const v = new Viewport();
  v.setDataInterval(INTERVAL);
  v.setDataStart(0);
  v.setDataEnd(100 * INTERVAL);
  v.fitToData(0, 100 * INTERVAL, { chartWidth: CHART_WIDTH });
  return v;
}

describe('scrollToEnd does not drift on sub-threshold ticks', () => {
  it('preserves the pan offset across many sub-threshold (same lastTime) calls', () => {
    const v = primed();
    const rightPad = 3 * INTERVAL;

    // Pan slightly left so the offset we care about is < rightPad.
    v.pan(-1 * INTERVAL, CHART_WIDTH);
    const offsetAfterPan = v.visibleRange.to - 100 * INTERVAL;
    expect(offsetAfterPan).toBe(2 * INTERVAL);

    // A burst of updateLast-style calls on the SAME dataEnd — chart.ts emits
    // these as long as the last candle is still live. Each is below
    // scrollToEnd's pending threshold and returns early. Mirror the real
    // flow: `setDataEnd` is called before every `scrollToEnd`, even when
    // the value hasn't changed (store `updateLast` still emits).
    for (let i = 0; i < 50; i++) {
      v.setDataEnd(100 * INTERVAL);
      v.scrollToEnd(100 * INTERVAL, CHART_WIDTH);
    }

    // Now an actual new bar — above threshold. The slide must respect the
    // original pan offset (2 * INTERVAL), not a drifted one.
    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    v.scrollToEnd(newDataEnd, CHART_WIDTH);
    v.tick(performance.now() + 10_000);

    expect(v.visibleRange.to - newDataEnd).toBe(2 * INTERVAL);
    // And never less (clamp to 0 after drifting would manifest as 0).
    expect(v.visibleRange.to - newDataEnd).toBeGreaterThan(0);

    // Reference the unused assertion to keep lint happy.
    void rightPad;
  });

  it('preserves the pan offset when a real tick arrives mid-animation with a sub-threshold retarget', () => {
    const v = primed();

    v.pan(-1 * INTERVAL, CHART_WIDTH);

    // Start an animation toward the next dataEnd.
    let newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    v.scrollToEnd(newDataEnd, CHART_WIDTH);

    // Simulate many micro-ticks while the animation is in flight — each
    // advances dataEnd by an amount below the retarget threshold.
    const simBase = performance.now();
    for (let i = 0; i < 20; i++) {
      // Advance dataEnd by 1/20 of an interval each tick (sub-threshold).
      newDataEnd += INTERVAL / 20;
      v.setDataEnd(newDataEnd);
      v.scrollToEnd(newDataEnd, CHART_WIDTH);
      v.tick(simBase + i * 2);
    }

    // One final above-threshold tick.
    newDataEnd = 102 * INTERVAL;
    v.setDataEnd(newDataEnd);
    v.scrollToEnd(newDataEnd, CHART_WIDTH);
    v.tick(performance.now() + 10_000);

    // Pan offset (originally 2 * INTERVAL) must survive; the final gap must
    // stay in the `[0, rightPad]` band the clamp enforces — crucially, not 0.
    const finalOffset = v.visibleRange.to - newDataEnd;
    expect(finalOffset).toBeGreaterThan(0);
    expect(finalOffset).toBeLessThanOrEqual(3 * INTERVAL);
  });
});
