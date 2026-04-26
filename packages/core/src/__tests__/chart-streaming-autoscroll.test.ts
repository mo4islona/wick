/**
 * Integration regression for "candlestick page stops following the last point".
 *
 * Drives ChartInstance with realistic streaming shapes (appendPoint + updateLast)
 * and asserts the visible range's right edge keeps pinning to the latest bar.
 *
 * Uses a manual RAF stub so scroll-to-end animations advance deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance } from '../chart';

const INTERVAL = 60_000;

function installRaf(): { flush: (frames?: number) => void; uninstall: () => void } {
  let nextId = 1;
  let now = 0;
  let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  const origRaf = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    queue = queue.filter((f) => f.id !== id);
  };

  const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);

  return {
    flush: (frames = 20) => {
      for (let i = 0; i < frames; i++) {
        if (queue.length === 0) return;
        const pending = queue;
        queue = [];
        now += 16;
        for (const f of pending) f.cb(now);
      }
    },
    uninstall: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancel;
      spy.mockRestore();
      queue = [];
    },
  };
}

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

describe('ChartInstance — streaming auto-scroll (candlestick regression)', () => {
  let chart: ChartInstance;
  let container: HTMLElement;
  let raf: ReturnType<typeof installRaf>;

  beforeEach(() => {
    raf = installRaf();
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
    raf.uninstall();
  });

  it('seed via setSeriesData places the right edge at last + right padding', () => {
    const id = seedCandles(chart, 20);
    const lastTime = 1_000_000 + 19 * INTERVAL;
    const { to } = chart.getVisibleRange();

    expect(to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
    expect(chart.getLastData(id)).toMatchObject({ time: lastTime });
  });

  it('a single appendData advances the right edge past the previous boundary', () => {
    const id = seedCandles(chart, 20);
    let lastTime = 1_000_000 + 19 * INTERVAL;
    const { to: toBefore } = chart.getVisibleRange();

    lastTime += INTERVAL;
    chart.appendData(id, { time: lastTime, open: 101, high: 106, low: 100, close: 105 });
    raf.flush(20);

    const { to } = chart.getVisibleRange();
    expect(to).toBeGreaterThan(toBefore);
    expect(to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('30 successive appendData calls (each before the prior animation ends) keep the tail pinned', () => {
    const id = seedCandles(chart, 20);
    let lastTime = 1_000_000 + 19 * INTERVAL;

    for (let i = 0; i < 30; i++) {
      lastTime += INTERVAL;
      chart.appendData(id, { time: lastTime, open: 101, high: 106, low: 100, close: 105 });
      raf.flush(1); // only one frame — simulates ticks arriving mid-animation
    }
    // Drain the last animation.
    raf.flush(20);

    const { to } = chart.getVisibleRange();
    expect(to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('burst of 8 appends BEFORE the first RAF tick still tracks all bars (isLastPointVisible bug)', () => {
    // Regression: OHLCStream emits ~8 new candles per 500ms real tick (when
    // virtualNow crosses 8 interval boundaries). The React wrapper loops
    // appendData 8× synchronously. Each call triggers onDataChanged which
    // gated scrollToEnd on isLastPointVisible() — but visibleRange.to hadn't
    // updated yet (no RAF tick between appends), so from the 4th bar onward
    // last.time > visibleRange.to and scrollToEnd silently stopped firing.
    // Fix: gate on viewport.autoScroll instead.
    const id = seedCandles(chart, 20);
    let lastTime = 1_000_000 + 19 * INTERVAL;

    // 8 new bars in a synchronous burst — no RAF runs in between.
    for (let i = 0; i < 8; i++) {
      lastTime += INTERVAL;
      chart.appendData(id, { time: lastTime, open: 101, high: 106, low: 100, close: 105 });
    }
    raf.flush(30);

    // Right edge must have caught up to the LAST bar in the burst, not the
    // 3rd bar where isLastPointVisible last returned true.
    const { to } = chart.getVisibleRange();
    expect(to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('streaming from a SINGLE seed point grows the viewport instead of scrolling existing points off-screen', () => {
    // Bug regression: when a chart starts with 1 candle and points arrive one
    // at a time, the viewport used to keep its initial 3-bar width and slide
    // the right edge with every tick — pushing the seed point off the left
    // edge and leaving "always exactly one point visible". Expected behaviour
    // is to grow the viewport (zoom out) until the data fills the natural
    // fit-to-data window before scrolling kicks in.
    const startTime = 1_000_000;
    const id = seedCandles(chart, 1, startTime);
    raf.flush(20);

    let lastTime = startTime;
    for (let i = 1; i <= 10; i++) {
      lastTime = startTime + i * INTERVAL;
      chart.appendData(id, { time: lastTime, open: 101, high: 106, low: 100, close: 105 });
      raf.flush(5);
    }

    const { from, to } = chart.getVisibleRange();

    expect(from).toBeLessThanOrEqual(startTime);
    expect(to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('updateData bursts on the same bar do NOT lose the right-edge pin', () => {
    const id = seedCandles(chart, 20);
    const lastTime = 1_000_000 + 19 * INTERVAL;
    const { to: toBefore } = chart.getVisibleRange();

    for (let i = 0; i < 50; i++) {
      chart.updateData(id, {
        time: lastTime,
        open: 100,
        high: 108 + i * 0.01,
        low: 95,
        close: 102 + i * 0.01,
      });
    }
    raf.flush(10);

    const { to } = chart.getVisibleRange();
    expect(to).toBeCloseTo(toBefore, -1);
  });
});
