/**
 * Regression for "panned, then stream tick snaps me back to the live tail".
 *
 * The autoScroll policy now lets small pans keep tracking enabled so new data
 * continues to slide in (task #12). But the old `scrollToEnd` pinned the right
 * edge to `lastTime + rightPad` every tick, which *undid* the pan. The fix:
 * `scrollToEnd` slides the viewport by `lastTime - prevDataEnd` so the user's
 * offset from the live tail is preserved across ticks.
 *
 * "Pristine" tracking (user never panned) is unchanged — sliding from a
 * natural-pin position produces the same result as re-pinning.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;

function primed(): Viewport {
  const v = new Viewport();
  v.setDataInterval(INTERVAL);
  v.setDataStart(0);
  v.setDataEnd(100 * INTERVAL);
  v.fitToData(0, 100 * INTERVAL, { chartWidth: 800 });

  return v;
}

describe('Viewport scrollToEnd preserves pan offset', () => {
  it('pristine view: scrollToEnd pins the new dataEnd at to - rightPad (unchanged)', () => {
    const v = primed();
    const toBefore = v.visibleRange.to;
    const dataEndBefore = 100 * INTERVAL;
    // Sanity: fitToData placed right edge exactly at dataEnd + 3 intervals (default right pad).
    expect(toBefore - dataEndBefore).toBe(3 * INTERVAL);

    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    v.scrollToEnd(newDataEnd, 800);

    // scrollToEnd uses an animation when idle — read the target, not the
    // mid-animation visible range. Tick once to complete the tween.
    v.tick(performance.now() + 10_000);

    expect(v.visibleRange.to - newDataEnd).toBe(3 * INTERVAL);
  });

  it('after a pan that keeps the last point visible, scrollToEnd slides by delta (pan offset preserved)', () => {
    const v = primed();

    // Pan left by 1 interval — last point stays on screen (default right pad = 3).
    v.pan(-1 * INTERVAL, 800);
    expect(v.autoScroll).toBe(true); // established by task #12

    const toAfterPan = v.visibleRange.to;
    const dataEndBefore = 100 * INTERVAL;
    const offsetAfterPan = toAfterPan - dataEndBefore;
    // Pan narrowed the right gap by exactly 1 interval (from 3 to 2).
    expect(offsetAfterPan).toBe(2 * INTERVAL);

    // New streaming tick: dataEnd advances by 1 interval.
    const newDataEnd = 101 * INTERVAL;
    v.setDataEnd(newDataEnd);
    v.scrollToEnd(newDataEnd, 800);
    v.tick(performance.now() + 10_000);

    // The pan offset (dataEnd sits 2 intervals short of the right edge) must
    // survive — the view slid by exactly the dataEnd delta, not snapped to
    // the natural-pin position.
    expect(v.visibleRange.to - newDataEnd).toBe(2 * INTERVAL);
  });

  it('repeated streaming ticks after a pan continue to preserve the offset (no drift)', () => {
    const v = primed();
    v.pan(-2 * INTERVAL, 800);
    const offsetAfterPan = v.visibleRange.to - 100 * INTERVAL;
    expect(offsetAfterPan).toBe(1 * INTERVAL);

    for (let i = 1; i <= 5; i++) {
      const newDataEnd = (100 + i) * INTERVAL;
      v.setDataEnd(newDataEnd);
      v.scrollToEnd(newDataEnd, 800);
      v.tick(performance.now() + 10_000);
      expect(v.visibleRange.to - newDataEnd).toBe(1 * INTERVAL);
    }
  });
});
