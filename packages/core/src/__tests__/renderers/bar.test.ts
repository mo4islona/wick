import { describe, expect, it } from 'vitest';

import { BarRenderer } from '../../series/bar';
import type { TimePoint } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

function ts(n: number, seed: (i: number) => number): TimePoint[] {
  return Array.from({ length: n }, (_, i) => ({ time: i * 10 + 5, value: seed(i) }));
}

describe('BarRenderer.render', () => {
  it('empty stores → zero draw calls', () => {
    const r = new BarRenderer(1);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);
    expect(spy.calls).toHaveLength(0);
  });

  it('single-layer positive values: one fillRect per bar with the positive color', () => {
    const r = new BarRenderer(1, { colors: ['#00aa00', '#aa0000'], stacking: 'off' });
    r.setData(ts(4, (i) => i + 1));
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 10 } });
    r.render(ctx);

    expect(spy.countOf('fillRect')).toBe(4);
    for (const c of spy.callsOf('fillRect')) {
      expect(c.fillStyle).toBe('#00aa00');
    }
  });

  it('single-layer with negative values uses colors[1], draws a zero line, and heights go downward', () => {
    const r = new BarRenderer(1, { colors: ['#00aa00', '#aa0000'], stacking: 'off' });
    r.setData([
      { time: 10, value: 3 },
      { time: 30, value: -2 },
      { time: 50, value: 5 },
    ]);
    const { ctx, spy } = buildRenderContext({ yRange: { min: -5, max: 10 } });
    r.render(ctx);

    const fills = spy.callsOf('fillRect');
    expect(fills).toHaveLength(3);
    const negativeFill = fills.find((c) => c.fillStyle === '#aa0000');
    expect(negativeFill).toBeDefined();
    // Zero line drawn as a stroke segment.
    expect(spy.matchesSequence(['beginPath', 'moveTo', 'lineTo', 'stroke'])).toBe(true);
  });

  it('bar width respects barWidthRatio (smaller ratio → smaller bars)', () => {
    const wide = new BarRenderer(1, { colors: ['#000'], barWidthRatio: 0.9, stacking: 'off' });
    const narrow = new BarRenderer(1, { colors: ['#000'], barWidthRatio: 0.2, stacking: 'off' });
    wide.setData(ts(3, () => 5));
    narrow.setData(ts(3, () => 5));

    const opts = { yRange: { min: 0, max: 10 }, dataInterval: 10 };
    const a = buildRenderContext(opts);
    const b = buildRenderContext(opts);
    wide.render(a.ctx);
    narrow.render(b.ctx);

    const wideW = a.spy.callsOf('fillRect')[0].args[2] as number;
    const narrowW = b.spy.callsOf('fillRect')[0].args[2] as number;
    expect(wideW).toBeGreaterThan(narrowW);
  });

  it('multi-layer stacking=off: all layers overlap at the same X, tallest first', () => {
    const r = new BarRenderer(2, { colors: ['#111', '#222'], stacking: 'off' });
    r.setData([{ time: 50, value: 10 }], 0);
    r.setData([{ time: 50, value: 3 }], 1);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 15 } });
    r.render(ctx);

    const fills = spy.callsOf('fillRect');
    expect(fills).toHaveLength(2);
    // Tallest drawn first (behind).
    expect(fills[0].fillStyle).toBe('#111');
    expect(fills[1].fillStyle).toBe('#222');
    // Both share the same X position (overlap, not side-by-side).
    expect(fills[0].args[0]).toBe(fills[1].args[0]);
  });

  it('multi-layer stacking=normal: layers drawn bottom-to-top with cumulative Y offsets', () => {
    const r = new BarRenderer(2, { colors: ['#111', '#222'], stacking: 'normal' });
    r.setData([{ time: 50, value: 4 }], 0);
    r.setData([{ time: 50, value: 6 }], 1);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 20 } });
    r.render(ctx);

    const fills = spy.callsOf('fillRect');
    expect(fills).toHaveLength(2);
    // Bottom layer drawn first (rendering order = bottom-to-top).
    expect(fills[0].fillStyle).toBe('#111');
    // Top layer (y) is strictly higher (smaller Y value) because it sits on top of the first.
    const bottomY = fills[0].args[1] as number;
    const topY = fills[1].args[1] as number;
    expect(topY).toBeLessThan(bottomY);
  });

  it('hidden layer skipped in multi-layer off (still draws the visible one)', () => {
    const r = new BarRenderer(2, { colors: ['#111', '#222'], stacking: 'off' });
    r.setData([{ time: 50, value: 5 }], 0);
    r.setData([{ time: 50, value: 8 }], 1);
    // Renderer's `setLayerVisible` flips the store flag (drives Y-range
    // exclusion); geometry only stops drawing once the layer's alpha hits 0.
    // Chart calls both with `toggleMs`; here we snap alpha to 0 directly.
    r.setLayerVisible(1, false);
    r.setLayerAlpha(1, 0, 0);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 10 } });
    r.render(ctx);

    const fills = spy.callsOf('fillRect');
    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe('#111');
  });

  it('stacking=percent: getValueRange returns fixed [0, 100]', () => {
    const r = new BarRenderer(2, { stacking: 'percent' });
    r.setData([{ time: 1, value: 2 }], 0);
    r.setData([{ time: 1, value: 3 }], 1);
    expect(r.getValueRange(0, 100)).toEqual({ min: 0, max: 100 });
  });

  it('skips non-finite values in the draw loop (single-layer)', () => {
    const r = new BarRenderer(1, { colors: ['#00aa00', '#aa0000'], stacking: 'off' });
    r.setData([
      { time: 10, value: 3 },
      { time: 20, value: Number.NaN },
      { time: 30, value: null as unknown as number },
      { time: 40, value: 5 },
      { time: 50, value: Number.POSITIVE_INFINITY },
      { time: 60, value: undefined as unknown as number },
      { time: 70, value: 2 },
    ]);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 10 } });
    expect(() => r.render(ctx)).not.toThrow();

    // Exactly 3 finite values → 3 fillRects. Poisoned values produce none.
    expect(spy.countOf('fillRect')).toBe(3);
    for (const c of spy.callsOf('fillRect')) {
      for (const arg of c.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it('caps bar width when a sparse visible range would produce chart-wide bars', () => {
    // Same pathology as the single-candle case on CandlestickRenderer: very
    // few points in the visible range → raw `barWidthBitmap` claims a huge
    // fraction of the chart. The renderer caps it.
    const r = new BarRenderer(1, { colors: ['#00aa00', '#aa0000'], stacking: 'off' });
    r.setData([{ time: 5, value: 3 }]);
    const { ctx, spy } = buildRenderContext({
      timeRange: { from: 0, to: 10 },
      yRange: { min: 0, max: 10 },
      dataInterval: 5,
      mediaWidth: 800,
      pixelRatio: 1,
    });
    r.render(ctx);

    const fill = spy.callsOf('fillRect')[0];
    expect(fill).toBeDefined();
    const width = fill?.args[2] as number;
    // Cap is 30 CSS px × pixelRatio=1 = 30 bitmap px for the slot,
    // bodyWidthRatio=0.6 (default) → body ≤ ~18. Use a loose upper bound.
    expect(width).toBeLessThanOrEqual(30);
  });

  it('getValueRange filters non-finite values (no Infinity leak into min/max)', () => {
    const r = new BarRenderer(2, { colors: ['#a', '#b'], stacking: 'off' });
    r.setData(
      [
        { time: 10, value: 3 },
        { time: 20, value: Number.POSITIVE_INFINITY },
        { time: 30, value: 5 },
      ],
      0,
    );
    r.setData(
      [
        { time: 10, value: Number.NEGATIVE_INFINITY },
        { time: 20, value: -2 },
        { time: 30, value: null as unknown as number },
      ],
      1,
    );
    const range = r.getValueRange(0, 100);
    expect(range).toEqual({ min: -2, max: 5 });
  });
});
