/**
 * Pulse-halo lifecycle pinned at the engine seam. The chart's line series
 * register a `pulsePhase` slot on the engine on `addLineSeries`, deregister
 * on `removeSeries`. Pulse animation no longer runs off `performance.now()`
 * inside the renderer — it reads `state.pulsePhase` and the engine drives
 * the phase via a closed-form `(effectiveNow / period) % 1`.
 */
import { describe, expect, it } from 'vitest';

import { ChartInstance, type ChartOptions } from '../chart';

function makeChart(animations?: ChartOptions['animations']): ChartInstance {
  const container = document.createElement('div');
  return new ChartInstance(container, { animations });
}

describe('addLineSeries → engine.registerSeriesPulse', () => {
  it('default config (pulseMs > 0) registers a pulsePhase entry keyed by series id', () => {
    const chart = makeChart();
    const id = chart.addLineSeries();

    const phase = chart.getAnimationState().pulsePhase.get(id);
    // Phase is a wrap-`[0, 1)` value; engine seeds on the first tick. The
    // initial map entry may not exist before any RAF, so accept either
    // "not yet ticked" (undefined) or "seeded".
    expect(phase === undefined || (phase >= 0 && phase < 1)).toBe(true);

    // After a render frame the engine populates the entry deterministically.
    // Calling getAnimationState directly bypasses RAF — drive renderMain by
    // setting data so the inline first-paint render fires.
    chart.setSeriesData(id, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);

    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(true);
  });

  it('pulse: 0 keeps the series out of the pulse registry', () => {
    const chart = makeChart({ series: { line: { pulse: 0 } } });
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);

    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(false);
  });

  it('animations.series.line: false also disables the pulse registration', () => {
    const chart = makeChart({ series: { line: false } });
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);

    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(false);
  });

  it('animations: false disables every category including pulse', () => {
    const chart = makeChart(false);
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);

    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(false);
  });
});

describe('removeSeries → engine.unregisterSeriesPulse', () => {
  it('drops the series entry from state.pulsePhase', () => {
    const chart = makeChart();
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);
    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(true);

    chart.removeSeries(id);
    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(false);
  });

  it('removing one series leaves others registered', () => {
    const chart = makeChart();
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    chart.setSeriesData(a, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);
    chart.setSeriesData(b, [
      { time: 1, value: 3 },
      { time: 2, value: 4 },
    ]);

    chart.removeSeries(a);

    expect(chart.getAnimationState().pulsePhase.has(a)).toBe(false);
    expect(chart.getAnimationState().pulsePhase.has(b)).toBe(true);
  });
});

describe('non-line series do not register pulse entries', () => {
  it('candlestick: no pulse slot', () => {
    const chart = makeChart();
    const id = chart.addCandlestickSeries();
    chart.setSeriesData(id, [{ time: 1, open: 1, high: 2, low: 0, close: 1.5 }]);

    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(false);
  });

  it('bar: no pulse slot', () => {
    const chart = makeChart();
    const id = chart.addBarSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ]);

    expect(chart.getAnimationState().pulsePhase.has(id)).toBe(false);
  });
});
