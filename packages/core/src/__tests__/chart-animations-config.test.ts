/**
 * Covers the chart-level `animations` surface in two layers:
 *   1. {@link resolveAnimationsConfig} — pure mapping from public surface to
 *      the resolved flat config.
 *   2. {@link ChartInstance} — confirms the resolved config propagates to
 *      series defaults (observed via renderer state).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AnimationConfig,
  type AnimationsConfig,
  DEFAULT_CANDLESTICK_ENTRY,
  DEFAULT_CANDLESTICK_SMOOTH,
  DEFAULT_LINE_ENTRY,
  DEFAULT_LINE_PULSE,
  DEFAULT_LINE_SMOOTH,
  DEFAULT_X_GESTURE,
  DEFAULT_Y_VISIBILITY,
} from '../animation/config';
import { ChartInstance } from '../chart';
import type { CandlestickRenderer } from '../series/candlestick';

const resolveAnimationsConfig = (input: boolean | AnimationsConfig | undefined) => AnimationConfig.resolve(input);

describe('resolveAnimationsConfig', () => {
  it('defaults to all categories on when undefined', () => {
    expect(resolveAnimationsConfig(undefined)).toMatchObject({
      y: { gestureMs: 100, visibilityMs: DEFAULT_Y_VISIBILITY, transition: expect.any(Function) },
      x: { dataTickMs: 250, gestureMs: DEFAULT_X_GESTURE },
      series: {
        line: { entryMs: DEFAULT_LINE_ENTRY, smoothMs: DEFAULT_LINE_SMOOTH, pulseMs: DEFAULT_LINE_PULSE },
        candlestick: { entryMs: DEFAULT_CANDLESTICK_ENTRY, smoothMs: DEFAULT_CANDLESTICK_SMOOTH },
      },
      axis: { tickFadeMs: 250 },
    });
  });

  it('true is equivalent to undefined', () => {
    const a = resolveAnimationsConfig(true);
    const b = resolveAnimationsConfig(undefined);
    // transition is a freshly-constructed factory each call (reference inequality
    // is expected), so compare shape minus the factory and assert separately
    // that both produced a factory.
    const { transition: aT, ...aY } = a.y;
    const { transition: bT, ...bY } = b.y;
    expect({ ...a, y: aY }).toEqual({ ...b, y: bY });
    expect(typeof aT).toBe('function');
    expect(typeof bT).toBe('function');
  });

  it('false collapses every field to 0', () => {
    expect(resolveAnimationsConfig(false)).toMatchObject({
      y: { gestureMs: 0, visibilityMs: 0, transition: expect.any(Function) },
      x: { dataTickMs: 0, gestureMs: 0 },
      series: {
        line: { entryMs: 0, smoothMs: 0, pulseMs: 0 },
        candlestick: { entryMs: 0, smoothMs: 0 },
        bar: { entryMs: 0, smoothMs: 0 },
      },
      axis: { tickFadeMs: 0 },
    });
  });

  it('category-level false disables every field in that category', () => {
    expect(resolveAnimationsConfig({ series: false })).toMatchObject({
      series: {
        line: { entryMs: 0, smoothMs: 0, pulseMs: 0 },
        candlestick: { entryMs: 0, smoothMs: 0 },
        bar: { entryMs: 0, smoothMs: 0 },
      },
      y: { gestureMs: 100, visibilityMs: DEFAULT_Y_VISIBILITY, transition: expect.any(Function) },
    });
    expect(resolveAnimationsConfig({ y: false })).toMatchObject({
      series: {
        line: { entryMs: DEFAULT_LINE_ENTRY, smoothMs: DEFAULT_LINE_SMOOTH, pulseMs: DEFAULT_LINE_PULSE },
      },
      y: { gestureMs: 0, visibilityMs: 0, transition: expect.any(Function) },
    });
  });

  it('per-type false disables only that series type', () => {
    const resolved = resolveAnimationsConfig({ series: { line: false } });
    expect(resolved.series.line).toEqual({ entryMs: 0, smoothMs: 0, pulseMs: 0 });
    expect(resolved.series.candlestick.entryMs).toBe(DEFAULT_CANDLESTICK_ENTRY);
  });

  it('per-field false disables only that field', () => {
    const resolved = resolveAnimationsConfig({ series: { line: { smooth: false } } });
    expect(resolved.series.line.smoothMs).toBe(0);
    expect(resolved.series.line.entryMs).toBe(DEFAULT_LINE_ENTRY);
  });

  it('numeric overrides flow through', () => {
    const out = resolveAnimationsConfig({ series: { line: { entry: 1200, pulse: 1500 } } });
    expect(out.series.line.entryMs).toBe(1200);
    expect(out.series.line.pulseMs).toBe(1500);
    expect(out.series.line.smoothMs).toBe(DEFAULT_LINE_SMOOTH);
  });

  it('string time inputs parse', () => {
    const out = resolveAnimationsConfig({ y: { visibility: '500ms' }, x: { gesture: '0.1s' } });
    expect(out.y.visibilityMs).toBe(500);
    expect(out.x.gestureMs).toBe(100);
  });
});

describe('ChartInstance.animations propagation', () => {
  // Pin `performance.now()` so the chart's `#applyEngineState` ticks land on
  // the same clock the test's direct `engine.tick(now)` calls use. Without
  // this the engine's `effectiveNow` walks past the wall clock the chart
  // captures inside `emit*`, and zero-duration instant emits get pruned
  // before their slot processor sees them.
  let nowMs = 0;
  beforeEach(() => {
    nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeChart(animations?: boolean | AnimationsConfig): ChartInstance {
    const container = document.createElement('div');
    return new ChartInstance(container, { animations });
  }

  function candleRenderer(
    chart: ChartInstance,
    opts?: Parameters<ChartInstance['addCandlestickSeries']>[0],
  ): CandlestickRenderer {
    const id = chart.addCandlestickSeries(opts);
    const entry = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: CandlestickRenderer }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === id)!;
    return entry.renderer;
  }

  /**
   * Route data through the chart so the bridge emits entrance + live-track
   * events into the engine. Read the resolved state to see if entrance fired
   * and whether the live OHLC slot snapped to the new close (smoothing off)
   * vs eased toward it (smoothing on). `hasEntry` is true when the chart
   * actually claimed an `entry` slot for the appended candle's time.
   */
  /**
   * Route data through the chart so the bridge emits entrance + live-track
   * events into the engine. Drive the engine forward 1 ms past the emit to
   * resolve zero-duration claims (`entryMs: 0` / `smoothMs: 0`) into their
   * final state; non-zero durations land partway and the assertion below
   * picks that up.
   */
  function addAndAppendCandle(chart: ChartInstance): { hasEntry: boolean; snappedOnUpdate: boolean } {
    const seriesId = chart.addCandlestickSeries();
    chart.setSeriesData(seriesId, [{ time: 10, open: 10, high: 12, low: 9, close: 11 }]);
    chart.appendData(seriesId, { time: 20, open: 10, high: 12, low: 9, close: 11 });

    // Renderer owns the entry registry now; reach in directly to assert
    // whether the chart's appendData routed through the entrance path.
    const renderer = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: CandlestickRenderer }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === seriesId)?.renderer as unknown as {
      entries: Map<number, unknown>;
      displayedLast: { close: number } | null;
    };
    const hasEntry = renderer.entries.has(20);

    chart.updateData(seriesId, { time: 20, open: 10, high: 18, low: 9, close: 18 });
    // Drive a render frame so the renderer's `tickAnimations(performance.now())`
    // advances the live-OHLC chase exactly one step.
    nowMs += 1;
    const snappedOnUpdate = renderer.displayedLast?.close === 18;

    return { hasEntry, snappedOnUpdate };
  }

  function addLineAndAppend(chart: ChartInstance): { hasEntry: boolean } {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 10, value: 5 },
      { time: 20, value: 6 },
    ]);
    chart.appendData(id, { time: 30, value: 8 });

    const renderer = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: unknown }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === id)?.renderer as unknown as {
      entries: Array<Map<number, unknown>>;
    };
    const hasEntry = renderer.entries[0]?.has(30) ?? false;

    return { hasEntry };
  }

  it('default: entrance registers an entry; live-tracking smooths', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart());
    expect(hasEntry).toBe(true);
    expect(snappedOnUpdate).toBe(false);
  });

  it('animations: false disables every category', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart(false));
    expect(hasEntry).toBe(false);
    expect(snappedOnUpdate).toBe(true);
  });

  it('animations.series: false disables entrance + smoothing + pulse', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart({ series: false }));
    expect(hasEntry).toBe(false);
    expect(snappedOnUpdate).toBe(true);
  });

  it('animations.series.candlestick.entry: false disables only entrance', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart({ series: { candlestick: { entry: false } } }));
    expect(hasEntry).toBe(false);
    expect(snappedOnUpdate).toBe(false);
  });

  it('animations.series.candlestick.smooth: false disables only live-tracking', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart({ series: { candlestick: { smooth: false } } }));
    expect(hasEntry).toBe(true);
    expect(snappedOnUpdate).toBe(true);
  });

  it('line series also respects the entrance gate', () => {
    const { hasEntry } = addLineAndAppend(makeChart(false));
    expect(hasEntry).toBe(false);
  });

  it('chart-level entry acts as default when series omits it', () => {
    const r = candleRenderer(makeChart({ series: { candlestick: { entry: 800 } } }));
    const opts = (r as unknown as { options: { entryMs?: number } }).options;
    expect(opts.entryMs).toBe(800);
  });

  it('per-series entryMs wins over chart-level default', () => {
    const r = candleRenderer(makeChart({ series: { candlestick: { entry: 800 } } }), { entryMs: 200 });
    const opts = (r as unknown as { options: { entryMs?: number } }).options;
    expect(opts.entryMs).toBe(200);
  });

  it('chart-level smooth: false forces snap even if per-series sets a number', () => {
    const r = candleRenderer(makeChart({ series: { candlestick: { smooth: false } } }), { smoothMs: 500 });
    const opts = (r as unknown as { options: { smoothMs?: number | false } }).options;
    expect(opts.smoothMs).toBe(0);
  });
});
