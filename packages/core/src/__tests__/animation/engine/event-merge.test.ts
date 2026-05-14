/**
 * Per-slot winner-election suite for {@link AnimationEngine}. The merge
 * algorithm resolves conflicts on a `(target, key)` granularity, NOT on the
 * event as a whole — one event can drive Y, X, alpha, tickFade in lockstep
 * while a higher-priority event preempts only X. The tests below pin each
 * arm of that protocol: priority preemption, startWall / emitSeq tie-breaks,
 * composite-key independence.
 *
 * Timing: the engine clamps per-tick advancement to `MAX_FRAME_DT` (32 ms)
 * to keep bg-tab wake-ups from teleporting in-flight tweens. Tests drive
 * the engine through small steps via `settle()` so `effectiveNow` advances
 * monotonically just like a 60 fps RAF would.
 */
import { describe, expect, it } from 'vitest';

import type { AnimationEngine, AnimationState } from '../../../animation/engine';
import { createAnimationEngine } from '../../../animation/engine';
import type { RetargetOptions, Transition } from '../../../animation/transition';
import type { VisibleRange, YRange } from '../../../types';

type TrackedTransition = Transition & {
  retargetCalls: Array<{ value: YRange; opts: RetargetOptions | undefined }>;
  snapCalls: Array<{ value: YRange; opts: { now?: number } | undefined }>;
};

function createTrackedSnap(initial: YRange): TrackedTransition {
  let current: YRange = { min: initial.min, max: initial.max };
  let target: YRange = { min: initial.min, max: initial.max };

  const retargetCalls: TrackedTransition['retargetCalls'] = [];
  const snapCalls: TrackedTransition['snapCalls'] = [];

  const tracked: Transition = {
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
      // Snap-style behaviour so state.yRange reflects the latest target.
      current = { min: value.min, max: value.max };
      target = { min: value.min, max: value.max };
    },
    snap(value, opts) {
      snapCalls.push({ value: { min: value.min, max: value.max }, opts: opts ? { ...opts } : undefined });
      current = { min: value.min, max: value.max };
      target = { min: value.min, max: value.max };
    },
    tick() {
      return false;
    },
  };

  return Object.assign(tracked, { retargetCalls, snapCalls });
}

interface SetupOpts {
  yRange?: YRange;
  xRange?: VisibleRange;
}

function setup(opts: SetupOpts = {}): { engine: AnimationEngine; transition: TrackedTransition } {
  const yRange = opts.yRange ?? { min: 0, max: 100 };
  const xRange = opts.xRange ?? { from: 0, to: 1000 };
  const transition = createTrackedSnap(yRange);
  const engine = createAnimationEngine({
    initial: { yRange, xRange },
    yTransition: transition,
  });

  return { engine, transition };
}

/**
 * Drive the engine like a 60 fps RAF: tick at `from` first (so the initial
 * wake-up + slot election happen), then step toward `deadline` in 16 ms
 * increments so the `MAX_FRAME_DT` clamp never kicks in. Returns the state
 * sampled at the final tick.
 */
function settle(engine: AnimationEngine, deadline: number, from = 0, step = 16): AnimationState {
  let state = engine.tick(from);
  let t = from;
  while (t < deadline) {
    t = Math.min(t + step, deadline);
    state = engine.tick(t);
  }

  return state;
}

