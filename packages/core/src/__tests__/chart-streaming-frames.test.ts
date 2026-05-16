// @vitest-environment happy-dom
/**
 * Regression for "stress streaming HUD shows 0 FPS / chart renders in jerks".
 *
 * Phase 2 made `engine.tick` skip almost all work when the engine has no
 * in-flight events (the chart's own renderer-needs-animation loop still
 * fires renderMain in those windows). The intended flow during streaming:
 *
 *   appendData → onDataChanged → emit data_tick → markDirty
 *      → next RAF → renderMain → engine.tick (data_tick in flight,
 *        animating = true) → markDirty next frame
 *      → engine keeps animating for the data_tick's full duration.
 *
 * If `engine.state.animating` flips false too aggressively (e.g., the
 * fast path or post-process sweep removing the event before its duration
 * elapses), the RAF chain breaks one frame after each emit and the chart
 * only renders when the next React commit lands — visible as "jerks".
 *
 * This test pins that during a stream of `appendData` calls, `renderMain`
 * fires a continuous stream of frames between data events (not just one
 * per event).
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
    flush: (frames = 1) => {
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

function makeChart(): { chart: ChartInstance; container: HTMLElement; mainCallCount: () => number } {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);

  const chart = new ChartInstance(container, { interactive: false });
  // Spy on renderMain via private listSeriesForTest is awkward; use the
  // chart's own dataUpdate event proxy + manual count by counting markDirty
  // → RAF callback fires. Simplest: track recorded canvas clearRect calls
  // via the mocked `useMainLayer` scope, but happy-dom doesn't track them.
  // Instead, count `tickFrame` emissions — fires from renderMain once a
  // tick-tracker change lands, which is once per data-set diff. Doesn't
  // cover non-tick-diff frames. Use `viewportChange` for Y movement which
  // fires every animating frame.
  let count = 0;
  chart.on('viewportChange', () => {
    count += 1;
  });

  return { chart, container, mainCallCount: () => count };
}

describe('streaming RAF chain', () => {
  let raf: ReturnType<typeof installRaf>;
  let chart: ChartInstance;
  let container: HTMLElement;
  let mainCallCount: () => number;

  beforeEach(() => {
    raf = installRaf();
    ({ chart, container, mainCallCount } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
    raf.uninstall();
  });

  it('engine.state.animating stays true during the data_tick duration after each appendData', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 30 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + Math.sin(i) * 10 })),
    );
    raf.flush(60); // settle initial paint

    chart.appendData(id, { time: 1_000_000 + 30 * INTERVAL, value: 75 });

    // Engine should report animating = true right after emit AND for the
    // entire data_tick duration (default 250 ms = 16 RAF frames at 16 ms).
    expect(chart.getAnimationState().animating).toBe(true);

    // 3 frames later — still animating (well within the 250 ms ease).
    raf.flush(3);
    expect(chart.getAnimationState().animating).toBe(true);
  });

  it('fires multiple viewportChange events across the data_tick ease — not just one', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 30 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + Math.sin(i) * 10 })),
    );
    raf.flush(60);

    const before = mainCallCount();

    // One appendData with a new high. Y range needs to ease up. Each
    // animating frame should emit viewportChange.
    chart.appendData(id, { time: 1_000_000 + 30 * INTERVAL, value: 500 });
    raf.flush(20); // 20 RAF frames — more than the 250 ms ease window

    const after = mainCallCount();
    // We expect a healthy spread of frames (≥ 5) for a Y ease.
    expect(after - before).toBeGreaterThan(5);
  });

  it('React-18-batched burst (many appendData inside chart.batch) emits data_tick — NOT instant', () => {
    // Regression for "0 FPS / jerky rendering" on the stress streaming
    // page. React 18 automatic batching coalesces several setInterval
    // fires into one commit; the React wrapper calls `appendData` once
    // per accumulated point inside `chart.batch()`. The legacy heuristic
    // (`added > 5` → kind=instant → engine settles) broke the RAF chain
    // between commits because the engine settled state.animating=false
    // after the snap, and the next commit only happens when React
    // schedules its next frame (~16–100 ms depending on load).
    //
    // The fix: any append-through-chart.batch path goes through data_tick
    // regardless of how many points landed in the batch. `state.animating`
    // stays true for the data_tick duration, keeping the RAF chain alive.
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 10 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + i })),
    );
    raf.flush(60);
    expect(chart.getAnimationState().animating).toBe(false);

    // Simulate React 18 batching 15 setInterval ticks into one commit.
    let lastTime = 1_000_000 + 10 * INTERVAL;
    chart.batch(() => {
      for (let i = 0; i < 15; i++) {
        lastTime += INTERVAL;
        chart.appendData(id, { time: lastTime, value: 50 + i * 3 });
      }
    });

    // Engine should be animating (data_tick in flight). If the legacy
    // heuristic had fired, instant snap would have settled it to false.
    expect(chart.getAnimationState().animating).toBe(true);
  });

  it('streaming burst (30 successive appendData) keeps re-arming RAF — total frames much greater than emit count', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(
      id,
      Array.from({ length: 10 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + i })),
    );
    raf.flush(60);

    const before = mainCallCount();

    // 30 appends, each with one RAF in between — simulates a 60 ms cadence.
    let lastTime = 1_000_000 + 10 * INTERVAL;
    for (let i = 0; i < 30; i++) {
      lastTime += INTERVAL;
      chart.appendData(id, { time: lastTime, value: 50 + i * 2 });
      raf.flush(4); // 4 frames between emits
    }
    raf.flush(40); // drain the last ease

    const after = mainCallCount();
    // With Y range continuously climbing, viewportChange should fire many
    // times — at minimum once per emit plus several frames of ease per
    // emit. If the RAF chain breaks each frame after emit, we'd see
    // ~1 per emit = 30. We want substantially more.
    expect(after - before).toBeGreaterThan(60);
  });
});
