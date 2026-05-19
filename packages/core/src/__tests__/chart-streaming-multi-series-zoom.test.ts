/**
 * Regression for the LinePage drift bug.
 *
 * With multiple line series streaming in lockstep (e.g. MultiChart in
 * docs/pages/LinePage.tsx, 6 series), every streaming tick used to hit the
 * old `added > 5` threshold in `onDataChanged` and refit the X window via
 * `#fitVisibleToData`. That overwrote `#logical` with the default fit-to-data
 * range and the engine's X spring eased the visual back — visually, "the
 * chart slowly returns to its initial state" right after the user zooms / pans.
 *
 * The fix: drop the point-count heuristic entirely; only `setSeriesData`
 * (which already flags `#dataReplaceSnapPending`) triggers a refit. All
 * `appendData` / `updateData` paths preserve the user's zoom.
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

  return {
    chart: new ChartInstance(container, { interactive: false, animations: { axis: { x: { gesture: 0 } } } }),
    container,
  };
}

function seedSeries(chart: ChartInstance, seriesCount: number, points: number, startTime = 1_000_000): string[] {
  const ids: string[] = [];
  for (let s = 0; s < seriesCount; s++) {
    const id = chart.addLineSeries();
    const data = Array.from({ length: points }, (_, i) => ({
      time: startTime + i * INTERVAL,
      value: 50 + s * 10,
    }));
    chart.setSeriesData(id, data);
    ids.push(id);
  }
  return ids;
}

describe('multi-series streaming preserves user zoom (LinePage regression)', () => {
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

  it('streaming one point per tick across 6 series does NOT refit the viewport', () => {
    const ids = seedSeries(chart, 6, 300);
    raf.flush(20);

    // User zooms in to the last 30 bars (versus the default 200-bar fit
    // capped by maxVisibleBars). `setVisibleRange(N)` adds right-padding
    // intervals; the exact span is N + paddingRight bars but well under
    // the 200-bar fit ceiling.
    chart.setVisibleRange(30);
    raf.flush(20);
    const zoomed = chart.getVisibleRange();
    const zoomedSpan = zoomed.to - zoomed.from;
    expect(zoomedSpan).toBeLessThan(50 * INTERVAL);

    // Stream 10 ticks. Each tick appends one point to every one of the
    // six series in a batch — total `added = 6` per tick. The pre-fix code
    // refit to ~200 bars on every tick; the visible span would expand
    // toward the default fit. Span must stay near 30 bars instead.
    let lastTime = 1_000_000 + 299 * INTERVAL;
    for (let tick = 0; tick < 10; tick++) {
      lastTime += INTERVAL;
      chart.batch(() => {
        for (const id of ids) {
          chart.appendData(id, { time: lastTime, value: 50 });
        }
      });
      raf.flush(2);
    }
    raf.flush(40);

    const after = chart.getVisibleRange();
    const afterSpan = after.to - after.from;
    // Span must stay near 30 bars. The pre-fix bug expanded it toward 200
    // bars; a wide tolerance still distinguishes the two regimes
    // unambiguously.
    expect(afterSpan).toBeLessThan(60 * INTERVAL);
    // And the right edge still tracks the data tail (autoscroll on).
    expect(after.to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('streaming one point per layer per tick across 6 layers does NOT refit the viewport', () => {
    // This matches the LinePage MultiChart wiring: ONE LineSeries with
    // `layers: 6`, not six separate series. Each layer appends a point
    // per tick — `getTotalLength()` sees `+6` per `onDataChanged`, which
    // also has to flow through the per-series delta without tripping the
    // bulk-load path.
    const layerCount = 6;
    const id = chart.addLineSeries({ layers: layerCount });
    for (let li = 0; li < layerCount; li++) {
      chart.setSeriesData(
        id,
        Array.from({ length: 300 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + li * 10 })),
        li,
      );
    }
    raf.flush(20);

    chart.setVisibleRange(30);
    raf.flush(20);
    const zoomedSpan = chart.getVisibleRange().to - chart.getVisibleRange().from;
    expect(zoomedSpan).toBeLessThan(50 * INTERVAL);

    let lastTime = 1_000_000 + 299 * INTERVAL;
    for (let tick = 0; tick < 10; tick++) {
      lastTime += INTERVAL;
      chart.batch(() => {
        for (let li = 0; li < layerCount; li++) {
          chart.appendData(id, { time: lastTime, value: 50 + li * 10 }, li);
        }
      });
      raf.flush(2);
    }
    raf.flush(40);

    const after = chart.getVisibleRange();
    expect(after.to - after.from).toBeLessThan(60 * INTERVAL);
    expect(after.to).toBeCloseTo(lastTime + 3 * INTERVAL, -1);
  });

  it('bulk replace of a single series (setSeriesData, >5 points) still refits', () => {
    // Sanity: per-series batch detection must NOT regress the existing
    // bulk-load semantic that `chart-y-range-animator.test.ts` pins.
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 5 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 })),
    );
    raf.flush(20);

    chart.setSeriesData(
      id,
      Array.from({ length: 12 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: i * 10 })),
    );
    raf.flush(5);

    const after = chart.getVisibleRange();
    // Refit covers the entire new 12-bar dataset (plus padding), span > 12.
    expect(after.to - after.from).toBeGreaterThan(12 * INTERVAL);
  });
});