describe('AnimationEngine — event merge', () => {
  it('single event with disjoint target types settles each independently on its own deadline', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'visibility',
      duration: 100,
      startWall: 0,
      targets: {
        y: { target: { min: -50, max: 200 } },
        x: { target: { from: 100, to: 2000 } },
        alpha: [{ key: 'series-a', target: 0.4 }],
        tickFade: { entering: [50], exiting: [] },
      },
    });

    // First tick: t = 0, all slots still at `from`. tickOpacity entering
    // value seeds at 0 (initial absence) and remains there because t = 0.
    let state = engine.tick(0);
    expect(transition.retargetCalls).toHaveLength(1);
    expect(state.xRange.from).toBe(0);
    expect(state.xRange.to).toBe(1000);
    expect(state.seriesAlpha.get('series-a')).toBeCloseTo(1, 5);
    expect(state.tickOpacity.get(50)).toBeCloseTo(0, 5);

    state = settle(engine, 100);
    expect(state.xRange.from).toBeCloseTo(100, 5);
    expect(state.xRange.to).toBeCloseTo(2000, 5);
    expect(state.seriesAlpha.get('series-a')).toBeCloseTo(0.4, 5);
    // tickOpacity entering reaches 1; the slot prune leaves the public value at 1.
    expect(state.tickOpacity.get(50)).toBeCloseTo(1, 5);
  });

  it('two events on disjoint slots both settle independently', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 2000 } } },
    });
    engine.emit({
      kind: 'visibility',
      duration: 100,
      startWall: 0,
      targets: { alpha: [{ key: 'series-b', target: 0 }] },
    });

    const state = settle(engine, 100);
    expect(state.xRange.to).toBeCloseTo(2000, 5);
    expect(state.seriesAlpha.get('series-b')).toBeCloseTo(0, 5);
  });

  it('higher-priority kind wins the slot (gesture preempts data_tick on X)', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 2000 } } },
    });
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 500 } } },
    });

    const state = settle(engine, 100);
    // gesture (priority 3) wins over data_tick (priority 1) → X heads to 500
    expect(state.xRange.to).toBeCloseTo(500, 5);
  });

  it('equal priority: newer startWall wins the tie-break', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1500 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 20,
      targets: { x: { target: { from: 0, to: 3000 } } },
    });

    // startWall=20 winner settles at effectiveNow = 20 + 100 = 120.
    const state = settle(engine, 120);
    expect(state.xRange.to).toBeCloseTo(3000, 5);
  });

  it('equal priority + startWall: newer emitSeq wins (deterministic batch order)', () => {
    const { engine } = setup();

    // Both events get the same `startWall` since they're emitted before any
    // tick advances effectiveNow. The second emit wins by emitSeq.
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1500 } } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 3000 } } },
    });

    const state = settle(engine, 100);
    expect(state.xRange.to).toBeCloseTo(3000, 5);
  });

  it('partial slot win — gesture wins X, data_tick wins Y on the same frame', () => {
    const { engine, transition } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 2000 } },
        y: { target: { min: 0, max: 500 } },
      },
    });
    engine.emit({
      kind: 'gesture',
      duration: 100,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 800 } },
      },
    });

    const state = settle(engine, 100);

    // gesture wins X (priority)
    expect(state.xRange.to).toBeCloseTo(800, 5);

    // data_tick wins Y because gesture made no Y claim — only one Y candidate
    expect(transition.retargetCalls).toHaveLength(1);
    expect(transition.retargetCalls[0].value).toEqual({ min: 0, max: 500 });
    expect(state.yRange.max).toBe(500);
  });

  it('composite live keys (seriesId:layerIdx) do not collide', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: {
        liveScalar: [
          { seriesId: 'series-x', layerIdx: 0, target: 10 },
          { seriesId: 'series-x', layerIdx: 1, target: 200 },
        ],
      },
    });

    const state = settle(engine, 100);
    expect(state.liveValues.scalar.get('series-x:0')).toBeCloseTo(10, 5);
    expect(state.liveValues.scalar.get('series-x:1')).toBeCloseTo(200, 5);
  });

  it('entrance events on different time keys settle in parallel without dropping one another', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'entrance',
      duration: 100,
      startWall: 0,
      targets: {
        entry: [
          { seriesId: 'series-a', layerIdx: 0, time: 1000 },
          { seriesId: 'series-a', layerIdx: 0, time: 1100 },
          { seriesId: 'series-a', layerIdx: 0, time: 1200 },
        ],
      },
    });

    const state = settle(engine, 100);
    const perSeries = state.entryProgress.get('series-a');
    expect(perSeries).toBeDefined();
    expect(perSeries?.get(1000)).toBeCloseTo(1, 5);
    expect(perSeries?.get(1100)).toBeCloseTo(1, 5);
    expect(perSeries?.get(1200)).toBeCloseTo(1, 5);
  });
});
