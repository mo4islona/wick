/**
 * Critically-damped spring tracking a VisibleRange. The previous X animator
 * (linear ease with per-call duration) restarted its curve on every
 * setTarget, leaking a velocity step into mid-flight retargets. The spring
 * carries velocity over so wheel-zoom sequences feel continuous and stream
 * bursts don't jump.
 *
 * Tests supply settle times via `retarget(value, { expandMs })` since the
 * curve carries no baseline — the engine is the source of truth for the
 * per-call settle.
 */
import { describe, expect, it } from 'vitest';

import { VisibleRangeSpring } from '../../animation/visible-range-spring';

describe('VisibleRangeSpring', () => {
  it('starts at initial and is settled', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });
    expect(spring.current).toEqual({ from: 0, to: 100 });
    expect(spring.target).toEqual({ from: 0, to: 100 });
    expect(spring.animating).toBe(false);
  });

  it('retarget sets target without immediately moving current', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    spring.retarget({ from: 50, to: 150 }, { now: 0, expandMs: 200 });
    expect(spring.target).toEqual({ from: 50, to: 150 });
    // First retarget after construction primes #t0; current sampled later.
    spring.tick(0);
    expect(spring.current).toEqual({ from: 0, to: 100 });
  });

  it('tick advances toward target over the supplied settle time', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    spring.retarget({ from: 100, to: 200 }, { now: 0, expandMs: 200 });

    spring.tick(0);
    const initial = spring.current;
    expect(initial.from).toBe(0);

    spring.tick(100);
    const midway = spring.current;
    expect(midway.from).toBeGreaterThan(0);
    expect(midway.from).toBeLessThan(100);

    // After ~5x settleMs, well past 99% (decay = exp(-23) ≈ 1e-10).
    spring.tick(1000);
    expect(spring.current.from).toBeCloseTo(100, 1);
    expect(spring.current.to).toBeCloseTo(200, 1);
  });

  it('snap lands instantly with zero velocity', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    spring.snap({ from: 500, to: 600 }, { now: 0 });

    expect(spring.current).toEqual({ from: 500, to: 600 });
    expect(spring.target).toEqual({ from: 500, to: 600 });
    expect(spring.animating).toBe(false);
  });

  it('mid-flight retarget carries velocity over (no curve restart)', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    // First retarget — start motion toward 100→200.
    spring.retarget({ from: 100, to: 200 }, { now: 0, expandMs: 200 });
    spring.tick(0);

    // Halfway through the settle window, velocity is at its peak.
    spring.tick(80);
    const mid = spring.current;
    expect(mid.from).toBeGreaterThan(0);
    expect(mid.from).toBeLessThan(100);

    // Retarget to a NEW target while moving. With Animator+linear, this
    // would restart the curve from `mid` with `(newTarget − mid)/duration`
    // velocity (a discontinuity). With the spring, the carried velocity
    // continues to act on the new target.
    spring.retarget({ from: 110, to: 210 }, { now: 80, expandMs: 200 });

    // One more frame — current should now be moving toward the NEW target
    // but starting from where it was, not from 0 (curve was not restarted).
    spring.tick(96);
    expect(spring.current.from).toBeGreaterThan(mid.from);
  });

  it('continuous retargets converge to the final target after enough idle', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    // Burst of 10 retargets at 5ms apart, each advancing by 10 units.
    for (let i = 1; i <= 10; i++) {
      spring.retarget({ from: i * 10, to: i * 10 + 100 }, { now: i * 5, expandMs: 100 });
      spring.tick(i * 5);
    }

    // Settle.
    spring.tick(5000);
    expect(spring.current.from).toBeCloseTo(100, 1);
    expect(spring.current.to).toBeCloseTo(200, 1);
  });

  it('from and to springs run independently at the same frequency', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    // Target stretches only the right side.
    spring.retarget({ from: 0, to: 300 }, { now: 0, expandMs: 200 });
    spring.tick(0);
    spring.tick(100);

    // After the same elapsed time, the side that's chasing further has
    // moved further in absolute terms, but proportional progress should be
    // similar — same omega per side.
    const toProgress = (spring.current.to - 100) / (300 - 100);
    expect(spring.current.from).toBe(0); // from-side has no work to do.
    expect(toProgress).toBeGreaterThan(0);
    expect(toProgress).toBeLessThan(1);
  });

  it('animating flag flips to false when settled within eps', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    spring.retarget({ from: 10, to: 110 }, { now: 0, expandMs: 100 });
    spring.tick(0);
    expect(spring.animating).toBe(true);

    // Past 5x settleMs, eps + velocity threshold should be cleared.
    spring.tick(1000);
    expect(spring.animating).toBe(false);
    expect(spring.current).toEqual({ from: 10, to: 110 });
  });

  it('snap mid-flight zeros velocity', () => {
    const spring = new VisibleRangeSpring({ initial: { from: 0, to: 100 } });

    spring.retarget({ from: 200, to: 300 }, { now: 0, expandMs: 200 });
    spring.tick(80);
    expect(spring.animating).toBe(true);

    spring.snap({ from: 500, to: 600 }, { now: 80 });
    expect(spring.animating).toBe(false);

    // No drift after snap; tick is a no-op once settled.
    spring.tick(200);
    expect(spring.current).toEqual({ from: 500, to: 600 });
  });
});
