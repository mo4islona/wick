/**
 * Pan-offset preservation across streaming ticks.
 *
 * `computeStreamingTargetX` carries the gap between the current logical
 * right edge and `_prevDataEnd` forward into the next target — so a user
 * who panned a few bars left of the live tail keeps that offset as new
 * bars arrive, instead of being snapped back to the natural-pin position
 * every tick.
 *
 * Post Phase-2 step 2 the viewport no longer owns the X animator. These
 * tests assert the computed target shape; chart-level integration
 * (`chart-streaming-autoscroll.test.ts`) covers the end-to-end pinning
 * once the engine eases the visual.
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

describe('Viewport computeStreamingTargetX pan-offset preservation', () => {
  it('pristine view: target pins the new dataEnd at to − rightPad (unchanged)', () => {
    const v = primed();
    const dataEndBefore = 100 * INTERVAL;
    // Sanity: fitToData placed logical right edge at dataEnd + 3 intervals.
    expect(v.logicalRange.to - dataEndBefore).toBe(3 * INTERVAL);

    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    const target = v.computeStreamingTargetX(newDataEnd, CHART_WIDTH);

    expect(target).not.toBeNull();
    expect(target!.to - newDataEnd).toBe(3 * INTERVAL);
  });

  it('after a pan that keeps the last point visible, target slides by delta (pan offset preserved)', () => {
    const v = primed();

    // Pan left by 1 interval — last point stays on screen (default right pad = 3).
    v.pan(-1 * INTERVAL, CHART_WIDTH);
    expect(v.autoScroll).toBe(true);

    const dataEndBefore = 100 * INTERVAL;
    const offsetAfterPan = v.logicalRange.to - dataEndBefore;
    expect(offsetAfterPan).toBe(2 * INTERVAL);

    // New streaming tick: dataEnd advances by 1 interval.
    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    const target = v.computeStreamingTargetX(newDataEnd, CHART_WIDTH);

    expect(target).not.toBeNull();
    // Pan offset (2 intervals) survives — target slid by dataEnd delta, not snapped to natural pin.
    expect(target!.to - newDataEnd).toBe(2 * INTERVAL);
  });

  it('repeated ticks after a pan continue to preserve the offset (no drift)', () => {
    const v = primed();
    v.pan(-2 * INTERVAL, CHART_WIDTH);
    expect(v.logicalRange.to - 100 * INTERVAL).toBe(1 * INTERVAL);

    for (let i = 1; i <= 5; i++) {
      const newDataEnd = (100 + i) * INTERVAL;
      v.setDataEnd(newDataEnd);
      const target = v.computeStreamingTargetX(newDataEnd, CHART_WIDTH);
      expect(target).not.toBeNull();
      expect(target!.to - newDataEnd).toBe(1 * INTERVAL);
      // Push the chart-side commit so the next iteration's logical reflects it.
      v.setRange(target!);
    }
  });
});
