/**
 * Sub-threshold tick filter for streaming X.
 *
 * `computeStreamingTargetX` returns `null` on shifts below half-a-bar (or
 * 4 px in time units, whichever is smaller). The legacy `scrollToEnd`
 * carried a subtler invariant: `_prevDataEnd` should only advance when the
 * helper actually returns a target — otherwise sub-threshold ticks
 * accumulate `_prevDataEnd` past the running animation and the offset math
 * eventually clamps to 0, silently snapping the viewport.
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

describe('computeStreamingTargetX sub-threshold guard', () => {
  it('preserves the pan offset across many sub-threshold (same lastTime) calls', () => {
    const v = primed();

    // Pan slightly left so the offset we care about is < rightPad.
    v.pan(-1 * INTERVAL, CHART_WIDTH);
    expect(v.logicalRange.to - 100 * INTERVAL).toBe(2 * INTERVAL);

    // Burst of updateLast-style calls on the SAME dataEnd — each returns null
    // (no target). _prevDataEnd must stay pinned at the value setDataEnd
    // recorded; otherwise the next real-tick call would compute against a
    // drifted baseline and clamp the offset to 0.
    for (let i = 0; i < 50; i++) {
      v.setDataEnd(100 * INTERVAL);
      expect(v.computeStreamingTargetX(100 * INTERVAL, CHART_WIDTH)).toBeNull();
    }

    // Real new bar — above threshold. The target must respect the original
    // pan offset (2 * INTERVAL), not a drifted one.
    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    const target = v.computeStreamingTargetX(newDataEnd, CHART_WIDTH);

    expect(target).not.toBeNull();
    expect(target!.to - newDataEnd).toBe(2 * INTERVAL);
    expect(target!.to - newDataEnd).toBeGreaterThan(0);
  });
});
