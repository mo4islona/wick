// @vitest-environment happy-dom
/**
 * Chart-level tick-tracker arming behaviour.
 *
 * The shared `AxisTickTracker` per scale fades new tick labels in/out, but
 * only after the chart has reached a fully settled state — viewport
 * animation done, no series entrance animations in flight, no tracker fades
 * in progress. Until then, tick churn from the initial mount (`fitToData`,
 * `setVisibleRange` deep-link, streaming pre-roll) all snaps so users
 * don't see a long opening fade.
 *
 * This suite pins that policy: the tracker is unarmed during the initial
 * paint, arms once the chart settles, and from that point on new tick
 * values fade in from opacity 0 instead of snapping to 1.
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
    flush: (frames = 50) => {
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

  const chart = new ChartInstance(container, { interactive: false });

  return { chart, container };
}

describe('chart-level tick-tracker arming', () => {
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

  it('initial paint seeds ticks at full opacity and does not arm the trackers mid-fade', () => {
    ({ chart, container } = makeChart());
    const id = chart.addLineSeries();
    const data = Array.from({ length: 10 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + i * 5 }));
    chart.setSeriesData(id, data);
    // Only one frame — viewport/series may still be animating after this.
    raf.flush(1);

    const ySnap = chart.yScale.tickTracker.snapshot();
    expect(ySnap.entries.length).toBeGreaterThan(0);
    // Every seeded tick should be at full opacity — no fade-in during the
    // mount phase, even though the chart hasn't fully settled yet.
    for (const entry of ySnap.entries) {
      expect(entry.opacity).toBe(1);
    }
    expect(ySnap.isAnimating).toBe(false);
  });

  it('arms the trackers once the chart has fully settled', () => {
    ({ chart, container } = makeChart());
    seedLine(chart, [50, 55, 60, 65, 70]);
    // Plenty of frames — viewport animation and any series entrance fade
    // should have all completed.
    raf.flush(50);

    expect(chart.yScale.tickTracker.isArmed).toBe(true);
    expect(chart.timeScale.tickTracker.isArmed).toBe(true);
  });

  it('stays armed across follow-up animations after initial settle (no churn-driven disarm)', () => {
    // Once the chart settles for the first time, the tracker arms and stays
    // armed for the rest of its life. Subsequent set changes — manual zoom,
    // data swap, label-density change — fade in/out instead of snapping.
    ({ chart, container } = makeChart());
    seedLine(
      chart,
      Array.from({ length: 200 }, (_, i) => 50 + i),
    );
    raf.flush(80);
    expect(chart.yScale.tickTracker.isArmed).toBe(true);
    expect(chart.timeScale.tickTracker.isArmed).toBe(true);

    // Trigger a viewport tween (zoom) — armed must remain true so the
    // departing time ticks can fade out instead of snapping.
    chart.setVisibleRange({ from: 1_000_000 + 100 * INTERVAL, to: 1_000_000 + 110 * INTERVAL });
    raf.flush(1);
    expect(chart.timeScale.tickTracker.isArmed).toBe(true);
  });

  it('once armed, the next setCurrentTicks fades newcomers in from opacity 0', () => {
    ({ chart, container } = makeChart());
    seedLine(chart, [50, 55, 60, 65, 70]);
    raf.flush(50);
    expect(chart.yScale.tickTracker.isArmed).toBe(true);

    // Drive the tracker directly with a new tick set (bypasses the chart's
    // own setCurrentTicks call so we can check the seed without races with
    // a follow-up tick). After this call the armed-phase contract says
    // newcomers are at opacity 0 and the snapshot reports `isAnimating`.
    chart.yScale.tickTracker.setCurrentTicks([42_000, 43_000, 44_000]);
    const snap = chart.yScale.tickTracker.snapshot();
    const newcomers = snap.entries.filter((e) => [42_000, 43_000, 44_000].includes(e.value));
    expect(newcomers.length).toBe(3);
    for (const e of newcomers) {
      expect(e.opacity).toBe(0);
    }
    expect(snap.isAnimating).toBe(true);
  });

  it('bulk replace (setSeriesData with new range) resets trackers so old tick values do not ghost-fade', () => {
    ({ chart, container } = makeChart());
    const id = seedLine(chart, [10, 15, 20, 25, 30]);
    raf.flush(50);
    expect(chart.yScale.tickTracker.isArmed).toBe(true);
    const armedYTicks = chart.yScale.tickTracker.snapshot().entries.map((e) => e.value);
    expect(armedYTicks.length).toBeGreaterThan(0);

    // Bulk replace with values far outside the current range. Without the
    // reset, the old tick values would stay in the tracker fading out
    // toward 0 over 250 ms, and the new values would fade in from 0 —
    // briefly showing "ghost" grid lines / labels from the prior dataset.
    chart.setSeriesData(
      id,
      Array.from({ length: 5 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 5000 + i * 1000 })),
    );

    // Immediately after the bulk replace, the tracker should be back in
    // its un-armed snap state (just like a fresh chart) so the next paint
    // shows only the new tick set at full opacity.
    expect(chart.yScale.tickTracker.isArmed).toBe(false);
    const snap = chart.yScale.tickTracker.snapshot();
    // No leftover from the old [10-30] range.
    const oldTicksStillPresent = snap.entries.filter((e) => armedYTicks.includes(e.value));
    expect(oldTicksStillPresent).toEqual([]);
  });
});

function seedLine(chart: ChartInstance, values: number[], startTime = 1_000_000): string {
  const id = chart.addLineSeries();
  const data = values.map((value, i) => ({ time: startTime + i * INTERVAL, value }));
  chart.setSeriesData(id, data);

  return id;
}
