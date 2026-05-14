/**
 * Lockstep-arrival suite for {@link AnimationEngine}. A single event whose
 * `targets` populates multiple slot types (y, x, alpha, tickFade) must hit
 * every target on the same frame — that's the visual contract that keeps
 * a legend-toggle's alpha cross-fade synchronized with the Y reflow and the
 * axis tick fade. Likewise, when two events share a duration on disjoint
 * slots they run in parallel; with different durations on disjoint slots
 * each settles on its own deadline without dragging the other.
 *
 * The `animating` flag is the natural single source of truth — these tests
 * pin it down to `false` only after EVERY slot under the event has reached
 * its target.
 */
import { describe, expect, it } from 'vitest';

import { settle, setup } from './test-utils';

describe('AnimationEngine — lockstep arrival', () => {
  // ---------------------------------------------------------------------------
  // Multi-target single event — all slots arrive on the same frame
  // ---------------------------------------------------------------------------

  it('one event with y/x/alpha/tickFade targets settles every slot on the duration deadline', () => {
    const { engine, transition } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'visibility',
      duration: 250,
      startWall: 0,
      targets: {
        y: { target: { min: 0, max: 1000 } },
        x: { target: { from: 0, to: 5000 } },
        alpha: [{ key: 's', target: 0 }],
        tickFade: { entering: [100, 200], exiting: [] },
      },
    });

    const settled = settle(engine, 250);

    // y: transition.retarget is called once, tracked transition snaps to target.
    expect(transition.retargetCalls).toHaveLength(1);
    expect(transition.retargetCalls[0].value).toEqual({ min: 0, max: 1000 });
    expect(settled.yRange).toEqual({ min: 0, max: 1000 });

    // x: settled to end of curve.
    expect(settled.xRange.to).toBeCloseTo(5000, 4);

    // alpha: 1 → 0.
    expect(settled.seriesAlpha.get('s')).toBeCloseTo(0, 4);

    // tickFade: both entering values at 1.
    expect(settled.tickOpacity.get(100)).toBeCloseTo(1, 4);
    expect(settled.tickOpacity.get(200)).toBeCloseTo(1, 4);
  });

  // ---------------------------------------------------------------------------
  // animating flag — clears only when every slot has settled
  // ---------------------------------------------------------------------------

  it('animating stays true until every slot of a multi-target event has converged', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'visibility',
      duration: 250,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 5000 } },
        alpha: [
          { key: 'a', target: 0 },
          { key: 'b', target: 0.5 },
        ],
      },
    });

    // Sample inside the duration window — animating must be true.
    const mid = settle(engine, 120);
    expect(mid.animating).toBe(true);

    // Past the deadline and one frame further (strict-`>` prune).
    settle(engine, 250);
    const past = engine.tick(272);
    expect(past.animating).toBe(false);
    expect(past.xRange.to).toBeCloseTo(5000, 4);
    expect(past.seriesAlpha.get('a')).toBeCloseTo(0, 4);
    expect(past.seriesAlpha.get('b')).toBeCloseTo(0.5, 4);
  });

  // ---------------------------------------------------------------------------
  // Multi-event same duration — disjoint slots run in parallel
  // ---------------------------------------------------------------------------

  it('two events with the same duration on disjoint slots settle on the same frame', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    engine.emit({
      kind: 'visibility',
      duration: 200,
      startWall: 0,
      targets: { alpha: [{ key: 'fade', target: 0 }] },
    });

    // Mid-flight — both still in motion.
    const mid = settle(engine, 100);
    expect(mid.xRange.to).toBeGreaterThan(0);
    expect(mid.xRange.to).toBeLessThan(1000);
    expect(mid.seriesAlpha.get('fade')).toBeGreaterThan(0);
    expect(mid.seriesAlpha.get('fade')).toBeLessThan(1);

    // At the shared deadline both arrive at target.
    const settled = settle(engine, 200, 100);
    expect(settled.xRange.to).toBeCloseTo(1000, 4);
    expect(settled.seriesAlpha.get('fade')).toBeCloseTo(0, 4);
  });

  // ---------------------------------------------------------------------------
  // Multi-event different durations — disjoint slots settle independently
  // ---------------------------------------------------------------------------

  it('disjoint slots with different durations settle on their own deadlines independently', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Short event on X.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    // Long event on alpha.
    engine.emit({
      kind: 'visibility',
      duration: 400,
      startWall: 0,
      targets: { alpha: [{ key: 'fade', target: 0 }] },
    });

    // After 100 ms: X already settled, alpha mid-flight.
    const phase1 = settle(engine, 100);
    expect(phase1.xRange.to).toBeCloseTo(1000, 4);
    expect(phase1.seriesAlpha.get('fade')).toBeGreaterThan(0);
    expect(phase1.seriesAlpha.get('fade')).toBeLessThan(1);
    expect(phase1.animating).toBe(true);

    // After 400 ms: alpha settled too.
    settle(engine, 400, 100);
    const past = engine.tick(420);
    expect(past.seriesAlpha.get('fade')).toBeCloseTo(0, 4);
    expect(past.animating).toBe(false);
  });
});
