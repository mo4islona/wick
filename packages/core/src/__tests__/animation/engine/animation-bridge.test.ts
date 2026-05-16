/**
 * Animation bridge — pure adapter routing chart-side events into the engine
 * with the sub-threshold X filter and the logical `lastXTarget` cache that
 * the autoscroll controller reads.
 */
import { describe, expect, it } from 'vitest';

import type { AnimationEvent } from '../../../animation/engine';
import { createAnimationEngine } from '../../../animation/engine';
import type { Transition } from '../../../animation/transition';
import { AnimationBridge } from '../../../chart/animation-bridge';

function makeNoopTransition(): Transition {
  return {
    get current() {
      return { min: 0, max: 0 };
    },
    get target() {
      return { min: 0, max: 0 };
    },
    get animating() {
      return false;
    },
    retarget() {},
    snap() {},
    tick() {
      return false;
    },
  };
}

function setupBridge() {
  const emitCalls: AnimationEvent[] = [];
  const engine = createAnimationEngine({
    initial: { yRange: { min: 0, max: 0 }, xRange: { from: 0, to: 0 } },
    yTransition: makeNoopTransition(),
  });
  // Wrap engine.emit so tests inspect what the bridge produced.
  const realEmit = engine.emit.bind(engine);
  engine.emit = (event) => {
    emitCalls.push(event);
    realEmit(event);
  };

  return { bridge: new AnimationBridge({ engine }), emitCalls };
}

describe('AnimationBridge', () => {
  // ---------------------------------------------------------------------------
  // emitDataTick — filters sub-threshold X, updates lastXTarget
  // ---------------------------------------------------------------------------

  it('emits y/x/tickFade together on data_tick when targets are present', () => {
    const { bridge, emitCalls } = setupBridge();

    bridge.emitDataTick({
      duration: 250,
      xTarget: { from: 0, to: 1000 },
      yTarget: { min: 0, max: 50 },
      tickFade: { entering: [100], exiting: [] },
    });

    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].kind).toBe('data_tick');
    expect(emitCalls[0].duration).toBe(250);
    expect(emitCalls[0].targets.x?.target).toEqual({ from: 0, to: 1000 });
    expect(emitCalls[0].targets.y?.target).toEqual({ min: 0, max: 50 });
    expect(emitCalls[0].targets.tickFade?.entering).toEqual([100]);
    expect(bridge.lastXTarget).toEqual({ from: 0, to: 1000 });
  });

  it('skips entirely when every target field is missing (no engine emit)', () => {
    const { bridge, emitCalls } = setupBridge();

    bridge.emitDataTick({
      duration: 250,
      xTarget: null,
      yTarget: null,
    });

    expect(emitCalls).toHaveLength(0);
    expect(bridge.lastXTarget).toBeNull();
  });

  it('sub-threshold X delta omits X from the emit; lastXTarget stays at the previous value', () => {
    const { bridge, emitCalls } = setupBridge();

    // Seed lastXTarget with a real claim first.
    bridge.emitDataTick({
      duration: 250,
      xTarget: { from: 0, to: 1000 },
      yTarget: null,
    });
    expect(bridge.lastXTarget).toEqual({ from: 0, to: 1000 });

    // Sub-threshold drift — bridge filters X out; Y still rides the emit.
    bridge.emitDataTick({
      duration: 250,
      xTarget: { from: 0, to: 1000.5 },
      yTarget: { min: 0, max: 50 },
      xThreshold: 10,
    });
    expect(emitCalls).toHaveLength(2);
    expect(emitCalls[1].targets.x).toBeUndefined();
    expect(emitCalls[1].targets.y?.target).toEqual({ min: 0, max: 50 });
    expect(bridge.lastXTarget).toEqual({ from: 0, to: 1000 });
  });

  // ---------------------------------------------------------------------------
  // emitVisibility
  // ---------------------------------------------------------------------------

  it('emitVisibility produces alpha + y + tickFade in lockstep', () => {
    const { bridge, emitCalls } = setupBridge();

    bridge.emitVisibility({
      duration: 200,
      seriesId: 's-1',
      visible: false,
      yTarget: { min: 0, max: 50 },
      tickFade: { entering: [], exiting: [100, 200] },
    });

    expect(emitCalls).toHaveLength(1);
    const ev = emitCalls[0];
    expect(ev.kind).toBe('visibility');
    expect(ev.duration).toBe(200);
    expect(ev.targets.alpha).toEqual([{ key: 's-1', target: 0 }]);
    expect(ev.targets.y?.target).toEqual({ min: 0, max: 50 });
    expect(ev.targets.tickFade?.exiting).toEqual([100, 200]);
  });

  it('emitVisibility(visible:true) targets alpha=1', () => {
    const { bridge, emitCalls } = setupBridge();

    bridge.emitVisibility({
      duration: 200,
      seriesId: 's-1',
      visible: true,
      yTarget: null,
    });

    expect(emitCalls[0].targets.alpha).toEqual([{ key: 's-1', target: 1 }]);
  });

  // ---------------------------------------------------------------------------
  // emitGesture / emitInstant
  // ---------------------------------------------------------------------------

  it('emitGesture marks the event kind and updates lastXTarget', () => {
    const { bridge, emitCalls } = setupBridge();

    bridge.emitGesture({ duration: 80, xTarget: { from: 100, to: 1100 } });
    expect(emitCalls[0].kind).toBe('gesture');
    expect(bridge.lastXTarget).toEqual({ from: 100, to: 1100 });
  });

  it('emitInstant uses duration=0 (zero-duration guard path in engine)', () => {
    const { bridge, emitCalls } = setupBridge();

    bridge.emitInstant({ xTarget: { from: 0, to: 5000 }, yTarget: { min: 1, max: 2 } });
    const ev = emitCalls[0];
    expect(ev.kind).toBe('instant');
    expect(ev.duration).toBe(0);
    expect(ev.targets.x?.target).toEqual({ from: 0, to: 5000 });
    expect(ev.targets.y?.target).toEqual({ min: 1, max: 2 });
    expect(bridge.lastXTarget).toEqual({ from: 0, to: 5000 });
  });
});
