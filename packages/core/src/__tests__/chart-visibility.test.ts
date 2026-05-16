import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChartInstance } from '../chart';

/**
 * `setSeriesVisible` / `isSeriesVisible` cover whole-series toggling — the
 * counterpart to `setLayerVisible` / `isLayerVisible` (which operates on one
 * layer within a multi-layer series). The existing React `visibility-batch`
 * integration test covers the layer path; this file closes the gap on the
 * whole-series path.
 *
 * Named `chart-*` so `environmentMatchGlobs` hands this file a DOM.
 */

function makeChart(): { chart: ChartInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const width = 800;
  const height = 400;
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, width, height, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);
  // Disable visibility fade so `setSeriesVisible` snaps the Y range and
  // assertions can read the post-toggle state without driving frames.
  // The fade itself is exercised in `chart-y-range-animator.test.ts`.
  return {
    chart: new ChartInstance(container, {
      interactive: false,
      animations: { y: { visibility: 0 } },
    }),
    container,
  };
}

describe('ChartInstance.setSeriesVisible (whole-series toggle)', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('isSeriesVisible returns true by default for a newly added series', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [{ time: 1, value: 10 }]);
    expect(chart.isSeriesVisible(id)).toBe(true);
  });

  it('setSeriesVisible(id, false) excludes the series from the Y-range', () => {
    const small = chart.addLineSeries();
    const big = chart.addLineSeries();
    chart.setSeriesData(small, [
      { time: 1, value: 1 },
      { time: 2, value: 5 },
    ]);
    chart.setSeriesData(big, [
      { time: 1, value: 100 },
      { time: 2, value: 500 },
    ]);
    const combinedMax = chart.getYRange().max;
    expect(combinedMax).toBeGreaterThanOrEqual(500);

    chart.setSeriesVisible(big, false);
    expect(chart.isSeriesVisible(big)).toBe(false);

    const reducedMax = chart.getYRange().max;
    // With the `big` series hidden, the Y-range collapses to the `small`
    // series domain (1..5 with padding) — far below the combined range.
    expect(reducedMax).toBeLessThan(combinedMax);
    expect(reducedMax).toBeLessThanOrEqual(10);
  });

  it('re-showing a hidden series restores it to the Y-range', () => {
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    chart.setSeriesData(a, [{ time: 1, value: 10 }]);
    chart.setSeriesData(b, [{ time: 1, value: 1000 }]);
    const fullMax = chart.getYRange().max;

    chart.setSeriesVisible(b, false);
    const reducedMax = chart.getYRange().max;
    expect(reducedMax).toBeLessThan(fullMax);

    chart.setSeriesVisible(b, true);
    expect(chart.isSeriesVisible(b)).toBe(true);
    // Range fully restored to accommodate the 1000-max series again.
    expect(chart.getYRange().max).toBeGreaterThanOrEqual(1000);
  });

  it('hiding a series that is already hidden is a no-op (no state change)', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [{ time: 1, value: 10 }]);
    chart.setSeriesVisible(id, false);
    const afterFirstHide = chart.getYRange();

    chart.setSeriesVisible(id, false);
    const afterSecondHide = chart.getYRange();

    expect(afterSecondHide).toEqual(afterFirstHide);
    expect(chart.isSeriesVisible(id)).toBe(false);
  });

  it('setLayerVisible on a single-layer series is ignored (use setSeriesVisible instead)', () => {
    // Candlestick renderer has layerCount === 1; the public API refuses to
    // toggle per-layer visibility on it to keep "layer" a multi-layer concept.
    const id = chart.addCandlestickSeries();
    chart.setSeriesData(id, [
      { time: 1, open: 10, high: 12, low: 8, close: 11 },
      { time: 2, open: 11, high: 14, low: 10, close: 13 },
    ]);
    const beforeMax = chart.getYRange().max;

    chart.setLayerVisible(id, 0, false);

    // The candle remains visible and in the Y-range — the call was a no-op.
    expect(chart.getYRange().max).toBe(beforeMax);
    expect(chart.isSeriesVisible(id)).toBe(true);
  });
});
