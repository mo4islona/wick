import { describe, expect, it } from 'vitest';

import { PieRenderer } from '../../series/pie';
import { catppuccin } from '../../theme/themes/catppuccin';
import type { PieSliceData } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

const SLICES: PieSliceData[] = [
  { label: 'A', value: 50 },
  { label: 'B', value: 30 },
  { label: 'C', value: 20 },
];

describe('PieRenderer.render', () => {
  it('empty data → zero draw calls', () => {
    const r = new PieRenderer();
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);
    expect(spy.calls).toHaveLength(0);
  });

  it('N slices → N arc() calls', () => {
    // Disable labels to isolate slice-arc count from label anchor-dot arcs.
    const r = new PieRenderer({ sliceLabels: { mode: 'none' } });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    // Pie: outer arc per slice (no inner arc because innerRadiusRatio=0 → lineTo center).
    expect(spy.countOf('arc')).toBe(3);
  });

  it('slice angle is proportional to value', () => {
    const r = new PieRenderer({ padAngle: 0, sliceLabels: { mode: 'none' } });
    r.setData([
      { label: 'half', value: 50 },
      { label: 'quarter', value: 25 },
      { label: 'quarter2', value: 25 },
    ]);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    const arcs = spy.callsOf('arc');
    expect(arcs).toHaveLength(3);

    const startAngle0 = arcs[0].args[3] as number;
    const endAngle0 = arcs[0].args[4] as number;
    const sweep0 = endAngle0 - startAngle0;
    const startAngle1 = arcs[1].args[3] as number;
    const endAngle1 = arcs[1].args[4] as number;
    const sweep1 = endAngle1 - startAngle1;
    // First slice (50%) sweeps ~twice the second (25%).
    expect(sweep0).toBeCloseTo(sweep1 * 2, 2);
  });

  it('innerRadiusRatio > 0 → donut: each slice draws both an outer and an inner arc', () => {
    const r = new PieRenderer({ innerRadiusRatio: 0.5, sliceLabels: { mode: 'none' } });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    // With donut, each slice draws 2 arcs (outer + reverse inner).
    expect(spy.countOf('arc')).toBe(6);
  });

  it('each slice fills with a radial gradient (depth effect)', () => {
    const r = new PieRenderer({ sliceLabels: { mode: 'none' } });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    // One createRadialGradient per slice.
    expect(spy.countOf('createRadialGradient')).toBe(3);
    const fills = spy.callsOf('fill');
    expect(fills).toHaveLength(3);
    for (const f of fills) expect(f.fillStyle).toContain('gradient(radial');
  });
});

describe('PieRenderer.hitTest', () => {
  it('returns correct slice index for a point inside the pie', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData([
      { label: 'top-right', value: 25 }, // rendering starts at top, sweeps clockwise
      { label: 'bottom-right', value: 25 },
      { label: 'bottom-left', value: 25 },
      { label: 'top-left', value: 25 },
    ]);
    // Clearly in the top-right quadrant (above center, right of center).
    expect(r.hitTest(260, 140, 400, 400)).toBe(0);
    // Clearly in the bottom-right quadrant.
    expect(r.hitTest(260, 260, 400, 400)).toBe(1);
    // Clearly in the bottom-left quadrant.
    expect(r.hitTest(140, 260, 400, 400)).toBe(2);
    // Clearly in the top-left quadrant.
    expect(r.hitTest(140, 140, 400, 400)).toBe(3);
  });

  it('returns -1 for a point outside the outer radius', () => {
    const r = new PieRenderer();
    r.setData(SLICES);
    expect(r.hitTest(10, 10, 400, 400)).toBe(-1);
  });

  it('returns -1 for a point in the donut hole when innerRadiusRatio > 0', () => {
    const r = new PieRenderer({ innerRadiusRatio: 0.7 });
    r.setData(SLICES);
    // Center point — well inside the inner radius.
    expect(r.hitTest(200, 200, 400, 400)).toBe(-1);
  });

  it('returns -1 on empty data', () => {
    const r = new PieRenderer();
    expect(r.hitTest(100, 100, 400, 400)).toBe(-1);
  });
});

