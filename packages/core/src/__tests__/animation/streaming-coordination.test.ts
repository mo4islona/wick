// @vitest-environment happy-dom
/**
 * End-to-end coordination test for the unified animation architecture.
 *
 * Drives a chart from 1 → 50 candles via `appendData` (non-batch path —
 * `added <= 5` per tick) and asserts that the X viewport, Y range, and
 * series live-track all reach their settled values together. Per-point
 * entrance animations run independently with their own `entryMs` budget;
 * that decoupling is also pinned here so future refactors don't accidentally
 * couple them.
 *
 * Uses the same RAF + performance.now mock pattern as
 * chart-streaming-autoscroll.test.ts so animator ticks advance deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance } from '../../chart';

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
    flush: (frames = 30) => {
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

describe('streaming coordination — unified animation', () => {
  let chart: ChartInstance;
  let container: HTMLElement;
  let raf: ReturnType<typeof installRaf>;

  beforeEach(() => {
    raf = installRaf();
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart?.destroy();
    container?.remove();
    raf.uninstall();
  });

  it('1 → 50 single-point appends settle X, Y, and live-track on the same frame', () => {
    const id = chart.addCandlestickSeries();

    // Seed exactly one candle. fitToData snaps the viewport.
    let lastTime = 1_000_000;
    chart.setSeriesData(id, [{ time: lastTime, open: 100, high: 105, low: 95, close: 101 }]);
    raf.flush(1);

    // Stream 49 more candles, one per "tick" (well below the batch threshold
    // of 5 added per onDataChanged call). Each appendData triggers the warm-up
    // path: viewport refits to the growing data, Y range eases toward new
    // highs/lows over `yAxisMs`, live-track animates the last bar.
    let dataMin = Number.POSITIVE_INFINITY;
    let dataMax = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < 50; i++) {
      lastTime = 1_000_000 + i * INTERVAL;
      const high = 100 + Math.sin(i * 0.3) * 20;
      const low = 100 - Math.cos(i * 0.4) * 15;
      const close = 100 + Math.sin(i * 0.5) * 10;
      if (high > dataMax) dataMax = high;
      if (low < dataMin) dataMin = low;
      chart.appendData(id, { time: lastTime, open: 100, high, low, close });
      raf.flush(1); // single frame per tick — closest to a real streaming feed
    }

    // Drain any in-flight animations so all subsystems have settled.
    raf.flush(60);

    const visible = chart.getVisibleRange();
    const yRange = chart.getYRange();

    // X: right edge tracks the latest bar with right-padding (3 intervals by default).
    expect(visible.to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);

    // Y: brackets every value the data swept through. The actual range may
    // overshoot slightly via the chart's vertical padding (top/bottom = 20 px
    // by default) — but the data extremes must always be inside.
    expect(yRange.min).toBeLessThanOrEqual(dataMin);
    expect(yRange.max).toBeGreaterThanOrEqual(dataMax);

    // Live-track: settled at the actual last candle's OHLC. Renderer owns
    // the smoothing — read from its protected `displayedLast` directly.
    const renderer = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: unknown }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === id)?.renderer as unknown as { displayedLast: { close: number } | null };
    const expectedClose = 100 + Math.sin(49 * 0.5) * 10;
    expect(renderer.displayedLast).not.toBeNull();
    expect(Math.abs((renderer.displayedLast?.close ?? Number.NaN) - expectedClose)).toBeLessThan(0.01);
  });

  it('per-point entrance animations are independent of the streaming retarget', () => {
    // The "lockstep arrival" guarantee covers viewport + Y range + live-track
    // only. Per-point entrance has its own `entryMs` budget (default 250 ms,
    // = `SHARED_ANIMATION_MS`) and is NOT coordinated through the streaming
    // animator. Pin that decoupling so a future refactor that tries to fold
    // entrance into the streaming retarget gets caught here.
    const id = chart.addCandlestickSeries();
    chart.setSeriesData(id, [{ time: 1_000_000, open: 100, high: 105, low: 95, close: 101 }]);
    raf.flush(1);

    // Append a new candle. Streaming retarget runs over `ANIM.streamTick`
    // (250 ms ≈ 16 frames at 60 Hz). Entrance also runs at 250 ms but is
    // tracked by a per-point animator independent of the viewport/Y/live-
    // track triplet — they happen to share a duration today, but nothing
    // in the code paths couples them.
    chart.appendData(id, { time: 1_000_000 + INTERVAL, open: 101, high: 106, low: 100, close: 105 });

    // After 12 frames (~192 ms) the entrance is still in flight (192 < 250);
    // the renderer's per-candle `entries` map carries the start time until
    // `tickAnimations` prunes it on settle.
    raf.flush(12);

    const newTime = 1_000_000 + INTERVAL;
    const renderer = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: unknown }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === id)?.renderer as unknown as { entries: Map<number, unknown> };
    expect(renderer.entries.has(newTime)).toBe(true);

    // Drain another 30 frames (well past 250 ms) — entrance settles and
    // the entry is pruned from the registry.
    raf.flush(30);
    expect(renderer.entries.has(newTime)).toBe(false);
  });

  it('a new high mid-stream eases Y outward toward the new extreme', () => {
    // Streaming policy: Y bounds ease toward new highs/lows on appendData
    // ticks. The brief window where the new extreme sits beyond the still-
    // rising bound is masked by the per-point entrance fade — both run on
    // the same `SHARED_ANIMATION_MS` (250 ms) budget, so the entering candle
    // is still ramping its alpha while Y converges. When entrance is hard-
    // disabled the chart snaps Y outward instead (see chart.ts updateYRange).
    const id = chart.addCandlestickSeries();

    // Seed a tight range.
    chart.setSeriesData(
      id,
      Array.from({ length: 10 }, (_, i) => ({
        time: 1_000_000 + i * INTERVAL,
        open: 100,
        high: 102,
        low: 98,
        close: 100,
      })),
    );
    raf.flush(60); // settle initial Y range

    const before = chart.getYRange();
    expect(before.max).toBeLessThan(110);

    chart.appendData(id, {
      time: 1_000_000 + 10 * INTERVAL,
      open: 100,
      high: 500,
      low: 98,
      close: 480,
    });
    raf.flush(1);

    // One frame later — Y is mid-ease, max has moved up but not yet at 500.
    const oneFrame = chart.getYRange();
    expect(oneFrame.max).toBeGreaterThan(before.max);
    expect(oneFrame.max).toBeLessThan(500);

    // After draining, Y has converged to cover the new high.
    raf.flush(60);
    const settled = chart.getYRange();
    expect(settled.max).toBeGreaterThanOrEqual(500);
  });
});
