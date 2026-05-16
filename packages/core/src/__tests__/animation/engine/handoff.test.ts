/**
 * Handoff suite for {@link AnimationEngine}: velocity continuity,
 * advance-before-freeze, no-resurrection via `droppedClaims`, t-clamp,
 * overshoot guard. The merge algorithm's correctness on the *transition*
 * between events is what keeps the chart visually smooth under preemption
 * (gesture vs data_tick) and at the lifetime boundaries of in-flight events
 * (one expires while another keeps running on the same slot).
 *
 * Most assertions hold the engine to the closed-form `easeOutCubic` curve —
 * `current(t) = from + easeOutCubic(t/dur) · (target − from)` — because that's
 * the contract a chart-side renderer reads from `state` each frame.
 */
import { describe, expect, it } from 'vitest';

import { easeOutCubic } from '../../../animation/easing';
import { settle, setup } from './test-utils';

describe('AnimationEngine — handoff', () => {
  // ---------------------------------------------------------------------------
  // Frozen `from`
  // ---------------------------------------------------------------------------

  it('keeps `from` frozen at activation value across the entire segment (X slot)', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'visibility',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 100 } } },
    });

    // X.to defaults to 0 → 100. current(t) = easeOutCubic(t/200) · 100.
    const samplesAt = [0, 48, 96, 144, 192];
    const observed: number[] = [];
    let lastT = 0;
    for (const t of samplesAt) {
      const state = t === 0 ? engine.tick(0) : settle(engine, t, lastT);
      observed.push(state.xRange.to);
      lastT = t;
    }

    for (let i = 0; i < samplesAt.length; i++) {
      const expected = easeOutCubic(samplesAt[i] / 200) * 100;
      expect(observed[i]).toBeCloseTo(expected, 4);
    }
  });

  // ---------------------------------------------------------------------------
  // No resurrection — losers stay disqualified for the slot they lost
  // ---------------------------------------------------------------------------

  it('older X event added to droppedClaims by a newer same-priority winner does not resurrect on expiry', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 250,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 100 } } },
    });

    settle(engine, 50);
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 50,
      targets: { x: { target: { from: 0, to: 500 } } },
    });

    const settled = settle(engine, 150, 50);
    expect(settled.xRange.to).toBeCloseTo(500, 4);

    const after = settle(engine, 320, 150);
    expect(after.xRange.to).toBeCloseTo(500, 4);
    expect(after.animating).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Velocity-continuous (position-continuous) handoff
  // ---------------------------------------------------------------------------

  it('position is continuous across a priority preemption — no teleport on handoff', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    // Run the data_tick partway. `data_tick` rides a linear curve on the
    // X slot (matches legacy `scrollToEnd`'s constant-velocity slide).
    const before = settle(engine, 160);
    const xBeforePreempt = before.xRange.to;
    const expectedBefore = (160 / 200) * 1000;
    expect(xBeforePreempt).toBeCloseTo(expectedBefore, 4);

    // Preempt with a gesture toward the opposite direction.
    engine.emit({
      kind: 'gesture',
      duration: 200,
      startWall: 160,
      targets: { x: { target: { from: 0, to: 0 } } },
    });

    // Handoff tick — gesture wins, slot.from frozen to the advanced position
    // of data_tick at t=176, not the stale `0` from the original `from`.
    const handoff = engine.tick(176);
    const expectedAtHandoff = (176 / 200) * 1000;
    // After handoff, `t = 0` on the new event → current still at handoff `from`.
    expect(handoff.xRange.to).toBeCloseTo(expectedAtHandoff, 3);
  });

  // ---------------------------------------------------------------------------
  // Advance-before-freeze — uses the EXACT effectiveNow value, not last tick
  // ---------------------------------------------------------------------------

  it('handoff advances the outgoing event to effectiveNow before freezing `from`', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    // Sample the curve at an intermediate point so we have an independent
    // anchor for the post-handoff comparison.
    const sampled = settle(engine, 128);
    const sampledX = sampled.xRange.to;

    // Drive to t=160 in 16ms steps so MAX_FRAME_DT (32) doesn't truncate the
    // next single tick. The handoff at tick(176) advances data_tick from
    // slot.activatedAt (0) to effectiveNow (176), independent of when the
    // engine was last sampled.
    settle(engine, 160, 128);
    engine.emit({
      kind: 'gesture',
      duration: 200,
      startWall: 176,
      targets: { x: { target: { from: 0, to: 0 } } },
    });
    const handoff = engine.tick(176);

    // `data_tick` uses linear easing on the X slot — the handoff's
    // recomputed-from-effectiveNow position is `t * 1000`.
    const recomputed = (176 / 200) * 1000;
    expect(handoff.xRange.to).toBeCloseTo(recomputed, 3);
    expect(handoff.xRange.to).toBeGreaterThan(sampledX);
  });

  // ---------------------------------------------------------------------------
  // Suppressed events expire silently — winner curve unaffected
  // ---------------------------------------------------------------------------

  it('a suppressed event expiring under an active winner does not jolt the slot', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Long gesture wins.
    engine.emit({
      kind: 'gesture',
      duration: 300,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    // Short data_tick loses by priority, parked in droppedClaims.
    engine.emit({
      kind: 'data_tick',
      duration: 50,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 500 } } },
    });

    // Frame just before the data_tick prunes.
    const justBefore = settle(engine, 48);
    expect(justBefore.xRange.to).toBeCloseTo(easeOutCubic(48 / 300) * 1000, 4);

    // The frame on which the data_tick prunes (effectiveNow > 50).
    const justAfter = settle(engine, 64, 48);
    expect(justAfter.xRange.to).toBeCloseTo(easeOutCubic(64 / 300) * 1000, 4);

    // And a later frame deep into the gesture's lifetime.
    const later = settle(engine, 160, 64);
    expect(later.xRange.to).toBeCloseTo(easeOutCubic(160 / 300) * 1000, 4);
  });

  // ---------------------------------------------------------------------------
  // droppedClaims explicit filter — loser cannot re-enter election
  // ---------------------------------------------------------------------------

  it('a concurrent loser is excluded from election even when the winner expires', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Both at t=0. gesture (prio 3) wins X, data_tick (prio 1) → droppedClaims.
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 400,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 500 } } },
    });

    // gesture settles at its deadline → X at 1000.
    const settled = settle(engine, 100);
    expect(settled.xRange.to).toBeCloseTo(1000, 4);

    // gesture pruned at t > 100. data_tick is still in-flight (dur=400) but
    // in droppedClaims for X. If the engine accidentally re-elected it, X
    // would start drifting toward 500. It must stay pinned at 1000.
    const after = settle(engine, 300, 100);
    expect(after.xRange.to).toBeCloseTo(1000, 4);

    // After the data_tick itself prunes (>400ms), there's nothing left in
    // flight and the slot must finally report idle.
    const idle = settle(engine, 432, 300);
    expect(idle.animating).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // droppedClaims sweep — pruned eventIds drop out of the set
  // ---------------------------------------------------------------------------

  it('after every event is pruned the slot is willing to accept a fresh emit', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Loser parked, winner runs and finishes.
    engine.emit({
      kind: 'gesture',
      duration: 50,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 500 } } },
    });

    // Settle past both events' deadlines so the in-flight + dropped-claims
    // bookkeeping is fully cleaned by the engine sweep.
    settle(engine, 200);

    // A brand-new data_tick at t=200 should run unimpeded — the previous
    // dropped-claim set is no longer holding anything.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 200,
      targets: { x: { target: { from: 1000, to: 333 } } },
    });
    const settled = settle(engine, 300, 200);
    expect(settled.xRange.to).toBeCloseTo(333, 4);
  });

  // ---------------------------------------------------------------------------
  // t-clamp on advance — `elapsed > duration` produces no phantom overshoot
  // ---------------------------------------------------------------------------

  it('handoff fired after the outgoing event would have expired clamps t to 1 (no overshoot)', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Short data_tick — would settle at t=50.
    engine.emit({
      kind: 'data_tick',
      duration: 50,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    // Drive partway but stop before the event prunes.
    settle(engine, 32);

    // Preempt at t=64 (after the data_tick would have settled). The handoff
    // advance must clamp t to 1 → slot.from snaps to 1000, no overshoot past it.
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 64,
      targets: { x: { target: { from: 0, to: 2000 } } },
    });
    const handoff = engine.tick(64);
    // Handoff position uses clamped t=1 → equal to old event's target (1000).
    expect(handoff.xRange.to).toBeCloseTo(1000, 4);
    expect(handoff.xRange.to).toBeLessThanOrEqual(1000.001);
  });

  // ---------------------------------------------------------------------------
  // Overshoot guard — reverse-direction handoff stays inside [from, target]
  // ---------------------------------------------------------------------------

  it('reverse-direction handoff produces a monotonic curve from `from` to the new target', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Forward (+) gesture mid-flight.
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    settle(engine, 48);

    // Preempt with reverse-direction gesture (newer startWall wins). The
    // handoff at tick(64) advances the outgoing forward gesture to its
    // effectiveNow position, so `from` for the new event sits just below
    // 1000 — track monotonicity from THAT anchor, not the pre-handoff sample.
    engine.emit({
      kind: 'gesture',
      duration: 200,
      startWall: 48,
      targets: { x: { target: { from: 0, to: 0 } } },
    });
    const atHandoff = engine.tick(64);
    let previous = atHandoff.xRange.to;
    expect(previous).toBeGreaterThan(0);

    // Reverse gesture (startWall=48, dur=200) prunes when effectiveNow > 248.
    // Drive past that so the expired-event snap pins slot.current to target.
    for (let t = 80; t <= 264; t += 16) {
      const state = engine.tick(t);
      expect(state.xRange.to).toBeLessThanOrEqual(previous + 1e-6);
      expect(state.xRange.to).toBeGreaterThanOrEqual(-1e-6);
      previous = state.xRange.to;
    }
    expect(previous).toBeCloseTo(0, 4);
  });

  // ---------------------------------------------------------------------------
  // Velocity units — observable position derivative matches the closed form
  // ---------------------------------------------------------------------------

  it('observed numerical velocity matches linear derivative in units/ms for data_tick X', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    // Two samples close together so the numerical derivative is a good
    // approximation of the instantaneous velocity.
    const tA = 96;
    const tB = 112;
    settle(engine, tA);
    const stateA = engine.getAnimationState();
    const xA = stateA.xRange.to;
    const stateB = engine.tick(tB);
    const xB = stateB.xRange.to;

    const numerical = (xB - xA) / (tB - tA);
    // data_tick X uses linear easing: d/dt [(t/D) · (target − from)] = (target − from) / D
    const expected = (1000 - 0) / 200;

    expect(numerical).toBeCloseTo(expected, 4);
  });
});
