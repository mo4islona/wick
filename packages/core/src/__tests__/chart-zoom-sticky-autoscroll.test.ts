/**
 * Sticky-follow zoom: while autoScroll is on, `chart.zoomAt` repositions the
 * new window so its right edge sits at `dataEnd + paddingRight` (follow
 * position). The cursor-anchored span from `computeZoom` is preserved, only
 * the position is locked to the tail — this avoids the next-stream-tick
 * offset clamp that would otherwise slide X left and produce a visible jump.
 *
 * When autoScroll is off (user previously panned away to inspect history),
 * `zoomAt` does NOT reanchor — cursor-anchored zoom works as usual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance, type ChartOptions } from '../chart';

const INTERVAL = 60_000;
const PADDING_BARS = 3;

function installRaf(): {
  flush: (frames?: number) => void;
  advance: (ms: number) => void;
  uninstall: () => void;
} {
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
    advance: (ms: number) => {
      now += ms;
    },
    uninstall: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancel;
      spy.mockRestore();
      queue = [];
    },
  };
}

function makeChart(extra: Partial<ChartOptions> = {}): { chart: ChartInstance; container: HTMLElement } {
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

  return { chart: new ChartInstance(container, { interactive: false, ...extra }), container };
}

function seedCandles(chart: ChartInstance, count: number, startTime = 1_000_000): { id: string; lastTime: number } {
  const id = chart.addCandlestickSeries();
  const data = Array.from({ length: count }, (_, i) => ({
    time: startTime + i * INTERVAL,
    open: 100,
    high: 105,
    low: 95,
    close: 101,
  }));
  chart.setSeriesData(id, data);

  return { id, lastTime: startTime + (count - 1) * INTERVAL };
}

describe('ChartInstance.zoomAt — sticky-follow when autoScroll=true', () => {
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

  it('after seed, autoScroll=true and right edge sits at lastTime + paddingRight', () => {
    const { lastTime } = seedCandles(chart, 20);
    const { to } = chart.getVisibleRange();

    expect(chart.getAutoScroll()).toBe(true);
    expect(to).toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);
  });

  it('zoom-in with cursor on tail keeps autoScroll=true and right edge pinned at follow-pos', () => {
    const { lastTime } = seedCandles(chart, 20);
    const { from: fromBefore, to: toBefore } = chart.getVisibleRange();
    const spanBefore = toBefore - fromBefore;

    chart.zoomAt(lastTime, 0.5);

    const { from, to } = chart.getVisibleRange();
    const span = to - from;
    expect(chart.getAutoScroll()).toBe(true);
    expect(to).toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);
    expect(span).toBeLessThan(spanBefore);
  });

  it('zoom-in with cursor deep in history STILL pins right edge to follow-pos (sticky overrides cursor)', () => {
    const { lastTime } = seedCandles(chart, 20);
    const startTime = lastTime - 19 * INTERVAL;
    const { from: fromBefore, to: toBefore } = chart.getVisibleRange();
    const spanBefore = toBefore - fromBefore;

    chart.zoomAt(startTime + 2 * INTERVAL, 0.5);

    const { from, to } = chart.getVisibleRange();
    const span = to - from;
    expect(chart.getAutoScroll()).toBe(true);
    expect(to).toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);
    expect(span).toBeLessThan(spanBefore);
  });

  it('zoom-out keeps autoScroll=true and right edge pinned at follow-pos', () => {
    const { lastTime } = seedCandles(chart, 200);
    // Narrow the window so zoom-out has room (and tail in window → autoScroll stays true).
    chart.setVisibleRange({ from: lastTime - 19 * INTERVAL, to: lastTime + PADDING_BARS * INTERVAL });
    expect(chart.getAutoScroll()).toBe(true);
    const { from: fromBefore, to: toBefore } = chart.getVisibleRange();
    const spanBefore = toBefore - fromBefore;

    chart.zoomAt(lastTime, 1.5);

    const { from, to } = chart.getVisibleRange();
    const span = to - from;
    expect(chart.getAutoScroll()).toBe(true);
    expect(to).toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);
    expect(span).toBeGreaterThan(spanBefore);
  });

  it('successive zoom-in events keep right edge prepinned (no drift, no autoScroll flip)', () => {
    const { lastTime } = seedCandles(chart, 30);
    const target = lastTime + PADDING_BARS * INTERVAL;

    for (let i = 0; i < 5; i++) {
      chart.zoomAt(lastTime, 0.8);
      expect(chart.getAutoScroll()).toBe(true);
      expect(chart.getVisibleRange().to).toBeCloseTo(target, -1);
    }
  });

  it('zoom while autoScroll=true then append: streaming X advances to new tail (no clamp slide)', () => {
    const { id, lastTime: seedLast } = seedCandles(chart, 20);
    let lastTime = seedLast;

    chart.zoomAt(lastTime, 0.7);
    const toAfterZoom = chart.getVisibleRange().to;
    expect(toAfterZoom).toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);

    // Step past the ViewportEngine gesture lock-out (~100ms) so the next
    // appendData's onPointAppended is allowed to retarget.
    raf.advance(150);

    lastTime += INTERVAL;
    chart.appendData(id, { time: lastTime, open: 101, high: 106, low: 100, close: 105 });
    raf.flush(40);

    const { to } = chart.getVisibleRange();
    expect(to).toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);
    expect(to - toAfterZoom).toBeCloseTo(INTERVAL, -1);
  });
});

describe('ChartInstance.zoomAt — autoScroll=false (inspect mode)', () => {
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

  it('after setVisibleRange far from tail, autoScroll=false', () => {
    const { lastTime } = seedCandles(chart, 60);
    const startTime = lastTime - 59 * INTERVAL;

    chart.setVisibleRange({ from: startTime, to: startTime + 10 * INTERVAL });

    expect(chart.getAutoScroll()).toBe(false);
  });

  it('zoom in inspect mode does NOT re-arm autoScroll and does NOT pin to tail', () => {
    const { lastTime } = seedCandles(chart, 200);
    const startTime = lastTime - 199 * INTERVAL;
    // Inspect window: 30 bars in the middle of history, far from tail.
    chart.setVisibleRange({ from: startTime + 50 * INTERVAL, to: startTime + 80 * INTERVAL });
    expect(chart.getAutoScroll()).toBe(false);

    const cursor = startTime + 65 * INTERVAL;
    chart.zoomAt(cursor, 0.8);

    const { to } = chart.getVisibleRange();
    expect(chart.getAutoScroll()).toBe(false);
    // Sticky NOT applied: right edge stays in history, not snapped to dataEnd + pr.
    expect(to).toBeLessThan(lastTime);
    expect(to).not.toBeCloseTo(lastTime + PADDING_BARS * INTERVAL, -1);
  });
});
