/**
 * Stress tests for the chart's streaming animation pipeline. Each scenario
 * drives a scripted workload through ChartInstance with a deterministic RAF +
 * performance.now stub and asserts the smoothness invariants that surface
 * the streaming jerk reported on real-time feeds:
 *
 *  - Visible-range right edge advances monotonically during warm-up.
 *  - Once the maxVisibleBars cap is reached, the window holds its width.
 *  - No NaN/Infinity ever leaks into visualRange or the Y range.
 *  - Sharp value jumps don't trap the Y animator outside the data extremes.
 *  - Adaptive scroll duration tracks inter-arrival intervals (no run-away
 *    multi-second slides after a long pause).
 *  - User pan during a burst flips autoScroll off and stops auto-following.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance, type ChartOptions } from '../chart';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;
const CHART_HEIGHT = 400;

function installRaf(): {
  flush: (frames?: number) => void;
  advance: (ms: number) => void;
  now: () => number;
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
    now: () => now,
    uninstall: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancel;
      spy.mockRestore();
      queue = [];
    },
  };
}

function makeChart(extra: Partial<ChartOptions> = {}): {
  chart: ChartInstance;
  container: HTMLElement;
} {
  const container = document.createElement('div');
  const rect: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: CHART_HEIGHT,
    right: CHART_WIDTH,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    toJSON: () => ({}),
  };
  container.getBoundingClientRect = () => rect;
  Object.defineProperty(container, 'clientWidth', { value: CHART_WIDTH, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: CHART_HEIGHT, configurable: true });
  document.body.appendChild(container);
  return { chart: new ChartInstance(container, { interactive: false, ...extra }), container };
}

function isFiniteRange(r: { from: number; to: number }): boolean {
  return Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from;
}

describe('ChartInstance — streaming stress', () => {
  let chart: ChartInstance;
  let container: HTMLElement;
  let raf: ReturnType<typeof installRaf>;

  beforeEach(() => {
    raf = installRaf();
  });

  afterEach(() => {
    chart?.destroy();
    container?.remove();
    raf.uninstall();
  });

  it('warm-up burst (0 → 500 points) keeps the right edge monotonically advancing and preserves a 50-bar window', () => {
    ({ chart, container } = makeChart({ viewport: { maxVisibleBars: 50 } }));
    const id = chart.addLineSeries();

    // First two points arrive together so the chart can detect dataInterval.
    chart.setSeriesData(id, [
      { time: 0, value: 100 },
      { time: INTERVAL, value: 101 },
    ]);
    raf.flush(20);

    // Explicit 50-bar warm-up window starting at the seed's first timestamp.
    chart.setVisibleRange({ from: 0, bars: 50 });

    const samples: Array<{ from: number; to: number }> = [];
    let lastTime = INTERVAL;

    for (let i = 0; i < 500; i++) {
      lastTime += INTERVAL;
      raf.advance(16);
      chart.appendData(id, { time: lastTime, value: 100 + (i % 20) });
      raf.flush(1);
      samples.push({ ...chart.getVisibleRange() });
    }
    raf.flush(60); // drain any in-flight animation

    // Every sampled visible range is finite.
    for (const r of samples) {
      expect(isFiniteRange(r)).toBe(true);
    }

    // Right edge never goes backwards.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].to).toBeGreaterThanOrEqual(samples[i - 1].to - 1e-6);
    }

    // Final visible window keeps the configured 50-bar width.
    const final = chart.getVisibleRange();
    expect(final.to - final.from).toBeCloseTo(50 * INTERVAL, -1);
    expect(final.to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('sharp value jumps do not poison the Y range or produce NaN', () => {
    ({ chart, container } = makeChart({ viewport: { maxVisibleBars: 100 } }));
    const id = chart.addLineSeries();
    // Seed with a non-degenerate range so initial Y bounds aren't flat.
    chart.setSeriesData(id, [
      { time: 0, value: 50 },
      { time: INTERVAL, value: 150 },
    ]);
    raf.flush(20);

    let lastTime = INTERVAL;
    for (let i = 0; i < 200; i++) {
      lastTime += INTERVAL;
      raf.advance(16);
      // Alternate baseline and 10× spike — extreme outward expansion every other tick.
      const value = i % 2 === 0 ? 100 : 1000;
      chart.appendData(id, { time: lastTime, value });
      raf.flush(1);

      const range = chart.yScale.getRange();
      expect(Number.isFinite(range.min)).toBe(true);
      expect(Number.isFinite(range.max)).toBe(true);
      expect(range.max).toBeGreaterThanOrEqual(range.min);
    }
    raf.flush(60);

    // After draining, Y range must contain both extremes.
    const range = chart.yScale.getRange();
    expect(range.min).toBeLessThanOrEqual(100);
    expect(range.max).toBeGreaterThanOrEqual(1000);
  });

  it('variable inter-arrival jitter — visible right edge stays within ~one interval of the latest data', () => {
    ({ chart, container } = makeChart({ viewport: { maxVisibleBars: 80 } }));
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 0, value: 50 },
      { time: INTERVAL, value: 50 },
    ]);
    raf.flush(20);

    let lastTime = INTERVAL;
    // Pseudo-random but seeded for determinism.
    let seed = 1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let i = 0; i < 200; i++) {
      const gap = 30 + Math.floor(rand() * 770); // 30–800 ms between ticks
      raf.advance(gap);
      lastTime += INTERVAL;
      chart.appendData(id, { time: lastTime, value: 50 + (i % 30) });
      raf.flush(2);
    }
    raf.flush(60);

    const { to } = chart.getVisibleRange();
    // Right edge stays within one interval of `last + right padding` even
    // under jittered cadence — adaptive scroll keeps the tail tracked.
    expect(to).toBeGreaterThan(lastTime + 2 * INTERVAL);
    expect(to).toBeLessThan(lastTime + 4 * INTERVAL);
  });

  it('burst-then-pause: post-pause first scroll does not produce a 5-second slide', () => {
    ({ chart, container } = makeChart({ viewport: { maxVisibleBars: 60 } }));
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 0, value: 10 },
      { time: INTERVAL, value: 10 },
    ]);
    raf.flush(20);

    let lastTime = INTERVAL;
    // Burst 100 ticks within ~200ms.
    for (let i = 0; i < 100; i++) {
      raf.advance(2);
      lastTime += INTERVAL;
      chart.appendData(id, { time: lastTime, value: 10 + (i % 10) });
      raf.flush(1);
    }
    raf.flush(60);
    const afterBurst = { ...chart.getVisibleRange() };

    // 5-second idle pause.
    raf.advance(5_000);

    // Single tick after the pause.
    lastTime += INTERVAL;
    chart.appendData(id, { time: lastTime, value: 12 });
    // Advance only 300ms of frames — less than SCROLL_TO_END_MAX_MS.
    // If a pathological multi-second slide existed, the right edge would
    // still be far behind the latest data after this short window.
    raf.flush(20); // ~320ms

    const after = chart.getVisibleRange();
    // Right edge must have caught up to the new latest bar, not lagging
    // by anything close to 5s of data.
    expect(after.to).toBeGreaterThanOrEqual(afterBurst.to);
    expect(after.to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('user pan during warm-up flips autoScroll off and the burst stops auto-following', () => {
    ({ chart, container } = makeChart({ viewport: { maxVisibleBars: 50 } }));
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 0, value: 100 },
      { time: INTERVAL, value: 100 },
    ]);
    raf.flush(20);

    let lastTime = INTERVAL;

    // 10 warm-up ticks.
    for (let i = 0; i < 10; i++) {
      lastTime += INTERVAL;
      raf.advance(16);
      chart.appendData(id, { time: lastTime, value: 100 + i });
      raf.flush(1);
    }

    // User pan: drag the viewport hard left so the latest bar leaves the window.
    const before = chart.getVisibleRange();
    const panRange: { from: number; to: number } = {
      from: before.from - 200 * INTERVAL,
      to: before.to - 200 * INTERVAL,
    };
    chart.setVisibleRange(panRange);
    raf.flush(20);

    // Continue appending — should NOT snap back to follow the tail since the
    // last point is no longer in view.
    for (let i = 0; i < 10; i++) {
      lastTime += INTERVAL;
      raf.advance(16);
      chart.appendData(id, { time: lastTime, value: 100 + i });
      raf.flush(1);
    }
    raf.flush(30);

    const after = chart.getVisibleRange();
    // Right edge stayed near the panned position, not the newest bar.
    expect(after.to).toBeLessThan(lastTime - 50 * INTERVAL);
  });
});
