/**
 * Regression for "zoom + stream leaves the pulse off screen".
 *
 * scrollToEnd preserves the user's offset from the live tail (task #13) so
 * small pans survive streaming ticks. But a zoom that leaves the viewport
 * past the natural-pin position (right edge to the right of `dataEnd + pr`)
 * would record a huge offset; subsequent ticks kept extending that offset
 * instead of pulling back, so `dataEnd` drifted off the left side of the
 * viewport — pulse rendered outside the visible band even though autoScroll
 * was still reporting true.
 *
 * Fix contract: the preserved offset is clamped at `rightPad` — pulling the
 * viewport back past the natural tail-track position is never desirable.
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

describe('zoom + scrollToEnd keep the last point on screen', () => {
  it('zoom-in centered to the right of dataEnd must not drift the view past the data on streaming ticks', () => {
    const v = primed();

    // Zoom in centered well past dataEnd — a realistic "wheel zoom on the
    // right-pad area" gesture. The zoom math pins nothing and leaves the
    // right edge past `dataEnd + rightPad`.
    v.zoomAt(150 * INTERVAL, 0.5, CHART_WIDTH);
    const dataEnd = 100 * INTERVAL;
    const rightPad = 3 * INTERVAL;

    // After a handful of streaming ticks, dataEnd must stay visible. The
    // natural tail-track position is `to - rightPad`; the viewport should
    // settle there instead of drifting further right each tick.
    for (let i = 1; i <= 5; i++) {
      const newDataEnd = (100 + i) * INTERVAL;
      v.setDataEnd(newDataEnd);
      v.scrollToEnd(newDataEnd, CHART_WIDTH);
      v.tick(performance.now() + 10_000);

      const { from, to } = v.visibleRange;
      expect(newDataEnd).toBeGreaterThanOrEqual(from);
      expect(newDataEnd).toBeLessThanOrEqual(to);
      // And the gap between the right edge and dataEnd must not exceed
      // the natural right-pad — otherwise pulse drifts left-of-center.
      expect(to - newDataEnd).toBeLessThanOrEqual(rightPad + 1);
    }

    // Sanity: after tracking stabilises the viewport sits at the natural pin.
    const finalDataEnd = 105 * INTERVAL;
    expect(v.visibleRange.to - finalDataEnd).toBeCloseTo(rightPad, -1);
    void dataEnd;
  });

  it('pan-right past dataEnd (rubber-banded) does not leave a residual offset larger than rightPad', () => {
    const v = primed();
    const rightPad = 3 * INTERVAL;

    // Pan aggressively right — rubber-band will clamp but the viewport can
    // still end up a little past the natural pin. A streaming tick must pull
    // back rather than lock that overshoot in as a permanent offset.
    v.pan(10 * INTERVAL, CHART_WIDTH);

    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    v.scrollToEnd(newDataEnd, CHART_WIDTH);
    v.tick(performance.now() + 10_000);

    const offset = v.visibleRange.to - newDataEnd;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(rightPad + 1);
  });
});
