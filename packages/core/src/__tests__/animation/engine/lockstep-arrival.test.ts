/**
 * Lockstep-arrival suite for {@link AnimationEngine}. The engine carries
 * only X / Y slots; these tests pin parallel and same-duration settlement
 * on X+Y, which is what the chart's streaming retarget relies on.
 */
import { describe, expect, it } from 'vitest';

import { settle, setup } from './test-utils';

describe('AnimationEngine — lockstep arrival', () => {
  it('one event with y/x targets settles every slot on the duration deadline', () => {
    const { engine, transition } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'visibility',
      duration: 250,
      startWall: 0,
      targets: {
        y: { target: { min: 0, max: 1000 } },
        x: { target: { from: 0, to: 5000 } },
      },
    });

    const settled = settle(engine, 250);

    expect(transition.retargetCalls).toHaveLength(1);
    expect(transition.retargetCalls[0].value).toEqual({ min: 0, max: 1000 });
    expect(settled.yRange).toEqual({ min: 0, max: 1000 });
    expect(settled.xRange.to).toBeCloseTo(5000, 4);
  });

  it('animating stays true until both X and Y of a multi-target event have converged', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'visibility',
      duration: 250,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 5000 } },
        y: { target: { min: 0, max: 10 } },
      },
    });

    const mid = settle(engine, 120);
    expect(mid.animating).toBe(true);

    settle(engine, 250);
    const past = engine.tick(272);
    expect(past.animating).toBe(false);
    expect(past.xRange.to).toBeCloseTo(5000, 4);
  });

  it('two events with the same duration on disjoint X / Y slots settle on the same frame', () => {
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
      targets: { y: { target: { min: 0, max: 50 } } },
    });

    const mid = settle(engine, 100);
    expect(mid.xRange.to).toBeGreaterThan(0);
    expect(mid.xRange.to).toBeLessThan(1000);

    const settled = settle(engine, 200, 100);
    expect(settled.xRange.to).toBeCloseTo(1000, 4);
  });

  it('disjoint slots with different durations settle on their own deadlines independently', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    engine.emit({
      kind: 'visibility',
      duration: 400,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 50 } } },
    });

    const phase1 = settle(engine, 100);
    expect(phase1.xRange.to).toBeCloseTo(1000, 4);
    expect(phase1.animating).toBe(true);

    settle(engine, 400, 100);
    const past = engine.tick(420);
    expect(past.animating).toBe(false);
  });
});
