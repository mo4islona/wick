/**
 * Shared scaffolding for the {@link AnimationEngine} test suites. Each test
 * file used to inline these helpers — they're identical across files and the
 * duplication grew noisy as the suite count rose. Centralizing them keeps
 * individual test files focused on the invariant under test.
 *
 * Filename intentionally lacks `.test.` so vitest's include glob skips it.
 */
import type { AnimationEngine, AnimationState } from '../../../animation/engine';
import { createAnimationEngine } from '../../../animation/engine';
import type { RetargetOptions, Transition } from '../../../animation/transition';
import type { VisibleRange, YRange } from '../../../types';

export interface TrackedTransition extends Transition {
  readonly retargetCalls: ReadonlyArray<{ value: YRange; opts: RetargetOptions | undefined }>;
  readonly snapCalls: ReadonlyArray<{ value: YRange; opts: { now?: number } | undefined }>;
  /** Hook fired from inside `tick()` — used to simulate emits landing during a tick. */
  tickHook?: (now: number) => void;
}

/**
 * Snap-style transition that records every retarget / snap call. The engine
 * is meant to drive a real `Transition` (hermite / spring / snap) but for
 * tests we want explicit visibility into which call landed when, and a
 * deterministic state (no time-dependent easing) for assertions.
 */
export function createTrackedTransition(initial: YRange): TrackedTransition {
  let current: YRange = { min: initial.min, max: initial.max };
  let target: YRange = { min: initial.min, max: initial.max };

  const retargetCalls: Array<{ value: YRange; opts: RetargetOptions | undefined }> = [];
  const snapCalls: Array<{ value: YRange; opts: { now?: number } | undefined }> = [];

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

export interface SetupOpts {
  yRange?: YRange;
  xRange?: VisibleRange;
  onWake?: () => void;
}

export interface SetupResult {
  engine: AnimationEngine;
  transition: TrackedTransition;
}

export function setup(opts: SetupOpts = {}): SetupResult {
  const yRange = opts.yRange ?? { min: 0, max: 100 };
  const xRange = opts.xRange ?? { from: 0, to: 1000 };
  const transition = createTrackedTransition(yRange);
  const engine = createAnimationEngine({
    initial: { yRange, xRange },
    yTransition: transition,
    onWake: opts.onWake,
  });

  return { engine, transition };
}

/**
 * Drive the engine like a 60 fps RAF: tick at `from` (wakes the engine and
 * runs initial slot election), then advance toward `deadline` in `step` ms
 * increments. The default 16 ms step keeps `MAX_FRAME_DT` from clamping —
 * for bg-tab clamp tests, pass a larger step explicitly.
 */
export function settle(engine: AnimationEngine, deadline: number, from = 0, step = 16): AnimationState {
  let state = engine.tick(from);
  let t = from;
  while (t < deadline) {
    t = Math.min(t + step, deadline);
    state = engine.tick(t);
  }

  return state;
}
