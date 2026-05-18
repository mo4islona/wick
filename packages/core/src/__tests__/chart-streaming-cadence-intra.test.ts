// @vitest-environment happy-dom
/**
 * Regression: `chart.updateData` (intra-bar emissions that don't advance
 * `dataEnd`) must not trigger an X retarget. The chart only emits the
 * `onPointAppended` engine signal from `appendData`; same-time updates flow
 * through the renderer's local smoothing path so the X spring stays put.
 *
 * The previous flavor of this test asserted cadence-EMA behavior (slide
 * duration tracking bar-to-bar wall cadence). That coupling is gone with
 * the spring-based X transition — settle time is the spring's constant
 * `settleMs`, not a measured EMA — so the cadence-specific assertion has
 * been dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance } from '../chart';

const INTERVAL = 1000;

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
    flush: (frames = 1) => {
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

function makeChart(): { chart: ChartInstance; container: HTMLElement } {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);
  const chart = new ChartInstance(container, { interactive: false });

  return { chart, container };
}

describe('intra-bar updates do not trigger an X retarget', () => {
  let raf: ReturnType<typeof installRaf>;
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    raf = installRaf();
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
    raf.uninstall();
  });

  it('updateData never starts an X slide — only Y may retarget for the new value', () => {
    const id = chart.addLineSeries();

    chart.setSeriesData(
      id,
      Array.from({ length: 10 }, (_, i) => ({ time: i * INTERVAL, value: 50 + Math.sin(i) * 5 })),
    );
    raf.flush(40);

    const xBefore = chart.getAnimationState().xRange;

    raf.advance(500);
    chart.updateData(id, { time: 9 * INTERVAL, value: 99 });
    raf.flush(20);

    const xAfter = chart.getAnimationState().xRange;
    // `updateData` leaves `dataEnd` unchanged and emits no engine signal,
    // so the X spring stays pinned at its previous target. Y may animate
    // (the value jumped to 99) but X must not move.
    expect(xAfter.from).toBe(xBefore.from);
    expect(xAfter.to).toBe(xBefore.to);
  });
});
