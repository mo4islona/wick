/**
 * Covers the chart-level `animations` surface in two layers:
 *   1. {@link resolveAnimationsConfig} — pure mapping from public surface to
 *      the resolved flat config.
 *   2. {@link ChartInstance} — confirms the resolved config propagates to
 *      series defaults (observed via renderer state).
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENTER_MS,
  DEFAULT_INPUT_RESPONSE_MS,
  DEFAULT_PULSE_MS,
  DEFAULT_REBOUND_MS,
  DEFAULT_SMOOTH_MS,
  DEFAULT_Y_AXIS_MS,
} from '../animation-constants';
import { type AnimationsConfig, ChartInstance, resolveAnimationsConfig } from '../chart';
import type { CandlestickRenderer } from '../series/candlestick';
import type { LineRenderer } from '../series/line';

describe('resolveAnimationsConfig', () => {
  it('defaults to all categories on when undefined', () => {
    expect(resolveAnimationsConfig(undefined)).toEqual({
      points: { enterMs: DEFAULT_ENTER_MS, smoothMs: DEFAULT_SMOOTH_MS, pulseMs: DEFAULT_PULSE_MS },
      viewport: {
        reboundMs: DEFAULT_REBOUND_MS,
        yAxisMs: DEFAULT_Y_AXIS_MS,
        inputResponseMs: DEFAULT_INPUT_RESPONSE_MS,
      },
    });
  });

  it('true is equivalent to undefined', () => {
    expect(resolveAnimationsConfig(true)).toEqual(resolveAnimationsConfig(undefined));
  });

  it('false collapses every field to 0', () => {
    expect(resolveAnimationsConfig(false)).toEqual({
      points: { enterMs: 0, smoothMs: 0, pulseMs: 0 },
      viewport: { reboundMs: 0, yAxisMs: 0, inputResponseMs: 0 },
    });
  });

  it('category-level false disables every field in that category', () => {
    expect(resolveAnimationsConfig({ points: false })).toEqual({
      points: { enterMs: 0, smoothMs: 0, pulseMs: 0 },
      viewport: {
        reboundMs: DEFAULT_REBOUND_MS,
        yAxisMs: DEFAULT_Y_AXIS_MS,
        inputResponseMs: DEFAULT_INPUT_RESPONSE_MS,
      },
    });
    expect(resolveAnimationsConfig({ viewport: false })).toEqual({
      points: { enterMs: DEFAULT_ENTER_MS, smoothMs: DEFAULT_SMOOTH_MS, pulseMs: DEFAULT_PULSE_MS },
      viewport: { reboundMs: 0, yAxisMs: 0, inputResponseMs: 0 },
    });
  });

  it('per-field false disables only that field', () => {
    const resolved = resolveAnimationsConfig({ points: { smoothMs: false } });
    expect(resolved.points.smoothMs).toBe(0);
    expect(resolved.points.enterMs).toBe(DEFAULT_ENTER_MS);
  });

  it('numeric overrides flow through', () => {
    const out = resolveAnimationsConfig({ points: { enterMs: 1200, pulseMs: 1500 } });
    expect(out.points.enterMs).toBe(1200);
    expect(out.points.pulseMs).toBe(1500);
    expect(out.points.smoothMs).toBe(DEFAULT_SMOOTH_MS);
  });
});

describe('ChartInstance.animations propagation', () => {
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

  function addAndAppendCandle(chart: ChartInstance): { hasEntry: boolean; snappedOnUpdate: boolean } {
    const r = candleRenderer(chart);
    r.setData([{ time: 10, open: 10, high: 12, low: 9, close: 11 }]);
    r.appendPoint({ time: 20, open: 10, high: 12, low: 9, close: 11 });
    const hasEntry = (r as unknown as { entries: Map<number, unknown> }).entries.size > 0;

    // Seed displayedLast, update, advance one frame. Distinguishes smoothing on
    // (partial close) from smoothing off (full snap).
    const advance = (t: number) =>
      (r as unknown as { advanceLiveTracking: (t: number) => void }).advanceLiveTracking(t);
    advance(1);
    r.updateLastPoint({ time: 20, open: 10, high: 18, low: 9, close: 18 });
    advance(17);
    const dl = (r as unknown as { displayedLast: { close: number } }).displayedLast;
    const snappedOnUpdate = dl.close === 18;

    return { hasEntry, snappedOnUpdate };
  }

  function addLineAndAppend(chart: ChartInstance): { hasEntry: boolean } {
    const id = chart.addLineSeries();
    const entry = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: LineRenderer }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === id)!;
    const r = entry.renderer;
    r.setData([
      { time: 10, value: 5 },
      { time: 20, value: 6 },
    ]);
    r.appendPoint({ time: 30, value: 8 });
    const hasEntry = (r as unknown as { entries: Array<Map<number, unknown>> }).entries[0].size > 0;

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

  it('animations.points: false disables entrance + smoothing + pulse', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart({ points: false }));
    expect(hasEntry).toBe(false);
    expect(snappedOnUpdate).toBe(true);
  });

  it('animations.points.enterMs: false disables only entrance', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart({ points: { enterMs: false } }));
    expect(hasEntry).toBe(false);
    expect(snappedOnUpdate).toBe(false);
  });

  it('animations.points.smoothMs: false disables only live-tracking', () => {
    const { hasEntry, snappedOnUpdate } = addAndAppendCandle(makeChart({ points: { smoothMs: false } }));
    expect(hasEntry).toBe(true);
    expect(snappedOnUpdate).toBe(true);
  });

  it('line series also respects the entrance gate', () => {
    const { hasEntry } = addLineAndAppend(makeChart(false));
    expect(hasEntry).toBe(false);
  });

  it('chart-level enterMs acts as default when series omits it', () => {
    const r = candleRenderer(makeChart({ points: { enterMs: 800 } }));
    const opts = (r as unknown as { options: { enterMs?: number } }).options;
    expect(opts.enterMs).toBe(800);
  });

  it('per-series enterMs wins over chart-level default', () => {
    const r = candleRenderer(makeChart({ points: { enterMs: 800 } }), { enterMs: 200 });
    const opts = (r as unknown as { options: { enterMs?: number } }).options;
    expect(opts.enterMs).toBe(200);
  });

  it('chart-level smoothMs: false forces snap even if per-series sets a number', () => {
    const r = candleRenderer(makeChart({ points: { smoothMs: false } }), { smoothMs: 500 });
    const opts = (r as unknown as { options: { smoothMs?: number | false } }).options;
    expect(opts.smoothMs).toBe(0);
  });
});
