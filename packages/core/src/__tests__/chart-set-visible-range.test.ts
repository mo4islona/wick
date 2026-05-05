/**
 * ChartInstance.setVisibleRange — public imperative API for setting the
 * visible time range.
 *
 * Covers both forms: explicit `{ from, to }` and shorthand bar-count.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChartInstance } from '../chart';

const INTERVAL = 60_000;

function makeChart(): { chart: ChartInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const rect: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 400,
    right: 800,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  };
  container.getBoundingClientRect = () => rect;
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  document.body.appendChild(container);

  return { chart: new ChartInstance(container, { interactive: false }), container };
}

function seedCandles(chart: ChartInstance, count: number, startTime = 1_000_000): string {
  const id = chart.addCandlestickSeries();
  const data = Array.from({ length: count }, (_, i) => ({
    time: startTime + i * INTERVAL,
    open: 100,
    high: 105,
    low: 95,
    close: 101,
  }));
  chart.setSeriesData(id, data);

  return id;
}

describe('ChartInstance.setVisibleRange', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('explicit {from, to} — applies exactly what was passed', () => {
    seedCandles(chart, 50);
    const start = 1_000_000;

    chart.setVisibleRange({ from: start + 10 * INTERVAL, to: start + 30 * INTERVAL });

    const { from, to } = chart.getVisibleRange();
    expect(from).toBe(start + 10 * INTERVAL);
    expect(to).toBe(start + 30 * INTERVAL);
  });

  it('rejects invalid ranges (to <= from) silently', () => {
    seedCandles(chart, 50);
    const before = { ...chart.getVisibleRange() };

    chart.setVisibleRange({ from: 5000, to: 1000 });
    chart.setVisibleRange({ from: 5000, to: 5000 });

    expect(chart.getVisibleRange()).toEqual(before);
  });

  it('rejects non-finite bounds silently (NaN / Infinity)', () => {
    seedCandles(chart, 50);
    const before = { ...chart.getVisibleRange() };

    chart.setVisibleRange({ from: Number.NaN, to: 1000 });
    chart.setVisibleRange({ from: 0, to: Number.POSITIVE_INFINITY });
    chart.setVisibleRange({ from: Number.NEGATIVE_INFINITY, to: 0 });

    expect(chart.getVisibleRange()).toEqual(before);
  });

  it('rejects ranges spanning fewer than 2 bars without flipping auto-scroll', () => {
    seedCandles(chart, 50);
    const start = 1_000_000;

    // Pan to a range where the tail is off-screen so auto-scroll goes false.
    chart.setVisibleRange({ from: start + 5 * INTERVAL, to: start + 25 * INTERVAL });
    const before = { ...chart.getVisibleRange() };

    // Sub-2-bar range — should be a true no-op (range unchanged, auto-scroll
    // not silently flipped back on).
    chart.setVisibleRange({ from: 0, to: INTERVAL });

    expect(chart.getVisibleRange()).toEqual(before);
  });

  it('number form — shows the last N bars', () => {
    seedCandles(chart, 200);
    const lastTime = 1_000_000 + 199 * INTERVAL;

    chart.setVisibleRange(50);

    const { from, to } = chart.getVisibleRange();
    // Right edge pinned near the tail (fitToData adds right-padding).
    expect(to).toBeGreaterThanOrEqual(lastTime);
    // Visible span covers roughly 50 bars of data (padding slightly inflates).
    const visibleBars = (to - from) / INTERVAL;
    expect(visibleBars).toBeGreaterThanOrEqual(50);
    expect(visibleBars).toBeLessThanOrEqual(60);
  });

  it('number form — no-ops when there is no data yet', () => {
    const before = { ...chart.getVisibleRange() };

    chart.setVisibleRange(120);

    expect(chart.getVisibleRange()).toEqual(before);
  });

  it('number form — rejects invalid N (0, negative, NaN, Infinity, non-integer)', () => {
    seedCandles(chart, 200);
    const before = { ...chart.getVisibleRange() };

    const invalid = [0, 1, -10, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const n of invalid) {
      chart.setVisibleRange(n);
      expect(chart.getVisibleRange(), `N=${n} should be a no-op`).toEqual(before);
    }
  });

  it('number form — clamps when N exceeds available bars', () => {
    seedCandles(chart, 30);

    chart.setVisibleRange(500);

    const { from, to } = chart.getVisibleRange();
    const visibleBars = (to - from) / INTERVAL;
    // Can't show more than what exists — should cover the 30 bars (+padding).
    expect(visibleBars).toBeLessThan(40);
  });

  it('idempotent — re-setting the current range emits no viewportChange', () => {
    seedCandles(chart, 50);
    const start = 1_000_000;
    const range = { from: start + 10 * INTERVAL, to: start + 30 * INTERVAL };

    chart.setVisibleRange(range);

    // Now subscribe AFTER the initial set — we only want to observe whether
    // a redundant setVisibleRange re-emits.
    let emitCount = 0;
    const onChange = () => {
      emitCount += 1;
    };
    chart.on('viewportChange', onChange);

    chart.setVisibleRange({ ...range });
    chart.setVisibleRange({ from: range.from, to: range.to });

    chart.off('viewportChange', onChange);

    expect(emitCount).toBe(0);
    expect(chart.getVisibleRange()).toEqual(range);
  });

  it('idempotent — two mutually-syncing charts terminate without a guard', () => {
    // Regression: the multi-chart-sync demo previously needed a `last` ref
    // to break the feedback loop because setVisibleRange always emitted
    // viewportChange. With idempotency, the receiver's echo back to the
    // sender is a no-op (sender already has that exact range), so naive
    // bidirectional binding terminates on its own.
    const { chart: chartB, container: containerB } = makeChart();
    seedCandles(chart, 50);
    seedCandles(chartB, 50);
    const start = 1_000_000;

    let emitsA = 0;
    let emitsB = 0;
    const onA = () => {
      emitsA += 1;
      chartB.setVisibleRange(chart.getVisibleRange());
    };
    const onB = () => {
      emitsB += 1;
      chart.setVisibleRange(chartB.getVisibleRange());
    };

    chart.on('viewportChange', onA);
    chartB.on('viewportChange', onB);

    chart.setVisibleRange({ from: start + 10 * INTERVAL, to: start + 30 * INTERVAL });

    chart.off('viewportChange', onA);
    chartB.off('viewportChange', onB);
    chartB.destroy();
    containerB.remove();

    // A fires once for the initial user set, B fires once for the receiver
    // applying it. The echoes (B → A → B → ...) are killed by idempotency.
    expect(emitsA).toBe(1);
    expect(emitsB).toBe(1);
    expect(chart.getVisibleRange()).toEqual(chartB.getVisibleRange());
  });
});
