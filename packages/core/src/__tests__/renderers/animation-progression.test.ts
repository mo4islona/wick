/**
 * Frame-by-frame progression: verifies that repeated renders between
 * `appendPoint` and the entrance duration observe a strictly monotonic
 * increase in progress (alpha, height, X — whichever the style drives).
 *
 * Unit suites elsewhere prove each individual frame has progress < 1; these
 * tests prove the animation actually *moves* over the render loop, which is
 * the regression most easily missed when wiring up the chart-side scheduler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeSeriesStore } from '../../data/store';
import { BarRenderer } from '../../series/bar';
import { CandlestickRenderer } from '../../series/candlestick';
import { LineRenderer } from '../../series/line';
import type { OHLCData, TimePoint } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

function mkOhlcStore(data: OHLCData[]): TimeSeriesStore<OHLCData> {
  const s = new TimeSeriesStore<OHLCData>();
  s.setData(data);

  return s;
}

describe('entrance animation — frame-by-frame progression', () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    now += ms;
  }

  it('candlestick fade: globalAlpha on the new candle strictly increases across frames', () => {
    const store = mkOhlcStore([{ time: 10, open: 10, high: 12, low: 9, close: 11 }]);
    const r = new CandlestickRenderer(store, {
      entryAnimation: 'fade',
      entryMs: 250,
    });
    const { ctx: priming } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(priming);

    r.appendPoint({ time: 30, open: 10, high: 12, low: 9, close: 11 });

    const alphaByFrame: number[] = [];
    for (let i = 0; i < 6; i++) {
      advance(16);
      const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
      r.render(ctx);
      const faded = spy.calls.filter((c) => c.method === 'fillRect' && c.globalAlpha < 1).map((c) => c.globalAlpha);
      // Grab the MAX faded alpha for that frame — represents the entering candle's
      // current progress (other primitives not entering run at alpha=1).
      if (faded.length > 0) alphaByFrame.push(Math.max(...faded));
    }

    // Every recorded frame's alpha must be > the previous (strict increase).
    for (let i = 1; i < alphaByFrame.length; i++) {
      expect(alphaByFrame[i]).toBeGreaterThan(alphaByFrame[i - 1]);
    }
    // And at least one frame shows meaningful progress.
    expect(alphaByFrame.length).toBeGreaterThan(2);
  });

  it('bar fade-grow: bar height on the new bar strictly increases while alpha rises', () => {
    const r = new BarRenderer(1, { entryAnimation: 'fade-grow', entryMs: 250 });
    r.setData([{ time: 10, value: 5 }]);
    const { ctx: priming } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(priming);

    r.appendPoint({ time: 30, value: 15 });

    const heightByFrame: number[] = [];
    const alphaByFrame: number[] = [];
    for (let i = 0; i < 6; i++) {
      advance(16);
      const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
      r.render(ctx);
      const faded = spy.calls.filter((c) => c.method === 'fillRect' && c.globalAlpha < 1);
      if (faded.length > 0) {
        // The entering bar is the one with alpha < 1. Its height is args[3].
        heightByFrame.push(Math.max(...faded.map((c) => c.args[3] as number)));
        alphaByFrame.push(Math.max(...faded.map((c) => c.globalAlpha)));
      }
    }

    expect(heightByFrame.length).toBeGreaterThan(2);
    for (let i = 1; i < heightByFrame.length; i++) {
      expect(heightByFrame[i]).toBeGreaterThanOrEqual(heightByFrame[i - 1]);
      expect(alphaByFrame[i]).toBeGreaterThan(alphaByFrame[i - 1]);
    }
  });

  it('line grow: trailing-segment X strictly advances from penultimate toward new point', () => {
    // Disable areaFill so the only `lineTo` calls are for the polyline itself —
    // with areaFill enabled, two extra `lineTo` calls at the chart's bottom
    // corners close the fill path and would clobber our "last lineTo" heuristic.
    const r = new LineRenderer(1, { entryAnimation: 'grow', entryMs: 250, area: { visible: false } });
    const base: TimePoint[] = [
      { time: 10, value: 5 },
      { time: 20, value: 6 },
    ];
    r.setData(base);
    const { ctx: priming } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(priming);

    r.appendPoint({ time: 30, value: 8 });

    const trailingXByFrame: number[] = [];
    for (let i = 0; i < 6; i++) {
      advance(16);
      const { ctx, spy, timeScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.render(ctx);
      // Without areaFill, the last `lineTo` on the path is the trailing endpoint.
      const lineTos = spy.callsOf('lineTo');
      if (lineTos.length > 0) {
        const trailing = lineTos[lineTos.length - 1];
        trailingXByFrame.push(trailing.args[0] as number);

        // Sanity: the trailing X sits between the penultimate X (time=20) and
        // the new-point X (time=30). At progress=0 it's at penultimate X;
        // at progress=1 it's at new-point X.
        const penulX = timeScale.timeToBitmapX(20);
        const lastX = timeScale.timeToBitmapX(30);
        expect(trailing.args[0]).toBeGreaterThanOrEqual(penulX - 1);
        expect(trailing.args[0]).toBeLessThanOrEqual(lastX + 1);
      }
    }

    // And the endpoint advances monotonically across frames.
    for (let i = 1; i < trailingXByFrame.length; i++) {
      expect(trailingXByFrame[i]).toBeGreaterThanOrEqual(trailingXByFrame[i - 1]);
    }
  });

  it('candlestick entrance completes exactly at entryMs', () => {
    const store = mkOhlcStore([{ time: 10, open: 10, high: 12, low: 9, close: 11 }]);
    const r = new CandlestickRenderer(store, { entryAnimation: 'fade', entryMs: 250 });
    const { ctx: priming } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(priming);

    r.appendPoint({ time: 30, open: 10, high: 12, low: 9, close: 11 });

    // One frame short of duration — still animating.
    advance(240);
    const { ctx: a } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(a);
    expect(r.needsAnimation).toBe(true);

    // Past duration — done.
    advance(20);
    const { ctx: b } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(b);
    expect(r.needsAnimation).toBe(false);
  });
});
