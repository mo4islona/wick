/**
 * Contract suite for the Animator primitive.
 *
 * The animator is the foundation for the unified animation architecture
 * (viewport X-range, Y-range, series live-track will all migrate to it).
 * The contract pinned here is what every consumer relies on; breaking any of
 * these tests breaks every animated transition in the chart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Animator } from '../../animation/animator';
import { type Easing, easeLinear } from '../../animation/easing';

const numLerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Range {
  from: number;
  to: number;
}
const rangeLerp = (a: Range, b: Range, t: number): Range => ({
  from: a.from + (b.from - a.from) * t,
  to: a.to + (b.to - a.to) * t,
});
const rangeEquals = (a: Range, b: Range): boolean => a.from === b.from && a.to === b.to;

describe('Animator', () => {
  let now = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    now = 0;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  describe('initial state', () => {
    it('starts at the initial value, not animating, with target equal to current', () => {
      const a = new Animator<number>({ initial: 10, duration: 100, lerp: numLerp });

      expect(a.current).toBe(10);
      expect(a.target).toBe(10);
      expect(a.animating).toBe(false);
    });

    it('tick is a no-op when no target has been set', () => {
      const a = new Animator<number>({ initial: 10, duration: 100, lerp: numLerp });

      expect(a.tick(50)).toBe(false);
      expect(a.current).toBe(10);
    });
  });

  describe('snap', () => {
    it('jumps to the value with no animation', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      a.snap(42);

      expect(a.current).toBe(42);
      expect(a.target).toBe(42);
      expect(a.animating).toBe(false);
    });

    it('cancels an in-flight animation', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      now = 0;
      a.setTarget(100);
      now = 30;
      a.tick(now);
      expect(a.animating).toBe(true);

      a.snap(7);

      expect(a.current).toBe(7);
      expect(a.animating).toBe(false);
      // Subsequent tick must not resurrect the prior animation.
      now = 60;
      expect(a.tick(now)).toBe(false);
      expect(a.current).toBe(7);
    });
  });

  describe('setTarget basic interpolation', () => {
    it('produces an eased trajectory from current → target over `duration`', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear, // linear easing keeps math obvious in assertions
        lerp: numLerp,
      });
      now = 1000;
      a.setTarget(100);

      now = 1025;
      expect(a.tick(now)).toBe(true);
      expect(a.current).toBeCloseTo(25, 5);

      now = 1050;
      expect(a.tick(now)).toBe(true);
      expect(a.current).toBeCloseTo(50, 5);

      now = 1100;
      expect(a.tick(now)).toBe(false);
      expect(a.current).toBe(100);
      expect(a.animating).toBe(false);
    });

    it('respects the easing curve (cubic ease-out by default)', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      now = 0;
      a.setTarget(100);
      now = 50;
      a.tick(now);

      // easeOutCubic(0.5) = 1 - 0.5^3 = 0.875 → current = 87.5
      expect(a.current).toBeCloseTo(87.5, 5);
    });

    it('honours a custom easing function', () => {
      const flat: Easing = (t) => (t < 0.5 ? 0 : 1);
      const a = new Animator<number>({ initial: 0, duration: 100, easing: flat, lerp: numLerp });
      now = 0;
      a.setTarget(100);

      now = 40;
      a.tick(now);
      expect(a.current).toBe(0);

      now = 60;
      a.tick(now);
      expect(a.current).toBe(100);
    });

    it('overrides the default duration when one is passed to setTarget', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 1000, // default — should be ignored
        easing: easeLinear,
        lerp: numLerp,
      });
      now = 0;
      a.setTarget(100, { duration: 50 });

      now = 25;
      a.tick(now);
      expect(a.current).toBeCloseTo(50, 5);

      now = 50;
      a.tick(now);
      expect(a.current).toBe(100);
      expect(a.animating).toBe(false);
    });

    it('settles cleanly when tick is called exactly at end-of-duration', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      now = 0;
      a.setTarget(100);

      now = 100;
      expect(a.tick(now)).toBe(false);
      expect(a.current).toBe(100);
      expect(a.animating).toBe(false);
    });

    it('settles to target if tick lands well past the duration', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      now = 0;
      a.setTarget(100);

      now = 99_999;
      expect(a.tick(now)).toBe(false);
      expect(a.current).toBe(100);
    });
  });

  describe('mid-animation retarget — visual continuity', () => {
    it('preserves current as the new from, so there is no visual jump', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear,
        lerp: numLerp,
      });
      now = 0;
      a.setTarget(100);

      // Halfway: current = 50.
      now = 50;
      a.tick(now);
      expect(a.current).toBe(50);

      // Retarget mid-flight to a new destination.
      a.setTarget(200);

      // Animator must have advanced current to 50 (it did) and started a fresh
      // ease from there. The very next tick at the same `now` must still read 50
      // (zero elapsed against the new animation), proving no visual jump.
      expect(a.current).toBe(50);
      expect(a.animating).toBe(true);
      expect(a.target).toBe(200);

      // Half of the new duration must put us at the midpoint between 50 and 200.
      now += 50;
      a.tick(now);
      expect(a.current).toBeCloseTo(125, 5);

      // Settle.
      now += 50;
      a.tick(now);
      expect(a.current).toBe(200);
    });

    it('retargets correctly without an intervening tick (advances current internally)', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear,
        lerp: numLerp,
      });
      now = 0;
      a.setTarget(100);

      // Skip the intervening tick: jump the clock to 50ms and retarget.
      // The animator must still place `current` at 50 internally before
      // assigning it as the new `from`.
      now = 50;
      a.setTarget(200);

      expect(a.current).toBe(50);

      now = 100;
      a.tick(now);
      expect(a.current).toBeCloseTo(125, 5);
    });

    it('repeated retargets do not accumulate drift past the latest target', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear,
        lerp: numLerp,
      });
      now = 0;
      a.setTarget(100);

      // Stream of retargets at 10ms intervals — each pushes the target forward
      // by 10. Final target after 5 retargets: 150.
      let target = 100;
      for (let i = 0; i < 5; i++) {
        now += 10;
        target += 10;
        a.setTarget(target);
      }

      // Run plenty of frames and confirm we converge to the latest target.
      for (let i = 0; i < 20; i++) {
        now += 16;
        a.tick(now);
      }

      expect(a.current).toBe(150);
      expect(a.target).toBe(150);
      expect(a.animating).toBe(false);
    });
  });

  describe('no-op short-circuits', () => {
    it('setTarget(value) when current already equals value is a no-op', () => {
      const a = new Animator<number>({ initial: 42, duration: 100, lerp: numLerp });
      now = 0;
      a.setTarget(42);

      expect(a.animating).toBe(false);
      expect(a.current).toBe(42);
    });

    it('setTarget(target) mid-flight does not restart the animation', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear,
        lerp: numLerp,
      });
      now = 0;
      a.setTarget(100);

      // Halfway through: current = 50.
      now = 50;
      a.tick(now);
      expect(a.current).toBe(50);

      // Re-setting to the same target must not reset start time and re-ease
      // from 50; the existing animation must complete on schedule.
      a.setTarget(100);

      now = 100;
      expect(a.tick(now)).toBe(false);
      expect(a.current).toBe(100);
    });

    it('uses the supplied equals function for composite types', () => {
      const a = new Animator<Range>({
        initial: { from: 0, to: 10 },
        duration: 100,
        lerp: rangeLerp,
        equals: rangeEquals,
        easing: easeLinear,
      });
      now = 0;
      a.setTarget({ from: 0, to: 20 });
      now = 50;
      a.tick(now);

      const sameTarget = { from: 0, to: 20 }; // structurally equal — different reference
      a.setTarget(sameTarget);

      // Without rangeEquals, setTarget would have restarted the animation from
      // the current position; with it, the animation continues unchanged.
      now = 100;
      a.tick(now);
      expect(a.current.to).toBe(20);
    });
  });

  describe('duration: 0', () => {
    it('snaps when duration is zero', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      a.setTarget(50, { duration: 0 });

      expect(a.current).toBe(50);
      expect(a.animating).toBe(false);
    });

    it('snaps when duration is negative', () => {
      const a = new Animator<number>({ initial: 0, duration: 100, lerp: numLerp });
      a.setTarget(50, { duration: -10 });

      expect(a.current).toBe(50);
      expect(a.animating).toBe(false);
    });
  });

  describe('composite types (range)', () => {
    it('interpolates each field of a {from, to} range', () => {
      const a = new Animator<Range>({
        initial: { from: 0, to: 100 },
        duration: 100,
        easing: easeLinear,
        lerp: rangeLerp,
        equals: rangeEquals,
      });
      now = 0;
      a.setTarget({ from: 50, to: 200 });

      now = 50;
      a.tick(now);
      expect(a.current.from).toBeCloseTo(25, 5);
      expect(a.current.to).toBeCloseTo(150, 5);

      now = 100;
      a.tick(now);
      expect(a.current).toEqual({ from: 50, to: 200 });
    });
  });

  describe('explicit `now` parameter (deterministic without performance.now mock)', () => {
    it('uses opts.now as the start time when provided', () => {
      // Restore the spy: this test must work with real performance.now untouched.
      nowSpy.mockRestore();

      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear,
        lerp: numLerp,
      });
      a.setTarget(100, { now: 1_000 });

      expect(a.tick(1_050)).toBe(true);
      expect(a.current).toBeCloseTo(50, 5);

      expect(a.tick(1_100)).toBe(false);
      expect(a.current).toBe(100);

      // Re-install the spy for the remaining suite (afterEach restores it).
      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });

    it('mid-flight retarget with opts.now advances current to that time, not performance.now()', () => {
      nowSpy.mockRestore();

      const a = new Animator<number>({
        initial: 0,
        duration: 100,
        easing: easeLinear,
        lerp: numLerp,
      });
      a.setTarget(100, { now: 0 });

      // Retarget halfway via explicit now — current must read 50 at that
      // virtual time even though performance.now() is unrelated.
      a.setTarget(200, { now: 50 });

      expect(a.current).toBe(50);

      expect(a.tick(100)).toBe(true);
      expect(a.current).toBeCloseTo(125, 5);

      expect(a.tick(150)).toBe(false);
      expect(a.current).toBe(200);

      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });

    it('opts.now and opts.duration compose', () => {
      nowSpy.mockRestore();

      const a = new Animator<number>({
        initial: 0,
        duration: 1_000,
        easing: easeLinear,
        lerp: numLerp,
      });
      a.setTarget(100, { now: 500, duration: 50 });

      expect(a.tick(525)).toBe(true);
      expect(a.current).toBeCloseTo(50, 5);

      expect(a.tick(550)).toBe(false);
      expect(a.current).toBe(100);

      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
  });

  describe('integration with shared 250ms baseline', () => {
    it('typical streaming retarget completes within 250 ms', () => {
      const a = new Animator<number>({
        initial: 0,
        duration: 250,
        lerp: numLerp,
      });
      now = 0;
      a.setTarget(100);

      now = 250;
      expect(a.tick(now)).toBe(false);
      expect(a.current).toBe(100);
    });
  });
});
