import { describe, expect, it } from 'vitest';

import { AxisTickTracker, computeTickFadeDiff } from '../tick-tracker';

const EMPTY: ReadonlyMap<number, number> = new Map();

describe('AxisTickTracker — passive holder', () => {
  it('starts empty', () => {
    const t = new AxisTickTracker();
    expect(t.getCurrentTicks()).toEqual([]);
    expect(t.getPreviousTicks()).toEqual([]);
    expect(t.snapshot(EMPTY).entries).toEqual([]);
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

describe('AxisTickTracker — snapshot(tickOpacity) joins tracker with engine state', () => {
  it('current ticks default to opacity 1 when the engine has no entry yet', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([10, 20, 30]);
    const snap = t.snapshot(EMPTY);
    expect(snap.entries).toEqual([
      { value: 10, opacity: 1 },
      { value: 20, opacity: 1 },
      { value: 30, opacity: 1 },
    ]);
    expect(snap.isAnimating).toBe(false);
  });

  it('current-tick opacity is sourced from the engine map when set', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([10, 20]);
    const op = new Map<number, number>([
      [10, 0.4],
      [20, 0.8],
    ]);
    const snap = t.snapshot(op);
    expect(snap.entries).toEqual([
      { value: 10, opacity: 0.4 },
      { value: 20, opacity: 0.8 },
    ]);
    expect(snap.isAnimating).toBe(true);
  });

  it('previous-only ticks surface only when the engine still holds a non-zero opacity', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([10, 20]);
    t.setCurrentTicks([20, 30]); // 10 exited
    const op = new Map<number, number>([[10, 0.3]]);
    const snap = t.snapshot(op);
    // 20 + 30 from current (default 1.0), 10 from previous at 0.3.
    const sorted = [...snap.entries].sort((a, b) => a.value - b.value);
    expect(sorted).toEqual([
      { value: 10, opacity: 0.3 },
      { value: 20, opacity: 1 },
      { value: 30, opacity: 1 },
    ]);
    expect(snap.isAnimating).toBe(true);
  });

  it('previous-only ticks are dropped when their opacity has reached 0', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([10]);
    t.setCurrentTicks([20]); // 10 exited
    const snap = t.snapshot(new Map<number, number>([[10, 0]]));
    expect(snap.entries).toEqual([{ value: 20, opacity: 1 }]);
  });

  it('isAnimating=false once every current tick is at full opacity and no fading previous remain', () => {
    const t = new AxisTickTracker();
    t.setCurrentTicks([10]);
    t.setCurrentTicks([20]); // 10 exited, fully drained
    const snap = t.snapshot(new Map<number, number>([[20, 1]]));
    expect(snap.entries).toEqual([{ value: 20, opacity: 1 }]);
    expect(snap.isAnimating).toBe(false);
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
