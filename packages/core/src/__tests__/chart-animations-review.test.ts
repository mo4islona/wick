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

/** Like makeChart but seeded with a non-zero container size so the engine's
 *  state push (which guards on `size.media.width/height === 0`) actually
 *  runs and `chart.getYRange()` / `getVisibleRange()` return live values. */
function makeSizedChart(animations?: ChartOptions['animations']): ChartInstance {
  const container = document.createElement('div');
  const width = 800;
  const height = 400;
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);

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

/**
 * Engine-driven lockstep. Each chart-level event source (data ingest,
 * visibility toggle) emits a single `bridge.emit*` carrying every slot
 * claim it owns, so the engine's slot processors snap or ease them on the
 * same `effectiveNow` and `state.*` settles together — no surface lags
 * another by a frame.
 */
describe('engine-driven lockstep', () => {
  it('setSeriesVisible(false) drops alpha to 0 and contracts Y in one engine tick', () => {
    const chart = makeSizedChart({ y: { visibility: 0 } });
    const small = chart.addLineSeries();
    const big = chart.addLineSeries();
    chart.setSeriesData(small, [
      { time: 1, value: 1 },
      { time: 2, value: 5 },
    ]);
    chart.setSeriesData(big, [
      { time: 1, value: 100 },
      { time: 2, value: 500 },
    ]);

    const combinedMax = chart.getYRange().max;
    expect(combinedMax).toBeGreaterThanOrEqual(500);

    chart.setSeriesVisible(big, false);

    // visibilityMs=0 routes through the engine's zero-duration guard for
    // the Y reflow; the renderer-owned alpha animator snaps to 0
    // synchronously.
    const renderer = (
      chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: { getAlpha?: () => number } }> }
    )
      .listSeriesForTest()
      .find((s) => s.id === big);
    expect(renderer?.renderer.getAlpha?.()).toBe(0);
    expect(chart.getYRange().max).toBeLessThan(combinedMax);
  });

  it('setSeriesData (bulk replace) snaps X visual to the fitted range and Y to the new bounds atomically', () => {
    const chart = makeSizedChart();
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);
    const beforeY = chart.getYRange().max;
    const beforeX = chart.getVisibleRange().to;

    chart.setSeriesData(id, [
      { time: 100, value: 1000 },
      { time: 200, value: 2000 },
    ]);

    // First-paint guard + bulk-replace flag combine to force `instant` for
    // both X and Y emits → engine snaps both. Both new ranges are visible
    // without driving a frame.
    const afterX = chart.getVisibleRange();
    const afterY = chart.getYRange();
    expect(afterX.to).toBeGreaterThan(beforeX);
    expect(afterY.max).toBeGreaterThan(beforeY);
    expect(afterY.max).toBeGreaterThanOrEqual(2000);
  });
});
