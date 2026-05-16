/**
 * Timing & clock-domain suite for {@link AnimationEngine}. Covers the
 * invariants that decouple the engine from real wall-clock variability:
 * the bg-tab `dt` clamp, idle-emit NaN sentinel resolution at wake-up, the
 * `emitSeq` tiebreaker, and the velocity-epsilon snap that lets `animating`
 * cleanly fall back to `false` once a slot has converged.
 */
import { describe, expect, it, vi } from 'vitest';

import { settle, setup } from './test-utils';

describe('AnimationEngine — timing', () => {
  // ---------------------------------------------------------------------------
  // bg-tab clamp
  // ---------------------------------------------------------------------------

  it('clamps per-tick advancement to MAX_FRAME_DT (32 ms) — large `dt` does not teleport in-flight events', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    engine.tick(0);
    // One frame later wall-clock says 5 seconds elapsed — bg-tab returned.
    // The clamp should advance effectiveNow by only 32 ms.
    // data_tick X uses linear easing: current = (t/D) · target.
    const after = engine.tick(5000);
    const expected = (32 / 200) * 1000;
    expect(after.xRange.to).toBeCloseTo(expected, 4);

    // Drive a few more frames; effectiveNow advances by 32 ms each time.
    let prev = after.xRange.to;
    for (let i = 0; i < 4; i++) {
      const state = engine.tick(5000 + i * 16);
      // Either monotonic progress or still inside the clamp envelope.
      expect(state.xRange.to).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = state.xRange.to;
    }
  });

  // ---------------------------------------------------------------------------
  // emitSeq tiebreaker + same-startWall determinism
  // ---------------------------------------------------------------------------

  it('two emits before the first tick share the same effective startWall — newer emitSeq wins', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 4000 } } },
    });

    // Both events land idle → both seal with NaN sentinel → first tick
    // resolves both to the same effectiveNow. Same priority + startWall →
    // emitSeq breaks the tie, the second emit wins.
    const state = settle(engine, 100);
    expect(state.xRange.to).toBeCloseTo(4000, 4);
  });

  it('three emits within a single tick window: last emitted wins the slot', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 100 } } },
    });
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 200 } } },
    });
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 333 } } },
    });

    const state = settle(engine, 100);
    expect(state.xRange.to).toBeCloseTo(333, 4);
  });

  // ---------------------------------------------------------------------------
  // Idle-emit NaN sentinel — first tick after wake-up resolves the startWall
  // ---------------------------------------------------------------------------

  it('idle-emit followed by wake-up tick produces a valid `t >= 0` on the first animation frame', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // Emit on a freshly-constructed engine — it is idle, so the sealed
    // startWall is the NaN sentinel until the first tick resolves it.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    // Wake-up — `now` is the first concrete clock value the engine sees.
    // Without the NaN resolution, `t = (now - NaN)` propagates NaN through
    // the curve and `state.xRange.to` would be NaN on this frame.
    const wakeup = engine.tick(123);
    expect(Number.isNaN(wakeup.xRange.to)).toBe(false);
    expect(wakeup.xRange.to).toBeCloseTo(0, 5);

    // Next frame: 16 ms past wake-up → t = 16/100 of the linear curve.
    const second = engine.tick(139);
    const expected = (16 / 100) * 1000;
    expect(second.xRange.to).toBeCloseTo(expected, 4);
  });

  // ---------------------------------------------------------------------------
  // Single clock domain — after extended idle, the new event runs cleanly
  // ---------------------------------------------------------------------------

  it('re-emitting after extended idle keeps the engine on a single effectiveNow clock — curve is smooth from the new wake-up', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    // First session — run and settle.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 500 } } },
    });
    settle(engine, 116);
    const afterFirst = engine.getAnimationState();
    expect(afterFirst.xRange.to).toBeCloseTo(500, 4);
    expect(afterFirst.animating).toBe(false);

    // Long simulated wall-clock gap. No emit, no tick — engine is idle.
    // Then re-emit (no explicit startWall) and tick with a wall value
    // 10 seconds in the future. Wake-up pins the clock to `now`, NaN
    // sentinel resolves to that same `now` → t starts at zero, no jump.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 999 } } },
    });
    const wakeup = engine.tick(10_116);
    expect(wakeup.xRange.to).toBeCloseTo(500, 4);

    // 16 ms past wake-up: t = 16/100 of the new linear curve, advancing from 500.
    const second = engine.tick(10_132);
    const expected = 500 + (16 / 100) * (999 - 500);
    expect(second.xRange.to).toBeCloseTo(expected, 4);
  });

  // ---------------------------------------------------------------------------
  // Velocity epsilon — small residual settles to zero, animating goes false
  // ---------------------------------------------------------------------------

  it('a settled slot reports animating=false; subthreshold velocity is snapped to zero', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    // Drive to the last-frame settle (strict-`>` prune means the event is
    // still in flight here) and then one more frame past prune.
    const atEdge = settle(engine, 100);
    expect(atEdge.xRange.to).toBeCloseTo(1000, 4);

    const past = engine.tick(116);
    expect(past.animating).toBe(false);
    expect(past.xRange.to).toBeCloseTo(1000, 4);
  });

  // ---------------------------------------------------------------------------
  // onWake — fires on idle→active boundary, not on every emit
  // ---------------------------------------------------------------------------

  it('onWake fires only on the idle→active transition; settle → re-emit fires it again', () => {
    const onWake = vi.fn();
    const { engine } = setup({ xRange: { from: 0, to: 0 }, onWake });

    // First emit on an idle engine wakes.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 200 } } },
    });
    expect(onWake).toHaveBeenCalledTimes(1);

    // Settling without emits does not re-fire onWake.
    settle(engine, 132);
    expect(onWake).toHaveBeenCalledTimes(1);

    // After settle the engine is idle again → next emit re-wakes.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 400 } } },
    });
    expect(onWake).toHaveBeenCalledTimes(2);
  });
});
