/**
 * Part 1 regression: user-initiated pan/zoom used to fire a synthetic
 * `interact` handler on chart.ts that called `cancelEntranceAnimations()`
 * on every renderer, making last-point tweens snap mid-flight. That handler
 * is gone; this test asserts:
 *   - the chart does NOT subscribe to the viewport's `interact` event, and
 *   - a pan emission leaves per-renderer entrance entries intact.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChartInstance } from '../chart';
import { getChartViewportForTest } from '../internal/test-handles';
import type { CandlestickRenderer } from '../series/candlestick';
import type { LineRenderer } from '../series/line';

function makeChart(): ChartInstance {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;

  return new ChartInstance(container);
}

describe('entrance animations survive pan/zoom gestures', () => {
  it('candlestick entries persist when the viewport emits interact', () => {
    const chart = makeChart();
    const id = chart.addCandlestickSeries();
    const renderer = (
      chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: CandlestickRenderer }> }
    )
      .listSeriesForTest()
      .find((s) => s.id === id)!.renderer;

    renderer.setData([{ time: 10, open: 10, high: 12, low: 9, close: 11 }]);
    renderer.appendPoint({ time: 20, open: 10, high: 12, low: 9, close: 11 });
    expect(renderer.needsAnimation).toBe(true);

    // Guard: if the chart re-wires a cancel-on-interact listener the spy fires.
    const cancelSpy = vi.spyOn(renderer, 'cancelEntranceAnimations');
    getChartViewportForTest(chart).pan(1, 800);

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(renderer.needsAnimation).toBe(true);
  });

  it('line renderer retains its trailing entrance entry across a pan', () => {
    const chart = makeChart();
    const id = chart.addLineSeries();
    const renderer = (chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: LineRenderer }> })
      .listSeriesForTest()
      .find((s) => s.id === id)!.renderer;

    renderer.setData([
      { time: 10, value: 5 },
      { time: 20, value: 6 },
    ]);
    renderer.appendPoint({ time: 30, value: 8 });

    getChartViewportForTest(chart).pan(1, 800);

    const entries = (renderer as unknown as { entries: Array<Map<number, unknown>> }).entries;
    expect(entries[0].has(30)).toBe(true);
    expect(renderer.needsAnimation).toBe(true);
  });
});

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
      ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(container);

    return new ChartInstance(container, { animations: { x: { gesture: 0 } } });
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
    getChartViewportForTest(chart).pan(-2 * INTERVAL, 800);

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

    const viewport = getChartViewportForTest(chart);
    expect(viewport.autoScroll).toBe(true);

    // Pan left far enough that the last data point falls off the right edge.
    viewport.pan(-30 * INTERVAL, 800);

    expect(viewport.autoScroll).toBe(false);
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
      ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(container);

    return new ChartInstance(container, { animations: { x: { gesture: 0 } } });
  }

  it('pan back over dataEnd re-engages autoScroll the next renderMain tick', () => {
    const INTERVAL = 60_000;
    const chart = makeChartWithSize();
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 20 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 10 + i })),
    );

    const viewport = getChartViewportForTest(chart);

    // Pan off-tail: autoScroll flips false.
    viewport.pan(-30 * INTERVAL, 800);
    expect(viewport.autoScroll).toBe(false);

    // Pan back so the live tail is inside the logical range again.
    viewport.pan(30 * INTERVAL, 800);

    // Pan itself already re-arms autoScroll inside viewport.pan when the
    // last data point is back in view. The AutoscrollController's per-frame
    // check is for the streaming-tick-brings-dataEnd-back case — that
    // path is exercised separately in chart-streaming-autoscroll.
    expect(viewport.autoScroll).toBe(true);
  });
});