/**
 * Title / InfoBar overlays reserve space via `viewport.padding.top` (and
 * symmetric bottom). For time-based renderers this is absorbed by the YScale,
 * but Pie is purely spatial — it must shift its center and shrink its radius
 * by the reserved bitmap-pixel band, otherwise the chart visibly overlaps the
 * Title. These tests pin the contract for both the painter and the hit-test
 * (they have to stay in sync — a hover that doesn't follow the visible center
 * means the hit-target falls outside the rendered pie).
 */
describe('PieRenderer — Title / padding offsets', () => {
  it('default padding (0/0) keeps the pie centered on the canvas — regression', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext({ mediaWidth: 400, mediaHeight: 400 });
    r.render(ctx);

    const arcs = spy.callsOf('arc');
    expect(arcs.length).toBeGreaterThan(0);
    // arc(cx, cy, radius, startAngle, endAngle, ...)
    const cx = arcs[0].args[0] as number;
    const cy = arcs[0].args[1] as number;
    expect(cx).toBeCloseTo(200);
    expect(cy).toBeCloseTo(200);
  });

  it('padding.top shifts the pie center down by half the reservation', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      padding: { top: 80, bottom: 0 },
    });
    r.render(ctx);

    const arcs = spy.callsOf('arc');
    // Usable height = 400 - 80 = 320 → cy = 80 + 320/2 = 240
    const cy = arcs[0].args[1] as number;
    expect(cy).toBeCloseTo(240);
  });

  it('padding.bottom raises the center by half the reservation', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      padding: { top: 0, bottom: 60 },
    });
    r.render(ctx);

    const arcs = spy.callsOf('arc');
    // Usable height = 400 - 60 = 340 → cy = 0 + 340/2 = 170
    const cy = arcs[0].args[1] as number;
    expect(cy).toBeCloseTo(170);
  });

  it('symmetric top+bottom padding keeps the center on the geometric midline', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      padding: { top: 50, bottom: 50 },
    });
    r.render(ctx);

    const cy = spy.callsOf('arc')[0].args[1] as number;
    expect(cy).toBeCloseTo(200);
  });

  it('padding shrinks the outer radius (radius constrained by usable height)', () => {
    // Outside labels (the new default) reserve horizontal space and shrink
    // the radius — irrelevant to this test, which is purely about vertical
    // padding geometry. Disable them so the expected numbers are computable
    // from min(width, height) alone.
    const noPad = new PieRenderer({ padAngle: 0, sliceLabels: { mode: 'none' } });
    noPad.setData(SLICES);
    const { ctx: ctx1, spy: spy1 } = buildRenderContext({ mediaWidth: 400, mediaHeight: 400 });
    noPad.render(ctx1);
    const radiusUnpadded = spy1.callsOf('arc')[0].args[2] as number;

    const padded = new PieRenderer({ padAngle: 0, sliceLabels: { mode: 'none' } });
    padded.setData(SLICES);
    const { ctx: ctx2, spy: spy2 } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      padding: { top: 100, bottom: 0 },
    });
    padded.render(ctx2);
    const radiusPadded = spy2.callsOf('arc')[0].args[2] as number;

    // Unpadded: min(400,400)/2 * 0.85 = 170. Padded: min(400, 300)/2 * 0.85 = 127.5.
    expect(radiusUnpadded).toBeCloseTo(170);
    expect(radiusPadded).toBeCloseTo(127.5);
    expect(radiusPadded).toBeLessThan(radiusUnpadded);
  });

  it('padding is converted from CSS px to bitmap px via verticalPixelRatio', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    // dpr=2 → 800x800 bitmap. Padding top=40 CSS px → 80 bitmap px.
    // Usable bitmap height = 800 - 80 = 720 → cy = 80 + 360 = 440.
    const { ctx, spy } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      pixelRatio: 2,
      padding: { top: 40, bottom: 0 },
    });
    r.render(ctx);

    const cy = spy.callsOf('arc')[0].args[1] as number;
    expect(cy).toBeCloseTo(440);
  });

  it('over-sized padding clamps so cy stays inside the bitmap and radius is non-negative', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    const { ctx, spy } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      padding: { top: 500, bottom: 500 },
    });
    // Should not throw and should not produce a negative-radius arc.
    expect(() => r.render(ctx)).not.toThrow();
    const arcs = spy.callsOf('arc');
    if (arcs.length > 0) {
      const cy = arcs[0].args[1] as number;
      const radius = arcs[0].args[2] as number;
      // top is clamped to bitmapHeight (400); bottom to bitmapHeight - top (0);
      // usable = 0; cy = 400 + 0 = 400. Stays at the bottom edge instead of
      // landing past it (would be 500 without the upper clamp).
      expect(cy).toBeLessThanOrEqual(400);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(radius).toBeGreaterThanOrEqual(0);
    }
  });

  it('hitTest follows the shifted center — points the legacy pie covered now miss', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData([
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
      { label: 'c', value: 1 },
      { label: 'd', value: 1 },
    ]);
    // Legacy: pie centered at (200, 200) with maxR ≈ 170.
    // With top=160 (bitmap) padding: pie shifts to cy=280 with maxR ≈ 102.
    // Point (200, 50) is 150 px from the legacy center (inside the 170 radius)
    // but 230 px from the shifted center (well outside the 102 radius). The
    // regression we're guarding: the hit-test must follow the visible chart,
    // not stay anchored to the geometric canvas midline.
    const padding = { top: 160, bottom: 0 };
    expect(r.hitTest(200, 50, 400, 400)).toBeGreaterThanOrEqual(0); // legacy hit
    expect(r.hitTest(200, 50, 400, 400, padding)).toBe(-1); // padded miss
    // And the shifted center is hittable.
    expect(r.hitTest(200, 280, 400, 400, padding)).toBeGreaterThanOrEqual(0);
  });

  it('hitTest with no padding argument behaves like the legacy un-padded center — backwards compatible', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData(SLICES);
    // Same call shape that pre-fix tests use; must still hit center.
    expect(r.hitTest(200, 200, 400, 400)).toBeGreaterThanOrEqual(0);
  });

  it('render and hitTest agree on the center under padding', () => {
    const r = new PieRenderer({ padAngle: 0 });
    r.setData([
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
      { label: 'c', value: 1 },
      { label: 'd', value: 1 },
    ]);
    const padding = { top: 100, bottom: 20 };
    const { ctx, spy } = buildRenderContext({
      mediaWidth: 400,
      mediaHeight: 400,
      padding,
    });
    r.render(ctx);

    const cx = spy.callsOf('arc')[0].args[0] as number;
    const cy = spy.callsOf('arc')[0].args[1] as number;
    // Hit at the painted center → must resolve to a slice. If render and
    // hitTest used different geometry, this would silently miss.
    expect(r.hitTest(cx, cy, 400, 400, padding)).toBeGreaterThanOrEqual(0);
  });
});

describe('PieRenderer.getSliceInfo / getHoverInfo', () => {
  it('getSliceInfo returns percentages that sum to 100', () => {
    const r = new PieRenderer();
    r.setData(SLICES);
    const info = r.getSliceInfo(catppuccin.theme);
    expect(info).not.toBeNull();
    const total = info!.reduce((s, e) => s + e.percent, 0);
    expect(total).toBeCloseTo(100);
    expect(info!.map((e) => e.label)).toEqual(['A', 'B', 'C']);
  });

  it('getHoverInfo returns null when nothing hovered, and the slice when set', () => {
    const r = new PieRenderer();
    r.setData(SLICES);
    expect(r.getHoverInfo(catppuccin.theme)).toBeNull();

    r.setHoverIndex(1);
    const info = r.getHoverInfo(catppuccin.theme);
    expect(info?.label).toBe('B');
    expect(info?.value).toBe(30);
    expect(info?.percent).toBeCloseTo(30);
  });

  it('getSliceInfo returns null on empty data', () => {
    const r = new PieRenderer();
    expect(r.getSliceInfo(catppuccin.theme)).toBeNull();
  });
});
