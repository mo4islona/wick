import { describe, expect, it } from 'vitest';

import { PieRenderer } from '../series/pie';
import { catppuccin } from '../theme/themes/catppuccin';

describe('PieRenderer — hover + slice info', () => {
  const slices = [
    { label: 'A', value: 25 },
    { label: 'B', value: 25 },
    { label: 'C', value: 50 },
  ];

  it('hitTest returns -1 when data is empty', () => {
    const r = new PieRenderer();
    expect(r.hitTest(100, 100, 400, 400)).toBe(-1);
  });

  it('hitTest returns -1 for a click in the dead center of a donut', () => {
    const r = new PieRenderer({ innerRadiusRatio: 0.6 });
    r.setData(slices);
    // Click at exact center → inside inner hole.
    expect(r.hitTest(200, 200, 400, 400)).toBe(-1);
  });

  it('hitTest returns -1 for a click outside the pie radius', () => {
    const r = new PieRenderer();
    r.setData(slices);
    // Far from center — outside max radius.
    expect(r.hitTest(10, 10, 400, 400)).toBe(-1);
  });

  it('hitTest identifies the correct slice at 12-o-clock (first slice)', () => {
    const r = new PieRenderer();
    r.setData(slices);
    // Slightly above center → first slice (starts at -π/2).
    const cx = 200;
    const cy = 200;
    const index = r.hitTest(cx + 5, cy - 50, 400, 400);
    expect(index).toBe(0);
  });

  it('setHoverIndex returns true only when the value changes', () => {
    const r = new PieRenderer();
    r.setData(slices);
    expect(r.setHoverIndex(1)).toBe(true);
    expect(r.setHoverIndex(1)).toBe(false);
    expect(r.setHoverIndex(-1)).toBe(true);
  });

  it('getHoverInfo returns null when nothing is hovered', () => {
    const r = new PieRenderer();
    r.setData(slices);
    expect(r.getHoverInfo(catppuccin.theme)).toBeNull();
  });

  it('getHoverInfo returns the hovered slice with percent and palette color', () => {
    const r = new PieRenderer();
    r.setData(slices);
    r.setHoverIndex(2);
    const info = r.getHoverInfo(catppuccin.theme);
    expect(info).not.toBeNull();
    expect(info!.label).toBe('C');
    expect(info!.value).toBe(50);
    // 50 / (25 + 25 + 50) = 50%
    expect(info!.percent).toBeCloseTo(50, 5);
    expect(info!.color).toBe(catppuccin.theme.seriesColors[2 % catppuccin.theme.seriesColors.length]);
  });

  it('getSliceInfo returns every slice with computed percentages and colors', () => {
    const r = new PieRenderer();
    r.setData(slices);
    const infos = r.getSliceInfo(catppuccin.theme);
    expect(infos).not.toBeNull();
    expect(infos!.map((i) => i.label)).toEqual(['A', 'B', 'C']);
    expect(infos!.map((i) => Math.round(i.percent))).toEqual([25, 25, 50]);
    expect(infos![0].color).toBe(catppuccin.theme.seriesColors[0]);
    expect(infos![1].color).toBe(catppuccin.theme.seriesColors[1]);
  });

  it('getSliceInfo respects slice.color overrides', () => {
    const r = new PieRenderer();
    r.setData([
      { label: 'A', value: 10, color: '#ff00ff' },
      { label: 'B', value: 20 },
    ]);
    const infos = r.getSliceInfo(catppuccin.theme);
    expect(infos![0].color).toBe('#ff00ff');
    // Second slice falls back to palette[1].
    expect(infos![1].color).toBe(catppuccin.theme.seriesColors[1]);
  });

  it('getSliceInfo returns null when data is empty', () => {
    const r = new PieRenderer();
    expect(r.getSliceInfo(catppuccin.theme)).toBeNull();
  });
});
