/**
 * Lifecycle suite for {@link AnimationEngine}: `emit` / `tick` / `flush` /
 * `dropSlot` / `register*Pulse` semantics + zero-duration guards, strict-`>`
 * pruning, `pendingEmits` promotion at tick-start. These tests pin the
 * contracts the chart-side bridge will rely on once engine integration lands
 * in chart.ts.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AnimationEngine, AnimationState } from '../../../animation/engine';
import { createAnimationEngine } from '../../../animation/engine';
import type { RetargetOptions, Transition } from '../../../animation/transition';
import type { VisibleRange, YRange } from '../../../types';

type TrackedTransition = Transition & {
  retargetCalls: Array<{ value: YRange; opts: RetargetOptions | undefined }>;
  snapCalls: Array<{ value: YRange; opts: { now?: number } | undefined }>;
  tickHook?: (now: number) => void;
};

function createTrackedSnap(initial: YRange): TrackedTransition {
  let current: YRange = { min: initial.min, max: initial.max };
  let target: YRange = { min: initial.min, max: initial.max };

  const retargetCalls: TrackedTransition['retargetCalls'] = [];
  const snapCalls: TrackedTransition['snapCalls'] = [];

  const tracked: TrackedTransition = {
    get current() {
      return current;
    },
    get target() {
      return target;
    },
    get animating() {
      return false;
    },
    retarget(value, opts) {
      retargetCalls.push({ value: { min: value.min, max: value.max }, opts: opts ? { ...opts } : undefined });
      current = { min: value.min, max: value.max };
      target = { min: value.min, max: value.max };
    },
    snap(value, opts) {
      snapCalls.push({ value: { min: value.min, max: value.max }, opts: opts ? { ...opts } : undefined });
      current = { min: value.min, max: value.max };
      target = { min: value.min, max: value.max };
    },
    tick(now) {
      if (this.tickHook) this.tickHook(now);

      return false;
    },
    retargetCalls,
    snapCalls,
  };

  return tracked;
}

interface SetupOpts {
  yRange?: YRange;
  xRange?: VisibleRange;
  onWake?: () => void;
}

function setup(opts: SetupOpts = {}): { engine: AnimationEngine; transition: TrackedTransition } {
  const yRange = opts.yRange ?? { min: 0, max: 100 };
  const xRange = opts.xRange ?? { from: 0, to: 1000 };
  const transition = createTrackedSnap(yRange);
  const engine = createAnimationEngine({
    initial: { yRange, xRange },
    yTransition: transition,
    onWake: opts.onWake,
  });

  return { engine, transition };
}

function settle(engine: AnimationEngine, deadline: number, from = 0, step = 16): AnimationState {
  let state = engine.tick(from);
  let t = from;
  while (t < deadline) {
    t = Math.min(t + step, deadline);
    state = engine.tick(t);
  }

  return state;
}

describe('AnimationEngine — lifecycle', () => {
  // ---------------------------------------------------------------------------
  // Zero-duration guards
  // ---------------------------------------------------------------------------

  it('zero-duration instant event snaps X on the first tick without NaN', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'instant',
      duration: 0,
      startWall: 0,
      targets: { x: { target: { from: 50, to: 5000 } } },
    });

    const state = engine.tick(0);
    expect(state.xRange.from).toBe(50);
    expect(state.xRange.to).toBe(5000);
    expect(Number.isNaN(state.xRange.to)).toBe(false);
  });

  it('zero-duration data_tick (animations:false convention) snaps alpha + X immediately', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 0,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 4000 } },
        alpha: [{ key: 's', target: 0 }],
      },
    });

    const state = engine.tick(0);
    expect(state.xRange.to).toBe(4000);
    expect(state.seriesAlpha.get('s')).toBe(0);
  });

  it('zero-duration Y event calls transition.snap, not retarget', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'visibility',
      duration: 0,
      startWall: 0,
      targets: { y: { target: { min: -10, max: 999 } } },
    });

    const state = engine.tick(0);
    expect(transition.snapCalls).toHaveLength(1);
    expect(transition.retargetCalls).toHaveLength(0);
    expect(state.yRange.min).toBe(-10);
    expect(state.yRange.max).toBe(999);
  });

  // ---------------------------------------------------------------------------
  // Prune — strict `>` keeps last-frame settle visible
  // ---------------------------------------------------------------------------

  it('event with duration=200 is still in flight on the frame where effectiveNow === startWall + duration (last-frame settle)', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 2000 } } },
    });

    // settle to 200 ms: the strict `>` prune means t reaches exactly 1 on
    // this frame and the slot lands at target.
    const state = settle(engine, 200);
    expect(state.xRange.to).toBeCloseTo(2000, 5);

    // One more frame past the deadline → pruned. animating goes to false.
    const after = engine.tick(216);
    expect(after.animating).toBe(false);
    expect(after.xRange.to).toBeCloseTo(2000, 5);
  });

  it('zero-duration event is processed at tick(0) before strict-`>` prune removes it', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'instant',
      duration: 0,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 7777 } } },
    });

    // duration=0 satisfies `effectiveNow <= startWall + 0` only when
    // effectiveNow === 0. The zero-duration guard inside slot processing
    // must run BEFORE the strict-`>` prune for the next frame would drop
    // the event silently.
    const state = engine.tick(0);
    expect(state.xRange.to).toBe(7777);

    const after = engine.tick(16);
    expect(after.xRange.to).toBe(7777);
    expect(after.animating).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Batched events — single retarget per tick
  // ---------------------------------------------------------------------------

  it('multiple Y emits in one frame batch down to ONE transition.retarget call', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 200 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 500 } } },
    });

    engine.tick(0);
    expect(transition.retargetCalls).toHaveLength(1);
    expect(transition.retargetCalls[0].value).toEqual({ min: 0, max: 500 });
  });

  it('Y target with explicit expandMs / contractMs forwards them to Transition.retarget (sticky-Y preserved)', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 999, // ignored on Y when expandMs / contractMs are set
      startWall: 0,
      targets: { y: { target: { min: 0, max: 200 }, expandMs: 250, contractMs: 2500 } },
    });

    engine.tick(0);
    expect(transition.retargetCalls).toHaveLength(1);
    expect(transition.retargetCalls[0].opts?.expandMs).toBe(250);
    expect(transition.retargetCalls[0].opts?.contractMs).toBe(2500);
  });

  it('Y target without expandMs / contractMs falls back to event.duration for both directions', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'visibility',
      duration: 250,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 200 } } },
    });

    engine.tick(0);
    expect(transition.retargetCalls[0].opts?.expandMs).toBe(250);
    expect(transition.retargetCalls[0].opts?.contractMs).toBe(250);
  });

  // ---------------------------------------------------------------------------
  // flush()
  // ---------------------------------------------------------------------------

  it('flush() while an event is in flight snaps the transition to its target and clears the queue', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 1000,
      startWall: 0,
      targets: {
        y: { target: { min: 0, max: 777 } },
        x: { target: { from: 0, to: 3000 } },
      },
    });
    engine.tick(0);

    engine.flush();
    expect(transition.snapCalls).toHaveLength(1);
    expect(transition.snapCalls[0].value).toEqual({ min: 0, max: 777 });

    // After flush, ticking does not re-animate — queue is empty.
    const after = engine.tick(16);
    expect(after.yRange).toEqual({ min: 0, max: 777 });
    expect(after.xRange.to).toBe(3000);
    expect(after.animating).toBe(false);
  });

  it('flush() before the first tick still snaps to the newest emitted Y target (Y catch-up)', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 1 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 999 } } },
    });

    engine.flush();
    expect(transition.snapCalls).toHaveLength(1);
    expect(transition.snapCalls[0].value).toEqual({ min: 0, max: 999 });
  });

  // ---------------------------------------------------------------------------
  // emit() inside tick() — pendingEmits semantics
  // ---------------------------------------------------------------------------

  it('emit() called from inside tick() is deferred to the next tick with that tick’s effectiveNow', () => {
    const { engine, transition } = setup();

    // Trigger the in-tick emit via the Transition.tick callback (engine
    // calls yTransition.tick during its own tick processing).
    let pumped = false;
    transition.tickHook = () => {
      if (pumped) return;
      pumped = true;
      engine.emit({
        kind: 'data_tick',
        duration: 100,
        startWall: 0, // will be overwritten on promote
        targets: { x: { target: { from: 0, to: 8888 } } },
      });
    };

    // Seed a Y event so the engine actually ticks (otherwise nothing drives
    // the transition).
    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 50 } } },
    });

    const stateFrame0 = engine.tick(0);
    // The X event was emitted INSIDE tick(0) — it must not have been
    // processed yet (still pending), so X is at its initial value.
    expect(stateFrame0.xRange.to).toBe(1000);

    // Frame 1: pending emit promotes with startWall = effectiveNow of THIS
    // tick (not predicted current+FRAME_DT). At t=0 of the new event, X is
    // frozen at its from value.
    const stateFrame1 = engine.tick(16);
    expect(stateFrame1.xRange.to).toBe(1000);
    expect(stateFrame1.animating).toBe(true);

    // Settle to the promoted event's deadline. With startWall = 16 and
    // duration = 100, the event settles at effectiveNow = 116.
    const settled = settle(engine, 116, 16);
    expect(settled.xRange.to).toBeCloseTo(8888, 5);
  });

  it('pendingEmits keep animating=true even when no in-flight event remains', () => {
    const { engine, transition } = setup();

    let pumped = false;
    transition.tickHook = () => {
      if (pumped) return;
      pumped = true;
      engine.emit({
        kind: 'entrance',
        duration: 100,
        startWall: 0,
        targets: { entry: [{ seriesId: 's', layerIdx: 0, time: 999 }] },
      });
    };

    // Single short Y event prunes immediately on the next tick.
    engine.emit({
      kind: 'instant',
      duration: 0,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 50 } } },
    });

    const frame0 = engine.tick(0);
    // Y instant snap → no in-flight. But the entrance emit landed in
    // pendingEmits during this tick → animating must still be true so the
    // chart-side RAF keeps spinning.
    expect(frame0.animating).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Wake-up + onWake callback
  // ---------------------------------------------------------------------------

  it('emit() on an idle engine fires the onWake callback exactly once', () => {
    const onWake = vi.fn();
    const { engine } = setup({ onWake });

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 100 } } },
    });
    expect(onWake).toHaveBeenCalledTimes(1);

    // Subsequent emit during the active phase does NOT re-fire onWake.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 200 } } },
    });
    expect(onWake).toHaveBeenCalledTimes(1);

    // Run the engine to settle, then idle.
    settle(engine, 200);

    // Re-emit on idle re-fires onWake.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      targets: { x: { target: { from: 0, to: 300 } } },
    });
    expect(onWake).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // dropSlot
  // ---------------------------------------------------------------------------

  it('dropSlot(alpha, key) removes the slot and the public seriesAlpha entry', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'visibility',
      duration: 100,
      startWall: 0,
      targets: { alpha: [{ key: 'gone', target: 0 }] },
    });
    settle(engine, 100);
    expect(engine.getAnimationState().seriesAlpha.get('gone')).toBeCloseTo(0, 5);

    engine.dropSlot('alpha', 'gone');
    expect(engine.getAnimationState().seriesAlpha.has('gone')).toBe(false);
  });

  it('dropSlot is a no-op for persistent y / x slots', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'instant',
      duration: 0,
      startWall: 0,
      targets: { x: { target: { from: 5, to: 5005 } } },
    });
    engine.tick(0);
    engine.dropSlot('x');
    const state = engine.getAnimationState();
    expect(state.xRange.from).toBe(5);
    expect(state.xRange.to).toBe(5005);
  });

  // ---------------------------------------------------------------------------
  // Pulse registry
  // ---------------------------------------------------------------------------

  it('registerSeriesPulse drives pulsePhase per id; unregister removes it', () => {
    const { engine } = setup();

    engine.registerSeriesPulse('line-a', 1000);

    // Drive ticks so effectiveNow advances. Seed a Y emit so the engine
    // actually animates and we keep ticking via the test loop.
    engine.emit({
      kind: 'data_tick',
      duration: 1000,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 1 } } },
    });

    const state = settle(engine, 500);
    expect(state.pulsePhase.get('line-a')).toBeCloseTo(0.5, 3);

    engine.unregisterSeriesPulse('line-a');
    const next = engine.tick(516);
    expect(next.pulsePhase.has('line-a')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // animating flag
  // ---------------------------------------------------------------------------

  it('animating goes false only after every slot has settled', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 2000 } },
        alpha: [{ key: 'fade', target: 0 }],
      },
    });

    const mid = settle(engine, 50);
    expect(mid.animating).toBe(true);

    // Past the last-frame settle and one more frame: queue pruned, no
    // velocity residue.
    settle(engine, 100);
    const after = engine.tick(116);
    expect(after.animating).toBe(false);
  });
});
