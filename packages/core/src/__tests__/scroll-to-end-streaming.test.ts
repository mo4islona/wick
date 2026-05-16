/**
 * Streaming-X target computation regression coverage.
 *
 * Post Phase-2 step 2 the X animator lives in {@link AnimationEngine}; the
 * viewport no longer owns `scrollToEnd` / `tick`. The legacy regression
 * suite exercised the chart-pinned right-edge contract via the viewport
 * directly. That end-to-end coverage now lives in
 * `chart-streaming-autoscroll.test.ts` (drives `chart.appendData`); these
 * tests pin the lower-level helper — {@link Viewport.computeStreamingTargetX} —
 * which encapsulates the offset preservation + sub-threshold filter the
 * old `scrollToEnd` baked in.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;
const RIGHT_PAD = 3 * INTERVAL;

function makeViewport(): Viewport {
  const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
  v.setDataInterval(INTERVAL);
  v.setDataStart(0);
  v.setDataEnd(100 * INTERVAL);
  v.fitToData(0, 100 * INTERVAL, { chartWidth: CHART_WIDTH });

  return v;
}

describe('Viewport.computeStreamingTargetX', () => {
  it('first call with no prior dataEnd lands the right edge at lastTime + rightPad', () => {
    const v = makeViewport();
    v.setDataEnd(101 * INTERVAL);
    const target = v.computeStreamingTargetX(101 * INTERVAL, CHART_WIDTH);

    expect(target).not.toBeNull();
    expect(target?.to).toBeCloseTo(101 * INTERVAL + RIGHT_PAD, -1);
  });

  it('preserves pan offset across successive ticks (slide-by-advance, not snap-to-tail)', () => {
    const v = makeViewport();
    // Simulate a user pan that left a 1-bar offset between viewport.right and dataEnd.
    const pannedTo = 100 * INTERVAL + 2 * INTERVAL; // offset = 2 bars right of dataEnd
    v.setRange({ from: pannedTo - 50 * INTERVAL, to: pannedTo });
    // Stream advances; computeStreamingTargetX preserves the offset.
    v.setDataEnd(101 * INTERVAL);
    const target = v.computeStreamingTargetX(101 * INTERVAL, CHART_WIDTH);

    expect(target).not.toBeNull();
    // Offset clamped to [0, rightPad]; here we panned 2 intervals past
    // dataEnd which is below rightPad (3 intervals) → preserved verbatim.
    // The math: rawOffset = anchorTo (logical.to = pannedTo)
    //         − _prevDataEnd (set by setDataEnd to 100*INTERVAL when fitToData seeded it).
    // anchorTo = 100*INTERVAL + 2*INTERVAL = 102*INTERVAL; rawOffset = 2*INTERVAL.
    expect(target?.to).toBeCloseTo(101 * INTERVAL + 2 * INTERVAL, -1);
  });

  it('sub-threshold delta returns null (updateLast bursts on the same bar)', () => {
    const v = makeViewport();
    v.setDataEnd(101 * INTERVAL);
    const first = v.computeStreamingTargetX(101 * INTERVAL, CHART_WIDTH);
    expect(first).not.toBeNull();
    // Same lastTime — pending delta = 0, below half-bar + 4-px thresholds.
    const second = v.computeStreamingTargetX(101 * INTERVAL, CHART_WIDTH);
    expect(second).toBeNull();
  });

  it('hold-until-filled returns null while the latest data still fits the warm-up window', () => {
    const v = makeViewport();
    // Seed a 50-bar warm-up window from time 0.
    v.setRangeHold({ from: 0, to: 50 * INTERVAL });
    // Append a bar that fits inside the window — hold still active.
    v.setDataEnd(40 * INTERVAL);
    expect(v.computeStreamingTargetX(40 * INTERVAL, CHART_WIDTH)).toBeNull();
    // Append past the right edge — hold releases, target produced.
    v.setDataEnd(50 * INTERVAL);
    const target = v.computeStreamingTargetX(50 * INTERVAL, CHART_WIDTH);
    expect(target).not.toBeNull();
  });
});
