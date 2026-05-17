// @vitest-environment happy-dom
/**
 * Chart-level Y-range animator behaviour.
 *
 * Streaming `appendData` ticks ease the Y bounds toward new highs/lows over
 * `yAxisMs` (inward contraction always eases; outward expansion eases when
 * the per-point entrance is enabled — its fade masks the brief overshoot —
 * and snaps when entrance is disabled to prevent canvas-edge clipping). Bulk
 * replaces (`setSeriesData`) snap synchronously via the
 * `#dataReplaceSnapPending` flag so `yScale.getRange()` reflects the new
 * domain immediately.
 *
 * This suite pins both policies at the chart level, plus the X-destination
 * dependency (Y target sampled against the X destination, not the animating
 * X).
 *
 * Drives ChartInstance against a stubbed RAF loop so animator ticks advance
 * deterministically; uses the same RAF/timer mock pattern as
 * chart-streaming-autoscroll.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hermite, snap } from '../../animation';
import type { AnimationsConfig } from '../../animation/config';
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

function makeChart(opts: { yAxisMs?: number } = {}): { chart: ChartInstance; container: HTMLElement } {
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

  // Tests historically pinned the Y-chase duration via `yAxisMs`. The new
  // public API uses `axis.y.settle` (expand) and `axis.y.sticky` (contract);
  // for symmetric test behaviour we set both to the same value, or use
  // `snap()` when 0 — preserves the existing test semantics without
  // touching every call site.
  let animations: boolean | AnimationsConfig | undefined;
  if (opts.yAxisMs === undefined) {
    animations = undefined;
  } else if (opts.yAxisMs === 0) {
    animations = { axis: { y: { curve: snap() } } };
  } else {
    animations = { axis: { y: { curve: hermite(), settle: opts.yAxisMs, sticky: opts.yAxisMs } } };
  }
  const chart = new ChartInstance(container, {
    interactive: false,
    animations,
  });

  return { chart, container };
}

function seedLine(chart: ChartInstance, values: number[], startTime = 1_000_000): string {
  const id = chart.addLineSeries();
  const data = values.map((value, i) => ({ time: startTime + i * INTERVAL, value }));
  chart.setSeriesData(id, data);

  return id;
}

describe('chart Y-range animator', () => {
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

  it('first data load snaps Y range to data extremes (no easing on init)', () => {
    ({ chart, container } = makeChart());
    seedLine(chart, [50, 60, 55, 70, 65]);
    raf.flush(1);

    const { min, max } = chart.getYRange();
    // With default top/bottom padding of 20px on a 400px chart, the visible
    // range expands by ~5% on each side. Assert the *unpadded* extremes are
    // bracketed inside the actual range.
    expect(min).toBeLessThanOrEqual(50);
    expect(max).toBeGreaterThanOrEqual(70);
  });

  it('streaming appendData eases Y in both directions (no per-tick snap)', () => {
    // Streaming policy: Y bounds ease toward new extremes over `yAxisMs` so
    // the axis labels never snap to a new tick set on a per-point new high
    // or new low. Brief overshoot is masked by the per-point entrance fade.
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    const id = seedLine(chart, [50, 50, 50, 50, 50]);
    raf.flush(20);

    const before = chart.getYRange();

    // Append a point well above the current max. The streaming path eases —
    // one frame later, max should have advanced toward 200 but not reached it.
    chart.appendData(id, { time: 1_000_000 + 5 * INTERVAL, value: 200 });
    raf.flush(1);

    const oneFrame = chart.getYRange();
    expect(oneFrame.max).toBeGreaterThan(before.max);
    expect(oneFrame.max).toBeLessThan(200);

    // After draining, the max settles at the new value.
    raf.flush(40);
    const settled = chart.getYRange();
    expect(settled.max).toBeGreaterThanOrEqual(200);
  });

  it('streaming appendData with a new low eases inward to the new bound', () => {
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    const id = seedLine(chart, [50, 50, 50, 50, 50]);
    raf.flush(20);

    const before = chart.getYRange();
    chart.appendData(id, { time: 1_000_000 + 5 * INTERVAL, value: -200 });
    raf.flush(1);

    const oneFrame = chart.getYRange();
    expect(oneFrame.min).toBeLessThan(before.min);
    expect(oneFrame.min).toBeGreaterThan(-200);

    raf.flush(40);
    const settled = chart.getYRange();
    expect(settled.min).toBeLessThanOrEqual(-200);
  });

  it('setSeriesData snaps Y synchronously so yScale.getRange() reflects new domain', () => {
    // Bulk replace path: tests like chart-scales-sync.test rely on yScale
    // updating immediately after setSeriesData. The chart marks
    // `#dataReplaceSnapPending` before forwarding to the renderer so
    // onDataChanged takes the snap branch.
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    const id = seedLine(chart, [10, 20, 15, 18, 12]);
    raf.flush(20);

    const before = chart.getYRange();
    expect(before.max).toBeLessThan(50);

    chart.setSeriesData(
      id,
      [100, 500, 300, 700, 400].map((value, i) => ({ time: 1_000_000 + i * INTERVAL, value })),
    );
    raf.flush(1);

    const after = chart.getYRange();
    expect(after.max).toBeGreaterThanOrEqual(700);
    expect(after.min).toBeLessThanOrEqual(100);
  });

  it('batch load snaps Y range (no animation)', () => {
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    const id = seedLine(chart, [50, 50, 50, 50, 50]);
    raf.flush(20);

    // Replace with 12 points — `added = 12 - 5 = 7 > 5` triggers the batch
    // path. (`isBatchLoad` is `added > 5` in chart.ts:onDataChanged.)
    const newData = [10, 20, 30, 80, 70, 60, 90, 100, 40, 50, 25, 45].map((value, i) => ({
      time: 1_000_000 + i * INTERVAL,
      value,
    }));
    chart.setSeriesData(id, newData);
    raf.flush(1);

    const after = chart.getYRange();
    // Snap means the range fully reflects the new extremes after one frame.
    expect(after.min).toBeLessThanOrEqual(10);
    expect(after.max).toBeGreaterThanOrEqual(100);
  });

  it('yAxisMs=0 disables animation (snap path)', () => {
    ({ chart, container } = makeChart({ yAxisMs: 0 }));
    const id = seedLine(chart, [10, 100, 50, 50, 50]);
    raf.flush(20);

    chart.setSeriesData(
      id,
      [40, 50, 55, 60, 50].map((value, i) => ({ time: 1_000_000 + i * INTERVAL, value })),
    );
    raf.flush(1); // single frame — must already be at the new tighter range

    const after = chart.getYRange();
    expect(after.min).toBeGreaterThan(35);
    expect(after.min).toBeLessThan(45);
    expect(after.max).toBeGreaterThan(55);
    expect(after.max).toBeLessThan(70);
  });

  it('Y target uses the X destination, not the animating X', () => {
    // Cover GPT-5.4 review point #5: while X is animating to a new range,
    // Y must compute its target against the X *destination*, not the
    // mid-tween X position. Otherwise Y chases a moving definition of "in
    // view" and never converges with X.
    //
    // Seed a series where the visible window depends on X: low-Y points on
    // the left, high-Y points on the right. A scrollToEnd-style retarget
    // shifts X right; the Y target must reflect the high-Y window the X
    // *will land on*, not an interpolated middle.
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    const id = chart.addLineSeries();
    const data = Array.from({ length: 50 }, (_, i) => ({
      time: 1_000_000 + i * INTERVAL,
      // Low values (10) for the first 30 points, high values (100) for the last 20.
      value: i < 30 ? 10 : 100,
    }));
    chart.setSeriesData(id, data);
    raf.flush(20);

    // Initial fit to data — Y range covers full extent [10, 100].
    const initial = chart.getYRange();
    expect(initial.min).toBeLessThanOrEqual(10);
    expect(initial.max).toBeGreaterThanOrEqual(100);

    // Zoom to just the high-Y tail (last 10 points).
    chart.setVisibleRange({
      from: 1_000_000 + 40 * INTERVAL,
      to: 1_000_000 + 50 * INTERVAL,
    });
    raf.flush(1);

    // After the X target has been committed (setVisibleRange snaps),
    // Y target reflects the new window. Even on the very next frame (before
    // any Y animation has had time to advance), the Y target must point at
    // the high-Y window (max around 100) — not at the wider [10, 100] of the
    // earlier animating X.
    //
    // We assert this indirectly: getYRange returns the *animated* current,
    // but for snap-on-expansion the new max is already committed if data
    // exceeds — and 100 was already in view, so max stays. The decisive test
    // is min: in the new window the lowest value is 100 (no low-Y points).
    // Y must be contracting upward toward min ≈ 100. Because contraction
    // animates, after just 1 frame `min` is still much lower than 100.
    const oneFrameAfter = chart.getYRange();
    expect(oneFrameAfter.min).toBeLessThan(50); // still wide, animating

    // But after settling, min has reached the new high window. Sticky-Y
    // contraction is EMA'd at `Y_BOUND_CONTRACT_ALPHA` per `updateYRange`
    // call (≈0.05, half-life ~14 frames) rather than the 13-frame
    // `yAxisMs=200` ease the test used to assume, so convergence takes
    // ~80–100 frames. The semantic invariant — that Y eventually converges
    // to the new high window once X has snapped — still holds.
    raf.flush(200);
    const settled = chart.getYRange();
    expect(settled.min).toBeGreaterThanOrEqual(90);
  });

  it('emits `viewportChange` on every frame Y is mid-tween (DOM axis labels reposition smoothly)', () => {
    // Regression: DOM axis labels (`<YAxis>`) subscribe to `viewportChange`
    // via `useYRange()` to re-read yScale and reposition. Previously the
    // event only fired from the viewport's X 'change' listener — Y animator
    // ticks advanced silently. On streams where Y was continuously animating
    // but the tick set hadn't crossed a "nice value" threshold yet, no
    // `viewportChange` fired between threshold events, and labels stayed
    // pinned at stale Y while the canvas line slid smoothly underneath.
    // Result: labels jumped in discrete chunks every ~half-second instead of
    // sliding.
    //
    // Fix: `updateYRange` emits `viewportChange` whenever the Y animator
    // advances. This test pins that contract: a Y-bound retarget produces
    // *multiple* viewportChange emissions across the chase, one per frame
    // while still animating.
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    const id = seedLine(chart, [50, 50, 50, 50, 50]);
    raf.flush(20);

    let count = 0;
    chart.on('viewportChange', () => {
      count++;
    });

    // Append a point well above current max — triggers a Y retarget that
    // animates over ~200ms (~12 frames at 16ms each).
    chart.appendData(id, { time: 1_000_000 + 5 * INTERVAL, value: 200 });
    raf.flush(15);

    // Each mid-tween frame should emit viewportChange. With a fresh 200ms
    // chase across ~12 frames, we expect at least ~10 emits before settling.
    // Anything ≥ 5 proves the per-frame-while-animating contract — we don't
    // pin the exact number because settled frames legitimately suppress the
    // emit (and the very first emit fires from setTarget itself).
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('setSeriesVisible eases the Y range over toggleMs (matches the alpha fade)', () => {
    ({ chart, container } = makeChart({ yAxisMs: 200 }));
    seedLine(chart, [10, 20, 30, 40, 50]);
    const id2 = chart.addLineSeries();
    chart.setSeriesData(
      id2,
      [200, 220, 210, 230, 250].map((value, i) => ({ time: 1_000_000 + i * INTERVAL, value })),
    );
    raf.flush(20);

    // Both series visible → range covers [10, 250].
    const both = chart.getYRange();
    expect(both.min).toBeLessThanOrEqual(10);
    expect(both.max).toBeGreaterThanOrEqual(250);

    // Hide the high-Y series — the chart should EASE down to the new
    // range (matching the series fade-out), not snap.
    chart.setSeriesVisible(id2, false);
    raf.flush(1);
    const oneFrame = chart.getYRange();
    expect(oneFrame.max).toBeLessThan(both.max); // started moving
    expect(oneFrame.max).toBeGreaterThan(50); // not yet settled

    // After draining, the max settles at the lower series' range.
    raf.flush(60); // 60 frames × 16 ms = ~960 ms — well past 250 ms visibility default
    const hidden = chart.getYRange();
    expect(hidden.max).toBeLessThan(100);
  });
});
