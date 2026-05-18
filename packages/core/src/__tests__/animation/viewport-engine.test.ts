/**
 * ViewportEngine — push-model API contract.
 *
 * Pins the input → target round-trip: chart-supplied `computeXTarget` /
 * `computeYTarget` callbacks are invoked on each `on*` signal and the
 * resulting targets show up in `getTarget()`.
 */
import { describe, expect, it, vi } from 'vitest';

import { spring } from '../../animation/spring';
import { type ViewportEngine, createViewportEngine } from '../../animation/viewport-engine';
import { hermite } from '../../animation/y-range-hermite';
import type { VisibleRange, YRange } from '../../types';

interface SetupArgs {
  initialX?: VisibleRange;
  initialY?: YRange;
  nextX?: VisibleRange | null;
  nextY?: YRange | null;
  xSettleMs?: number;
}

function setup(args: SetupArgs = {}): {
  engine: ViewportEngine;
  computeXTarget: ReturnType<typeof vi.fn>;
  computeYTarget: ReturnType<typeof vi.fn>;
} {
  const initialX = args.initialX ?? { from: 0, to: 1000 };
  const initialY = args.initialY ?? { min: 0, max: 100 };

  const computeXTarget = vi.fn((): VisibleRange | null => args.nextX ?? null);
  const computeYTarget = vi.fn((passed: { xTarget: VisibleRange }): YRange | null => {
    void passed; // exercise the args contract without inflating the test
    return args.nextY ?? null;
  });

  const engine = createViewportEngine({
    initial: { xRange: initialX, yRange: initialY },
    y: {
      curve: hermite(),
      settleMs: 250,
      stickyMs: 1000,
      gestureMs: 100,
      toggleMs: 250,
    },
    x: {
      curve: spring<VisibleRange>(),
      settleMs: args.xSettleMs ?? 200,
      gestureMs: 150,
    },
    computeXTarget,
    computeYTarget,
  });

  return { engine, computeXTarget, computeYTarget };
}

describe('ViewportEngine — push-model contract', () => {
  it('starts with current === initial, target === initial', () => {
    const { engine } = setup();
    const state = engine.getAnimationState();
    expect(state.xRange).toEqual({ from: 0, to: 1000 });
    expect(state.yRange).toEqual({ min: 0, max: 100 });
    expect(engine.getTarget().x).toEqual({ from: 0, to: 1000 });
    expect(engine.getTarget().y).toEqual({ min: 0, max: 100 });
  });

  it('onPointAppended pulls both targets from the callbacks and stores them', () => {
    const nextX: VisibleRange = { from: 100, to: 1100 };
    const nextY: YRange = { min: 0, max: 200 };
    const { engine, computeXTarget, computeYTarget } = setup({ nextX, nextY });

    engine.onPointAppended();

    expect(computeXTarget).toHaveBeenCalledTimes(1);
    expect(computeYTarget).toHaveBeenCalledTimes(1);
    expect(computeYTarget).toHaveBeenCalledWith({ xTarget: nextX });
    expect(engine.getTarget().x).toEqual(nextX);
    expect(engine.getTarget().y).toEqual(nextY);
  });

  it('onSeriesVisibilityChanged calls only computeYTarget, X stays put', () => {
    const nextY: YRange = { min: 5, max: 50 };
    const { engine, computeXTarget, computeYTarget } = setup({ nextY });

    engine.onSeriesVisibilityChanged();

    expect(computeXTarget).not.toHaveBeenCalled();
    expect(computeYTarget).toHaveBeenCalledTimes(1);
    expect(engine.getTarget().y).toEqual(nextY);
    expect(engine.getTarget().x).toEqual({ from: 0, to: 1000 });
  });

  it('onPanZoom takes xTarget directly; yAuto:true also pulls Y', () => {
    const nextY: YRange = { min: -10, max: 90 };
    const { engine, computeXTarget, computeYTarget } = setup({ nextY });

    const xTarget: VisibleRange = { from: 500, to: 1500 };
    engine.onPanZoom({ xTarget, yAuto: true });

    expect(computeXTarget).not.toHaveBeenCalled(); // chart supplies X directly
    expect(computeYTarget).toHaveBeenCalledTimes(1);
    expect(computeYTarget).toHaveBeenCalledWith({ xTarget });
    expect(engine.getTarget().x).toEqual(xTarget);
    expect(engine.getTarget().y).toEqual(nextY);
  });

  it('onPanZoom without yAuto leaves Y target untouched', () => {
    const { engine, computeYTarget } = setup({ nextY: { min: -100, max: 100 } });
    engine.onPanZoom({ xTarget: { from: 1, to: 2 } });
    expect(computeYTarget).not.toHaveBeenCalled();
    expect(engine.getTarget().y).toEqual({ min: 0, max: 100 }); // initial Y
  });

  it('snap sets the target instantly without invoking computeY/computeX', () => {
    const { engine, computeXTarget, computeYTarget } = setup({});
    engine.snap({ x: { from: 0, to: 50 }, y: { min: 10, max: 20 } });
    expect(computeXTarget).not.toHaveBeenCalled();
    expect(computeYTarget).not.toHaveBeenCalled();
    expect(engine.getTarget().x).toEqual({ from: 0, to: 50 });
    expect(engine.getTarget().y).toEqual({ min: 10, max: 20 });
  });
});

