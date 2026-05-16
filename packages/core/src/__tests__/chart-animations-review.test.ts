/**
 * Regressions for PR #35 review findings. Each `describe` reproduces one
 * issue against the public `ChartInstance` API and tolerates no test-only
 * escape hatches that would let the bug hide.
 */
import { describe, expect, it } from 'vitest';

import { ChartInstance, type ChartOptions } from '../chart';
import type { BarRenderer } from '../series/bar';
import type { CandlestickRenderer } from '../series/candlestick';
import type { LineRenderer } from '../series/line';

function makeChart(animations?: ChartOptions['animations']): ChartInstance {
  const container = document.createElement('div');
  return new ChartInstance(container, { animations });
}

function candleRenderer(
  chart: ChartInstance,
  opts?: Parameters<ChartInstance['addCandlestickSeries']>[0],
): {
  id: string;
  renderer: CandlestickRenderer;
} {
  const id = chart.addCandlestickSeries(opts);
  const entry = (chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: CandlestickRenderer }> })
    .listSeriesForTest()
    .find((s) => s.id === id)!;
  return { id, renderer: entry.renderer };
}

function lineRenderer(
  chart: ChartInstance,
  opts?: Parameters<ChartInstance['addLineSeries']>[0],
): {
  id: string;
  renderer: LineRenderer;
} {
  const id = chart.addLineSeries(opts);
  const entry = (chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: LineRenderer }> })
    .listSeriesForTest()
    .find((s) => s.id === id)!;
  return { id, renderer: entry.renderer };
}

function barRenderer(
  chart: ChartInstance,
  opts?: Parameters<ChartInstance['addBarSeries']>[0],
): {
  id: string;
  renderer: BarRenderer;
} {
  const id = chart.addBarSeries(opts);
  const entry = (chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: BarRenderer }> })
    .listSeriesForTest()
    .find((s) => s.id === id)!;
  return { id, renderer: entry.renderer };
}

/**
 * Issue 1 — React wrappers replay the user's options on every render via
 * `updateSeriesOptions`; this path must enforce the same chart-level
 * force-off gates that `addXSeries` applies, otherwise
 * `animations.points: false` silently re-enables the moment the series
 * gets its next options pass.
 */
describe('updateSeriesOptions honors chart-level animation gates', () => {
  it('candlestick: chart-level animations: false cannot be re-enabled by updateSeriesOptions', () => {
    const chart = makeChart(false);
    const { id, renderer } = candleRenderer(chart);
    const opts = () => (renderer as unknown as { options: { enterMs?: number; smoothMs?: number } }).options;

    expect(opts().enterMs).toBe(0);
    expect(opts().smoothMs).toBe(0);

    chart.updateSeriesOptions(id, { enterMs: 400, smoothMs: 500 });

    expect(opts().enterMs).toBe(0);
    expect(opts().smoothMs).toBe(0);
  });

  it('line: chart-level series.line.entry: false holds across updateSeriesOptions', () => {
    const chart = makeChart({ series: { line: { entry: false } } });
    const { id, renderer } = lineRenderer(chart);
    const opts = () => (renderer as unknown as { options: { enterMs?: number } }).options;

    expect(opts().enterMs).toBe(0);
    chart.updateSeriesOptions(id, { enterMs: 600 });
    expect(opts().enterMs).toBe(0);
  });

  it('bar: chart-level series.bar.smooth: false holds across updateSeriesOptions', () => {
    const chart = makeChart({ series: { bar: { smooth: false } } });
    const { id, renderer } = barRenderer(chart);
    const opts = () => (renderer as unknown as { options: { smoothMs?: number } }).options;

    expect(opts().smoothMs).toBe(0);
    chart.updateSeriesOptions(id, { smoothMs: 500 });
    expect(opts().smoothMs).toBe(0);
  });

  it('when the chart-level gate is open, updateSeriesOptions flows through unchanged', () => {
    const chart = makeChart();
    const { id, renderer } = candleRenderer(chart);
    const opts = () => (renderer as unknown as { options: { smoothMs?: number } }).options;

    chart.updateSeriesOptions(id, { smoothMs: 500 });
    expect(opts().smoothMs).toBe(500);
  });
});
