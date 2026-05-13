/**
 * Auto-scroll follows the last data point: a pan that leaves the last point
 * on screen keeps auto-scroll active so streaming ticks continue to slide in,
 * and a pan that pushes the last point off screen opts out (history read).
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;

function primed(): Viewport {
  // Default right padding (3 intervals) leaves headroom past the last point —
  // small leftward pans keep the last point on screen, large ones push it off.
  const v = new Viewport();
  v.setDataInterval(INTERVAL);
  v.setDataStart(0);
  v.setDataEnd(100 * INTERVAL);
  v.fitToData(0, 100 * INTERVAL, { chartWidth: 800 });

  return v;
}

describe('Viewport pan auto-scroll policy', () => {
  it('keeps autoScroll true when the pan leaves the last point on screen', () => {
    const v = primed();
    expect(v.autoScroll).toBe(true);

    // Small leftward pan: dataEnd sits 3 intervals inside the right edge
    // (default padding). A 1-bar pan keeps it within the visible range.
    v.pan(-1 * INTERVAL, 800);

    const { from, to } = v.visibleRange;
    const dataEnd = 100 * INTERVAL;
    expect(dataEnd).toBeGreaterThanOrEqual(from);
    expect(dataEnd).toBeLessThanOrEqual(to);
    expect(v.autoScroll).toBe(true);
  });

  it('sets autoScroll false when the pan pushes the last point off screen', () => {
    const v = primed();
    // Large leftward pan — dataEnd falls below `to`, past the right edge.
    v.pan(-150 * INTERVAL, 800);

    const { to } = v.visibleRange;
    const dataEnd = 100 * INTERVAL;
    expect(dataEnd).toBeGreaterThan(to);
    expect(v.autoScroll).toBe(false);
  });

  it('re-enables autoScroll when a subsequent pan brings the last point back into view', () => {
    const v = primed();
    v.pan(-150 * INTERVAL, 800); // send it off screen
    expect(v.autoScroll).toBe(false);

    // Pan right: pull the last point back onto the canvas. Default right
    // padding has headroom, so overshooting the dataEnd a little is fine.
    v.pan(200 * INTERVAL, 800);

    const { from, to } = v.visibleRange;
    const dataEnd = 100 * INTERVAL;
    expect(dataEnd).toBeGreaterThanOrEqual(from);
    expect(dataEnd).toBeLessThanOrEqual(to);
    expect(v.autoScroll).toBe(true);
  });
});
