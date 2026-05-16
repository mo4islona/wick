/**
 * Zoom + streaming X target — clamp the preserved offset at `rightPad`.
 *
 * A zoom centered to the right of `dataEnd` leaves the right edge past
 * the natural-pin position. `computeStreamingTargetX` then sees a raw
 * offset > rightPad and must clamp to rightPad so streaming ticks pull
 * the viewport back toward the natural tail-track instead of locking the
 * overshoot in as a permanent offset (which would leave the live point
 * drifting off the left side as new data arrives).
 *
 * Post Phase-2 step 2: viewport no longer animates X. Tests assert the
 * pure helper output; chart-level visual easing is verified by
 * `chart-streaming-autoscroll.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;
const RIGHT_PAD = 3 * INTERVAL;

function primed(): Viewport {
  const v = new Viewport();
  v.setDataInterval(INTERVAL);
  v.setDataStart(0);
  v.setDataEnd(100 * INTERVAL);
  v.fitToData(0, 100 * INTERVAL, { chartWidth: CHART_WIDTH });

  return v;
}

describe('zoom + streaming X target', () => {
  it('zoom past dataEnd: offset clamps to rightPad on the next streaming tick', () => {
    const v = primed();

    // Zoom centered well past dataEnd — leaves logical.to past `dataEnd + rightPad`.
    v.zoomAt(150 * INTERVAL, 0.5, CHART_WIDTH);
    const overshootBefore = v.logicalRange.to - 100 * INTERVAL;
    expect(overshootBefore).toBeGreaterThan(RIGHT_PAD);

    // Streaming tick: target clamps the preserved offset at rightPad.
    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    const target = v.computeStreamingTargetX(newDataEnd, CHART_WIDTH);

    expect(target).not.toBeNull();
    expect(target!.to - newDataEnd).toBeLessThanOrEqual(RIGHT_PAD + 1);
    expect(target!.from).toBeLessThanOrEqual(newDataEnd);
    expect(target!.to).toBeGreaterThanOrEqual(newDataEnd);
  });

  it('pan-right past dataEnd: target offset clamps to rightPad (no residual lock-in)', () => {
    const v = primed();

    // Pan aggressively right — rubber-band clamps but viewport can still end
    // slightly past the natural pin. computeStreamingTargetX must pull back.
    v.pan(10 * INTERVAL, CHART_WIDTH);

    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    const target = v.computeStreamingTargetX(newDataEnd, CHART_WIDTH);

    expect(target).not.toBeNull();
    const offset = target!.to - newDataEnd;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(RIGHT_PAD + 1);
  });
});
