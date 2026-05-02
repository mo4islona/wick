import { describe, expect, it } from 'vitest';

import { TimeSeriesStore } from '../data/store';
import { BarRenderer } from '../series/bar';
import { CandlestickRenderer } from '../series/candlestick';
import { LineRenderer } from '../series/line';
import { PieRenderer } from '../series/pie';
import type { SeriesRenderer } from '../series/types';
import { catppuccin } from '../theme/themes/catppuccin';
import type { OHLCData } from '../types';

/** Sanity-check: every concrete renderer implements the required SeriesRenderer members. */
function assertImplements(r: SeriesRenderer): void {
  expect(typeof r.render).toBe('function');
  expect(typeof r.setData).toBe('function');
  expect(typeof r.getLayerCount).toBe('function');
  expect(typeof r.setLayerVisible).toBe('function');
  expect(typeof r.isLayerVisible).toBe('function');
  expect(typeof r.getLayerColors).toBe('function');
  expect(typeof r.applyTheme).toBe('function');
  expect(typeof r.updateOptions).toBe('function');
  expect(typeof r.dispose).toBe('function');
}

describe('SeriesRenderer interface', () => {
  it('PieRenderer implements the required members', () => {
    const r = new PieRenderer();
    assertImplements(r);
    expect(r.getLayerCount()).toBe(1);
    expect(r.isLayerVisible(0)).toBe(true);
    // Pie opts into the hover + slice-info protocol.
    expect(typeof r.hitTest).toBe('function');
    expect(typeof r.setHoverIndex).toBe('function');
    expect(typeof r.getHoverInfo).toBe('function');
    expect(typeof r.getSliceInfo).toBe('function');
  });

  it('CandlestickRenderer implements the required members; layer count = 1', () => {
    const store = new TimeSeriesStore<OHLCData>();
    const r = new CandlestickRenderer(store, {
      up: { body: '#0f0', wick: '#0f0' },
      down: { body: '#f00', wick: '#f00' },
      bodyWidthRatio: 0.6,
    });
    assertImplements(r);
    expect(r.getLayerCount()).toBe(1);
    expect(r.isLayerVisible(0)).toBe(true);
  });

  it('LineRenderer implements the required members; layer count matches constructor', () => {
    const r = new LineRenderer(3);
    assertImplements(r);
    expect(r.getLayerCount()).toBe(3);
    // Default: every layer visible.
    expect(r.isLayerVisible(0)).toBe(true);
    expect(r.isLayerVisible(1)).toBe(true);
    expect(r.isLayerVisible(2)).toBe(true);
    r.setLayerVisible(1, false);
    expect(r.isLayerVisible(1)).toBe(false);
    expect(r.isLayerVisible(0)).toBe(true);
  });

  it('BarRenderer implements the required members; layer count matches constructor', () => {
    const r = new BarRenderer(2);
    assertImplements(r);
    expect(r.getLayerCount()).toBe(2);
    r.setLayerVisible(0, false);
    expect(r.isLayerVisible(0)).toBe(false);
  });

  it('LineRenderer.setData writes to the right layer (layerIndex)', () => {
    const r = new LineRenderer(2, { stacking: 'off' });
    r.setData([{ time: 1, value: 100 }], 0);
    r.setData([{ time: 1, value: 200 }], 1);
    // Use getValueRange (multi-layer off) to inspect both layers.
    expect(r.getValueRange(0, 100)).toEqual({ min: 100, max: 200 });
  });

  it('BarRenderer.setData writes to the right layer (layerIndex)', () => {
    const r = new BarRenderer(2, { stacking: 'off' });
    r.setData([{ time: 1, value: 5 }], 0);
    r.setData([{ time: 1, value: 50 }], 1);
    expect(r.getValueRange(0, 100)).toEqual({ min: 5, max: 50 });
  });

  it('PieRenderer.setData replaces slice data', () => {
    const r = new PieRenderer();
    r.setData([
      { label: 'A', value: 30 },
      { label: 'B', value: 70 },
    ]);
    expect(r.getData()).toHaveLength(2);
    r.setData([{ label: 'C', value: 100 }]);
    expect(r.getData()).toHaveLength(1);
  });

  it('getTotalLength() reports summed store lengths on multi-layer renderers', () => {
    const line = new LineRenderer(2);
    expect(line.getTotalLength()).toBe(0);
    line.setData(
      [
        { time: 1, value: 1 },
        { time: 2, value: 2 },
      ],
      0,
    );
    line.setData([{ time: 1, value: 3 }], 1);
    expect(line.getTotalLength()).toBe(3);

    const bar = new BarRenderer(3);
    bar.setData([{ time: 1, value: 1 }], 0);
    bar.setData([{ time: 1, value: 2 }], 1);
    bar.setData([{ time: 1, value: 3 }], 2);
    expect(bar.getTotalLength()).toBe(3);
  });

  it('onDataChanged fires once per setData call; unsubscribe stops further notifications', () => {
    const r = new LineRenderer(2);
    let calls = 0;
    const off = r.onDataChanged(() => {
      calls++;
    });
    r.setData([{ time: 1, value: 1 }], 0);
    r.setData([{ time: 1, value: 2 }], 1);
    // Two setData calls on two stores, each fires 'update' once; listener was
    // registered on BOTH stores, so it receives one notification per store per setData.
    // Each setData touches one store → one notification. Total: 2.
    expect(calls).toBe(2);
    off();
    r.setData([{ time: 3, value: 3 }], 0);
    expect(calls).toBe(2);
  });

  it('PieRenderer.onDataChanged fires on setData', () => {
    const r = new PieRenderer();
    let calls = 0;
    const off = r.onDataChanged!(() => {
      calls++;
    });
    r.setData([{ label: 'A', value: 1 }]);
    r.setData([{ label: 'B', value: 2 }]);
    expect(calls).toBe(2);
    off();
    r.setData([{ label: 'C', value: 3 }]);
    expect(calls).toBe(2);
  });

  it('dispose() clears listeners so subsequent updates do not fire them', () => {
    const r = new LineRenderer(2);
    let calls = 0;
    r.onDataChanged(() => {
      calls++;
    });
    r.setData([{ time: 1, value: 1 }], 0);
    expect(calls).toBe(1);
    r.dispose();
    r.setData([{ time: 2, value: 2 }], 0);
    expect(calls).toBe(1);
  });

  it('applyTheme is a no-op for pie (theme resolved at render time)', () => {
    const r = new PieRenderer({ innerRadiusRatio: 0.5 });
    r.setData([{ label: 'A', value: 10 }]);
    const before = r.getSliceInfo!(catppuccin.theme);
    // catppuccin.theme is the default; applying the same theme shouldn't change outputs.
    r.applyTheme(catppuccin.theme, catppuccin.theme);
    const after = r.getSliceInfo!(catppuccin.theme);
    expect(after).toEqual(before);
  });

  // Typed view into renderer internals for assertions without adding a public API.
  type LineInternal = { options: { strokeWidth: number; colors: string[] } };

  it('LineRenderer.applyTheme syncs strokeWidth when it still matches the previous theme default', () => {
    const prev = { ...catppuccin.theme, line: { ...catppuccin.theme.line, width: 1 } };
    const next = { ...catppuccin.theme, line: { ...catppuccin.theme.line, width: 4 } };

    const r = new LineRenderer(1, { strokeWidth: 1 });
    r.applyTheme(next, prev);

    expect((r as unknown as LineInternal).options.strokeWidth).toBe(4);
  });

  it('LineRenderer.applyTheme preserves a user-pinned strokeWidth (does not match prev default)', () => {
    const prev = { ...catppuccin.theme, line: { ...catppuccin.theme.line, width: 1 } };
    const next = { ...catppuccin.theme, line: { ...catppuccin.theme.line, width: 4 } };

    const r = new LineRenderer(1, { strokeWidth: 8 });
    r.applyTheme(next, prev);

    expect((r as unknown as LineInternal).options.strokeWidth).toBe(8);
  });

  it('LineRenderer.applyTheme syncs single-layer color when it still matches the previous theme default', () => {
    const prev = { ...catppuccin.theme, line: { ...catppuccin.theme.line, color: '#111111' } };
    const next = { ...catppuccin.theme, line: { ...catppuccin.theme.line, color: '#222222' } };

    const r = new LineRenderer(1, { colors: ['#111111'] });
    r.applyTheme(next, prev);

    expect((r as unknown as LineInternal).options.colors[0]).toBe('#222222');
  });

  it('LineRenderer.applyTheme preserves a user-pinned color (does not match prev default)', () => {
    const prev = { ...catppuccin.theme, line: { ...catppuccin.theme.line, color: '#111111' } };
    const next = { ...catppuccin.theme, line: { ...catppuccin.theme.line, color: '#222222' } };

    const r = new LineRenderer(1, { colors: ['#abcdef'] });
    r.applyTheme(next, prev);

    expect((r as unknown as LineInternal).options.colors[0]).toBe('#abcdef');
  });
});