describe('ViewportEngine — X gesture lock-out', () => {
  const STREAM_X: VisibleRange = { from: 200, to: 1200 };
  const STREAM_Y: YRange = { min: 0, max: 50 };
  const GESTURE_X: VisibleRange = { from: 500, to: 1500 };

  it('absorbs the immediately-next onPointAppended after a gesture (100ms lockout window)', () => {
    const { engine, computeXTarget, computeYTarget } = setup({ nextX: STREAM_X, nextY: STREAM_Y });

    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 0);
    computeXTarget.mockClear();
    computeYTarget.mockClear();

    engine.onPointAppended(50);
    expect(computeXTarget).not.toHaveBeenCalled();
    expect(computeYTarget).not.toHaveBeenCalled();
    expect(engine.getTarget().x).toEqual(GESTURE_X);
  });

  it('releases lockout after the 100ms window', () => {
    const { engine, computeXTarget } = setup({ nextX: STREAM_X, nextY: STREAM_Y });

    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 0);
    computeXTarget.mockClear();

    engine.onPointAppended(110);
    expect(computeXTarget).toHaveBeenCalledTimes(1);
    expect(engine.getTarget().x).toEqual(STREAM_X);
  });

  it('repeated gestures extend the lockout deadline', () => {
    const { engine, computeXTarget } = setup({ nextX: STREAM_X, nextY: STREAM_Y });

    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 0);
    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 40);
    computeXTarget.mockClear();

    engine.onPointAppended(110);
    expect(computeXTarget).not.toHaveBeenCalled();

    engine.onPointAppended(150);
    expect(computeXTarget).toHaveBeenCalledTimes(1);
  });

  it('onProgrammaticZoom resets the lockout so the next stream tick goes through', () => {
    const { engine, computeXTarget } = setup({ nextX: STREAM_X, nextY: STREAM_Y });

    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 0);
    engine.onProgrammaticZoom({ xTarget: { from: 700, to: 1700 } }, 20);
    computeXTarget.mockClear();

    engine.onPointAppended(30);
    expect(computeXTarget).toHaveBeenCalledTimes(1);
  });

  it('snap resets the lockout', () => {
    const { engine, computeXTarget } = setup({ nextX: STREAM_X, nextY: STREAM_Y });

    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 0);
    engine.snap({ x: { from: 0, to: 100 } }, 20);
    computeXTarget.mockClear();

    engine.onPointAppended(30);
    expect(computeXTarget).toHaveBeenCalledTimes(1);
  });

  it('onDataReplaced bypasses lockout (exempt by design)', () => {
    const { engine, computeXTarget } = setup({ nextX: STREAM_X, nextY: STREAM_Y });

    engine.onPanZoom({ xTarget: GESTURE_X, yAuto: true }, 0);
    computeXTarget.mockClear();

    engine.onDataReplaced(30);
    expect(computeXTarget).toHaveBeenCalledTimes(1);
    expect(engine.getTarget().x).toEqual(STREAM_X);
  });
});
