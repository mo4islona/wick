// @vitest-environment happy-dom
/**
 * Regression: streaming cadence EMA must not be poisoned by intra-bar
 * `updateData` emissions that don't advance `dataEnd`.
 *
 * Symptom: with a producer emitting one bar per 1000ms wall plus one intra
 * update at +500ms (e.g., `useOHLCStream` at speed=5 with INTRA_EMIT_MS=500),
 * folding both event kinds into the cadence EMA converged it to ~500ms.
 * `pickDuration(floor=250)` returned 500ms — half the bar interval — so each
 * X slide finished in 500ms and the chart sat visibly idle for 500ms before
 * the next bar landed. Read as "animated step + pause" on demo pages.
 *
 * Fix: `#computeXTarget` observes the cadence ONLY when `computeStreamingTarget`
 * returns a non-null `newLogical` — i.e., `dataEnd` actually advanced. Intra
 * emissions (same `time`, different value) bail out of `computeStreamingTarget`
 * via the threshold filter and now leave the EMA untouched, so the next bar's
 * slide rides the true bar-to-bar wall cadence.
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

describe('streaming cadence — intra-bar emissions do not poison the EMA', () => {
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

  it('slide after bar+intra interleave honors bar-to-bar cadence, not mixed cadence', () => {
    const id = chart.addLineSeries();

    chart.setSeriesData(
      id,
      Array.from({ length: 10 }, (_, i) => ({ time: i * INTERVAL, value: 50 + Math.sin(i) * 5 })),
    );
    raf.flush(2);

    // Drive 8 bar+intra cycles WITHOUT flushing in between — we only need
    // `cadence.observe` calls (synchronous inside append/updateData), not
    // rendered frames. Flushing between sub-events would advance wall time
    // by 16ms × frames, blurring the precise cadence pattern we're seeding:
    //
    //   wall +500ms → appendData(time = T)         (advances dataEnd)
    //   wall +500ms → updateData(time = T)         (same time — sub-threshold)
    //   wall +500ms → appendData(time = T + INTERVAL)
    //   ...
    //
    // Every cadence observe is exactly 500ms apart. With the bug, the EMA
    // settles at 500ms and pickDuration(floor=250) returns ~500ms. With
    // the fix, only the appendData observes count (1000ms apart) and the
    // EMA settles at 1000ms.
    let nextTime = 10 * INTERVAL;
    let lastValue = 60;

    for (let i = 0; i < 8; i++) {
      raf.advance(500);
      chart.appendData(id, { time: nextTime, value: lastValue });

      raf.advance(500);
      lastValue += 1;
      chart.updateData(id, { time: nextTime, value: lastValue });

      nextTime += INTERVAL;
    }

    // Final bar at wall +1000ms — the X animator's duration on this retarget
    // is `pickDuration(floor) ≈ EMA`. Sample `xRange.to` per frame and count
    // how long the X slide takes (Y has its own much longer Hermite contract;
    // `animating` would conflate the two).
    raf.advance(1000);
    chart.appendData(id, { time: nextTime, value: lastValue + 1 });

    let prevXTo = chart.getAnimationState().xRange.to;
    let xSettledFrames = 0;
    let xMovingFrames = 0;
    for (let i = 0; i < 400; i++) {
      raf.flush(1);
      const xTo = chart.getAnimationState().xRange.to;
      const moved = Math.abs(xTo - prevXTo) > 1e-6;
      prevXTo = xTo;
      if (moved) {
        xMovingFrames++;
        xSettledFrames = 0;
      } else {
        xSettledFrames++;
        if (xMovingFrames > 0 && xSettledFrames >= 3) break;
      }
    }

    const slideMs = xMovingFrames * 16;
    expect(
      slideMs,
      `slideMs=${slideMs} (expected ≥ 800ms — bar cadence; pre-fix saw ~500ms mixed cadence)`,
    ).toBeGreaterThanOrEqual(800);
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
    // `updateData` leaves `dataEnd` unchanged, so `computeStreamingTarget`
    // returns null and no X retarget fires. Y may animate (the value jumped
    // to 99) but X must stay pinned.
    expect(xAfter.from).toBe(xBefore.from);
    expect(xAfter.to).toBe(xBefore.to);
  });
});
