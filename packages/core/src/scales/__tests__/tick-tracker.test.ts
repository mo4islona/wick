import { describe, expect, it } from 'vitest';

import { AxisTickTracker } from '../tick-tracker';

const OPACITIES = (t: AxisTickTracker): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const { value, opacity } of t.snapshot().entries) out[value] = opacity;

  return out;
};

describe('AxisTickTracker — snap (pre-arm) phase', () => {
  it('seeds the initial tick set at full opacity (no fade-in)', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50, 100]);

    expect(OPACITIES(t)).toEqual({ 0: 1, 50: 1, 100: 1 });
    expect(t.isArmed).toBe(false);
  });

  it('newcomers added while not armed snap to opacity 1', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50, 100]);
    t.setCurrentTicks([0, 50, 100, 200]);

    expect(OPACITIES(t)).toEqual({ 0: 1, 50: 1, 100: 1, 200: 1 });
  });

  it('departures drop immediately while not armed (no fade-out)', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50, 100]);
    t.setCurrentTicks([0, 50]);

    expect(OPACITIES(t)).toEqual({ 0: 1, 50: 1 });
  });
});

describe('AxisTickTracker — armed (fade) phase', () => {
  it('after markArmed, new ticks fade in from 0 and departures fade out from 1', () => {
    const t = new AxisTickTracker({ fadeMs: 200 });
    t.setCurrentTicks([0, 50, 100]);
    t.markArmed();

    t.setCurrentTicks([0, 200]); // 50 + 100 leaving; 200 arriving
    expect(OPACITIES(t)).toEqual({ 0: 1, 50: 1, 100: 1, 200: 0 });
  });

  it('tick(now) advances opacities linearly toward target and reports `moved`', () => {
    const t = new AxisTickTracker({ fadeMs: 200 });
    t.setCurrentTicks([0, 50]);
    t.markArmed();
    t.tick(0); // seed lastTickAt without advancing
    t.setCurrentTicks([0, 100]); // 50 fades out, 100 fades in

    const first = t.tick(100); // dt=100 ms, step=0.5
    expect(first.moved).toBe(true);
    expect(first.animating).toBe(true);
    expect(OPACITIES(t)).toEqual({ 0: 1, 50: 0.5, 100: 0.5 });

    const second = t.tick(220); // dt=120 ms, step=0.6 → settles
    expect(second.moved).toBe(true);
    expect(second.animating).toBe(false);
    // 50 fully faded out → pruned. 100 reached 1.
    expect(OPACITIES(t)).toEqual({ 0: 1, 100: 1 });
  });

  it('a large dt one-shots fade-in to 1 in a single step (moved=true, animating=false)', () => {
    const t = new AxisTickTracker({ fadeMs: 200 });
    t.setCurrentTicks([0]);
    t.markArmed();
    t.tick(0);
    t.setCurrentTicks([0, 100]);

    const r = t.tick(10_000);
    expect(r.moved).toBe(true);
    expect(r.animating).toBe(false);
    expect(OPACITIES(t)).toEqual({ 0: 1, 100: 1 });
  });

  it('fadeMs <= 0 makes every change snap (no animation), still reports `moved`', () => {
    const t = new AxisTickTracker({ fadeMs: 0 });
    t.setCurrentTicks([0]);
    t.markArmed();
    t.tick(0);
    t.setCurrentTicks([0, 100]);

    const r = t.tick(16);
    expect(r.animating).toBe(false);
    expect(r.moved).toBe(true);
    expect(OPACITIES(t)).toEqual({ 0: 1, 100: 1 });
  });
});

describe('AxisTickTracker — reset()', () => {
  it('clears state and disarms the tracker so the next paint snaps again', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50]);
    t.markArmed();
    expect(t.isArmed).toBe(true);

    t.reset();
    expect(t.isArmed).toBe(false);
    expect(t.snapshot().entries).toEqual([]);

    t.setCurrentTicks([10, 20]);
    expect(OPACITIES(t)).toEqual({ 10: 1, 20: 1 });
  });
});

describe('AxisTickTracker — snapshot()', () => {
  it('reports isAnimating=true while any entry is mid-fade', () => {
    const t = new AxisTickTracker({ fadeMs: 200 });
    t.setCurrentTicks([0]);
    t.markArmed();
    t.tick(0);
    t.setCurrentTicks([0, 100]);

    expect(t.snapshot().isAnimating).toBe(true);
  });

  it('reports isAnimating=false once every entry has reached its target', () => {
    const t = new AxisTickTracker({ fadeMs: 200 });
    t.setCurrentTicks([0]);
    t.markArmed();
    t.tick(0);
    t.setCurrentTicks([0, 100]);
    t.tick(500); // long enough to settle

    expect(t.snapshot().isAnimating).toBe(false);
  });
});
