/**
 * Gesture priority on the X slot + autoscroll re-engagement off bridge's
 * logical lastXTarget. The legacy `cancelEntranceAnimations`-on-interact
 * regression covered by this file is gone with Phase 3 (entrance state
 * moved to AnimationEngine — gestures don't touch it).
 */
import { describe, expect, it } from 'vitest';

import { ChartInstance } from '../chart';

/**
 * Gesture priority on the X slot. The engine's per-kind priority is
 * `gesture (3) > data_tick (1)`; a pan committed mid-streaming must take
 * the X slot away from any in-flight data_tick claim and ease the visual
 * to the gesture's logical destination rather than the streaming target.
 */
describe('gesture priority on the X slot', () => {
  function makeChartWithSize(): ChartInstance {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(container);

    return new ChartInstance(container, { animations: { axis: { x: { gesture: 0 } } } });
  }

  it('pan during a streaming append commits logical to the pan destination, not the stream target', () => {
    const INTERVAL = 60_000;
    const chart = makeChartWithSize();
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 20 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 10 + i })),
    );

    const beforePanLogical = { ...chart.getVisibleRange() };

    // Streaming append — chart emits data_tick X targeting `lastTime + 3
    // INTERVAL`. With gesture preempting, the pan target overrides it.
    chart.appendData(id, { time: 1_000_000 + 20 * INTERVAL, value: 30 });
    // User pan a few intervals left.
    chart.pan(-2 * INTERVAL, 800);

    // viewport.logicalRange reflects the gesture commit; bridge.lastXTarget
    // matches, and chart.getVisibleRange (engine visual) snaps to it
    // because gestureMs=0 → engine zero-duration guard. The pan shifted
    // *backward* — if the data_tick had won the X slot, `from` would have
    // moved *forward* by the streaming pin offset, never below the
    // pre-pan logical.
    const after = chart.getVisibleRange();
    expect(after.from).toBeLessThan(beforePanLogical.from);
  });

  it('pan toggles autoScroll off when the gesture pushes dataEnd off-screen', () => {
    const INTERVAL = 60_000;
    const chart = makeChartWithSize();
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 20 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 10 + i })),
    );

    expect(chart.getAutoScroll()).toBe(true);

    // Pan left far enough that the last data point falls off the right edge.
    chart.pan(-30 * INTERVAL, 800);

    expect(chart.getAutoScroll()).toBe(false);
  });
});

/**
 * Autoscroll re-engagement reads the bridge's *logical* lastXTarget, not
 * the eased visual. A pan that brings the logical destination back over
 * dataEnd flips autoScroll back on; otherwise streaming would stay
 * disabled even though the user clearly returned to the live tail.
 */
describe('autoscroll re-engagement reads logical, not visual', () => {
  function makeChartWithSize(): ChartInstance {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(container);

    return new ChartInstance(container, { animations: { axis: { x: { gesture: 0 } } } });
  }

  it('pan back over dataEnd re-engages autoScroll the next renderMain tick', () => {
    const INTERVAL = 60_000;
    const chart = makeChartWithSize();
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 20 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 10 + i })),
    );

    // Pan off-tail: autoScroll flips false.
    chart.pan(-30 * INTERVAL, 800);
    expect(chart.getAutoScroll()).toBe(false);

    // Pan back so the live tail is inside the logical range again.
    chart.pan(30 * INTERVAL, 800);

    // Pan itself already re-arms autoScroll inside chart.pan when the last
    // data point is back in view. The renderMain per-frame check covers
    // the streaming-tick-brings-dataEnd-back case (exercised separately
    // in chart-streaming-autoscroll).
    expect(chart.getAutoScroll()).toBe(true);
  });
});
