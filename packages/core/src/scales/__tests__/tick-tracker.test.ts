import { describe, expect, it } from 'vitest';

import { AxisTickTracker, computeTickFadeDiff } from '../tick-tracker';

describe('AxisTickTracker — self-managed fade', () => {
  it('starts empty', () => {
    const t = new AxisTickTracker();
    expect(t.getCurrentTicks()).toEqual([]);
    expect(t.getPreviousTicks()).toEqual([]);
    expect(t.snapshot().entries).toEqual([]);
    expect(t.isArmed).toBe(false);
  });

  it('setCurrentTicks shifts the previous slot when the array changes', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50, 100]);
    expect(t.getCurrentTicks()).toEqual([0, 50, 100]);
    expect(t.getPreviousTicks()).toEqual([]);

    t.setCurrentTicks([50, 100, 200]);
    expect(t.getCurrentTicks()).toEqual([50, 100, 200]);
    expect(t.getPreviousTicks()).toEqual([0, 50, 100]);
  });

  it('setCurrentTicks is idempotent on element-wise equal arrays', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50, 100]);
    t.setCurrentTicks([0, 50, 100]);
    // Previous stays empty — the chart's renderMain + each framework axis
    // component can call setCurrentTicks per render without colliding.
    expect(t.getPreviousTicks()).toEqual([]);
  });

  it('markArmed flips isArmed; reset clears the flag and both arrays', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([0, 50]);
    t.markArmed();
    expect(t.isArmed).toBe(true);

    t.reset();
    expect(t.isArmed).toBe(false);
    expect(t.getCurrentTicks()).toEqual([]);
    expect(t.getPreviousTicks()).toEqual([]);
  });
});

describe('AxisTickTracker — snapshot reflects owned animator state', () => {
  it('pre-armed: entering ticks snap to opacity 1 with no animation', () => {
    const t = new AxisTickTracker({ fadeMs: 250 });
    t.setCurrentTicks([10, 20, 30]);
    // No tick(now) needed — duration 0 settles inline.
    const snap = t.snapshot();
    expect(snap.entries).toEqual([
      { value: 10, opacity: 1 },
      { value: 20, opacity: 1 },
      { value: 30, opacity: 1 },
    ]);
    expect(snap.isAnimating).toBe(false);
  });

  it('armed: entering ticks ramp 0 → 1 over the configured fadeMs', () => {
    const t = new AxisTickTracker({ fadeMs: 100 });
    t.markArmed();
    t.setCurrentTicks([10, 20]);
    const start = performance.now();
    t.tick(start); // capture the start frame so the animator's `from` lands at 0.

    const midSnap = (() => {
      t.tick(start + 50);
      return t.snapshot();
    })();
    expect(midSnap.entries.length).toBe(2);
    for (const e of midSnap.entries) {
      expect(e.opacity).toBeGreaterThan(0);
      expect(e.opacity).toBeLessThan(1);
    }
    expect(midSnap.isAnimating).toBe(true);

    t.tick(start + 200);
    const settled = t.snapshot();
    for (const e of settled.entries) {
      expect(e.opacity).toBe(1);
    }
    expect(settled.isAnimating).toBe(false);
  });

  it('armed: dropping a tick fades it out and removes it once it hits 0', () => {
    const t = new AxisTickTracker({ fadeMs: 100 });
    t.markArmed();
    t.setCurrentTicks([10, 20]);
    t.tick(performance.now() + 200); // settle the entering animations.

    t.setCurrentTicks([20, 30]); // 10 fades out, 30 fades in.
    const start = performance.now();
    t.tick(start);

    t.tick(start + 50);
    const mid = t.snapshot();
    const ten = mid.entries.find((e) => e.value === 10);
    expect(ten).toBeDefined();
    expect(ten?.opacity).toBeGreaterThan(0);
    expect(ten?.opacity).toBeLessThan(1);

    t.tick(start + 200);
    const after = t.snapshot();
    // 10 must be fully gone, 20 + 30 settled at opacity 1.
    expect(after.entries.find((e) => e.value === 10)).toBeUndefined();
    expect(after.entries.find((e) => e.value === 20)?.opacity).toBe(1);
    expect(after.entries.find((e) => e.value === 30)?.opacity).toBe(1);
    expect(after.isAnimating).toBe(false);
  });

  it('setFadeMs reconfigures subsequent transitions without disturbing live ones', () => {
    const t = new AxisTickTracker({ fadeMs: 50 });
    t.markArmed();
    t.setFadeMs(500);
    t.setCurrentTicks([10]);
    const start = performance.now();
    t.tick(start);

    t.tick(start + 60);
    const snap = t.snapshot();
    // 60ms into a 500ms fade is well below the settled threshold.
    expect(snap.entries[0].opacity).toBeLessThan(1);
    expect(snap.isAnimating).toBe(true);
  });
});

describe('computeTickFadeDiff', () => {
  it('returns disjoint entering / exiting arrays for an unchanged set', () => {
    const diff = computeTickFadeDiff([0, 50, 100], [0, 50, 100]);
    expect(diff.entering).toEqual([]);
    expect(diff.exiting).toEqual([]);
  });

  it('classifies new values as entering', () => {
    const diff = computeTickFadeDiff([0, 50, 100, 200], [0, 50, 100]);
    expect(diff.entering).toEqual([200]);
    expect(diff.exiting).toEqual([]);
  });

  it('classifies dropped values as exiting', () => {
    const diff = computeTickFadeDiff([0, 50], [0, 50, 100]);
    expect(diff.entering).toEqual([]);
    expect(diff.exiting).toEqual([100]);
  });

  it('handles concurrent entering + exiting on a tick-set replacement', () => {
    const diff = computeTickFadeDiff([100, 200, 300], [0, 100, 200]);
    expect(diff.entering).toEqual([300]);
    expect(diff.exiting).toEqual([0]);
  });
});
