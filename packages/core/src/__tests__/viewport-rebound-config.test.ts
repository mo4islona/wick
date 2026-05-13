/**
 * `reboundMs` plumbing — verifies the chart-level option reaches the viewport
 * and changes the duration (or disables) the snap-back animation.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000;

describe('Viewport rebound configuration', () => {
  function prime(v: Viewport): void {
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(100 * INTERVAL);
    v.fitToData(0, 100 * INTERVAL, { chartWidth: 800 });
  }

  it('reboundMs = 0 snaps the range instantly (no animation)', () => {
    const v = new Viewport({ padding: { right: { intervals: 0 }, left: { intervals: 0 } }, reboundMs: 0 });
    prime(v);
    // Pan past the right edge to force an overshoot.
    v.pan(50 * INTERVAL, 800);
    v.startRebound(800);
    expect(v.animating).toBe(false);
  });

  it('reboundMs > 0 enters the animating state after startRebound', () => {
    const v = new Viewport({ padding: { right: { intervals: 0 }, left: { intervals: 0 } }, reboundMs: 400 });
    prime(v);
    v.pan(50 * INTERVAL, 800);
    v.startRebound(800);
    expect(v.animating).toBe(true);
  });

  it('setReboundMs updates the duration for subsequent rebounds', () => {
    const v = new Viewport({ padding: { right: { intervals: 0 }, left: { intervals: 0 } }, reboundMs: 400 });
    prime(v);
    v.setReboundMs(0);
    v.pan(50 * INTERVAL, 800);
    v.startRebound(800);
    expect(v.animating).toBe(false);
  });
});
