/**
 * ChartInstance.setCrosshair — public imperative API for driving the
 * crosshair without a real pointer event. Backs the cross-chart hover
 * pattern (one chart's hover broadcasts a synthetic crosshair to peers).
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

describe('ChartInstance.setCrosshair', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('sets the crosshair from a time and emits crosshairMove', () => {
    seedCandles(chart, 50);
    const start = 1_000_000;

    let received: ReturnType<typeof chart.getCrosshairPosition> | undefined;
    chart.on('crosshairMove', (pos) => {
      received = pos;
    });

    chart.setCrosshair({ time: start + 10 * INTERVAL });

    const pos = chart.getCrosshairPosition();
    expect(pos).not.toBeNull();
    expect(pos?.time).toBe(start + 10 * INTERVAL);
    expect(received).toEqual(pos);
  });

  it('clears with null', () => {
    seedCandles(chart, 50);
    chart.setCrosshair({ time: 1_000_000 + 5 * INTERVAL });
    expect(chart.getCrosshairPosition()).not.toBeNull();

    let cleared = false;
    chart.on('crosshairMove', (pos) => {
      if (pos === null) cleared = true;
    });

    chart.setCrosshair(null);

    expect(chart.getCrosshairPosition()).toBeNull();
    expect(cleared).toBe(true);
  });

  it('idempotent — re-setting the same (time, y) emits nothing', () => {
    seedCandles(chart, 50);
    const start = 1_000_000;

    chart.setCrosshair({ time: start + 10 * INTERVAL, y: 100 });

    let emitCount = 0;
    chart.on('crosshairMove', () => {
      emitCount += 1;
    });

    chart.setCrosshair({ time: start + 10 * INTERVAL, y: 100 });
    chart.setCrosshair({ time: start + 10 * INTERVAL, y: 100 });

    expect(emitCount).toBe(0);
  });

  it('idempotent — re-clearing emits nothing', () => {
    let emitCount = 0;
    chart.on('crosshairMove', () => {
      emitCount += 1;
    });

    chart.setCrosshair(null);
    chart.setCrosshair(null);

    expect(emitCount).toBe(0);
  });

  it('rejects non-finite time', () => {
    seedCandles(chart, 50);

    let emitCount = 0;
    chart.on('crosshairMove', () => {
      emitCount += 1;
    });

    chart.setCrosshair({ time: Number.NaN });
    chart.setCrosshair({ time: Number.POSITIVE_INFINITY });

    expect(emitCount).toBe(0);
    expect(chart.getCrosshairPosition()).toBeNull();
  });

  it('rejects non-finite y when explicitly provided', () => {
    seedCandles(chart, 50);
    const start = 1_000_000;

    let emitCount = 0;
    chart.on('crosshairMove', () => {
      emitCount += 1;
    });

    chart.setCrosshair({ time: start + 5 * INTERVAL, y: Number.NaN });
    chart.setCrosshair({ time: start + 5 * INTERVAL, y: Number.POSITIVE_INFINITY });
    chart.setCrosshair({ time: start + 5 * INTERVAL, y: Number.NEGATIVE_INFINITY });

    expect(emitCount).toBe(0);
    expect(chart.getCrosshairPosition()).toBeNull();
  });

  it('preserves current y when caller omits it — keeps source-chart tooltip stable under broadcast echoes', () => {
    // Regression: when the user hovers chart A (real cursor y_A) and a peer
    // chart's HoverBridge echoes setCrosshair({ time }) back to A, we must
    // preserve A's real y instead of falling back to the Y-range midpoint.
    // Otherwise A's tooltip would jitter between cursor y and midpoint as
    // every mouse move triggers an echo overwrite.
    seedCandles(chart, 50);
    const start = 1_000_000;

    // Simulate "user hovers A" with a real (time, y_real).
    chart.setCrosshair({ time: start + 10 * INTERVAL, y: 137 });

    let emitCount = 0;
    chart.on('crosshairMove', () => {
      emitCount += 1;
    });

    // Echo from a peer: only the time, no y.
    chart.setCrosshair({ time: start + 10 * INTERVAL });

    // y_real must be preserved → idempotent → no emit, no overwrite.
    expect(emitCount).toBe(0);
    expect(chart.getCrosshairPosition()?.y).toBe(137);
  });

  it('two charts mutually broadcasting via setCrosshair terminate without a guard', () => {
    // Regression: with idempotency, the cross-chart hover pattern (each chart's
    // crosshairMove forwarded to the peer via setCrosshair) terminates on its
    // own — the peer's echo back is a no-op because the source already has
    // that exact (time, y).
    const { chart: chartB, container: containerB } = makeChart();
    seedCandles(chart, 50);
    seedCandles(chartB, 50);
    const start = 1_000_000;

    let emitsA = 0;
    let emitsB = 0;
    const onA = (pos: ReturnType<typeof chart.getCrosshairPosition>) => {
      emitsA += 1;
      chartB.setCrosshair(pos ? { time: pos.time, y: pos.y } : null);
    };
    const onB = (pos: ReturnType<typeof chartB.getCrosshairPosition>) => {
      emitsB += 1;
      chart.setCrosshair(pos ? { time: pos.time, y: pos.y } : null);
    };

    chart.on('crosshairMove', onA);
    chartB.on('crosshairMove', onB);

    chart.setCrosshair({ time: start + 10 * INTERVAL, y: 100 });

    chart.off('crosshairMove', onA);
    chartB.off('crosshairMove', onB);
    chartB.destroy();
    containerB.remove();

    // A fires once (the initial set), B fires once (receiving). The echoes
    // (B → A → B → ...) die at idempotency.
    expect(emitsA).toBe(1);
    expect(emitsB).toBe(1);
    expect(chart.getCrosshairPosition()?.time).toBe(chartB.getCrosshairPosition()?.time);
  });
});
