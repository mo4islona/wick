import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BarRenderer } from '../../series/bar';
import { LineRenderer } from '../../series/line';
import { buildRenderContext } from '../helpers/render-context';

describe('Visibility fade — renderer geometry tracks layerAlpha', () => {
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

  describe('bar non-stacked', () => {
    it('layer fading out shrinks bar height proportionally to alpha (no off-canvas fly)', () => {
      const r = new BarRenderer(2, {
        colors: ['#00aa00', '#aa0000'],
        stacking: 'off',
        entryAnimation: 'none',
      });
      // Layer 0 stays at small value, layer 1 is the "big" series being toggled off.
      r.setData([{ time: 50, value: 10 }], 0);
      r.setData([{ time: 50, value: 500 }], 1);

      // Start fade-out of layer 1. Chart's `setLayerVisible(false)` would also
      // flip `store.isVisible() = false`, but we drive alpha alone here to
      // assert the geometry contract independent of the store flag.
      r.setLayerAlpha(1, 0, 250);

      advance(125);

      const { ctx, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 525 },
      });
      r.render(ctx);

      const alpha = r.getLayerAlpha(1);
      expect(alpha).toBeLessThan(1);
      expect(alpha).toBeGreaterThan(0);

      // Layer 1's bar: identified by its color (colors[1] = '#aa0000').
      const fills = spy.callsOf('fillRect');
      const layer1Fill = fills.find((c) => c.fillStyle === '#aa0000');
      expect(layer1Fill).toBeDefined();

      // After fix: drawn value = 500 * alpha → height in bitmap pixels =
      // (500 * alpha / 525) * bitmapHeight. Before fix: drawn value = 500 →
      // height = (500 / 525) * bitmapHeight ≈ 95% of bitmap. The 8x mismatch
      // is what the user sees as the bar "flying" off-canvas when the Y axis
      // shrinks to [0, ~10] (without this layer).
      const bitmapHeight = ctx.scope.bitmapSize.height;
      const expectedHeight = ((500 * alpha) / 525) * bitmapHeight;
      // Allow ±1px tolerance for Math.max(1, ...) and rounding inside bar.ts.
      expect(layer1Fill?.args[3] as number).toBeCloseTo(expectedHeight, 0);
    });

    it('fully faded layer (alpha=0) is excluded from rendering', () => {
      const r = new BarRenderer(2, {
        colors: ['#00aa00', '#aa0000'],
        stacking: 'off',
        entryAnimation: 'none',
      });
      r.setData([{ time: 50, value: 10 }], 0);
      r.setData([{ time: 50, value: 500 }], 1);

      // Snap alpha to 0 (duration=0).
      r.setLayerAlpha(1, 0, 0);

      const { ctx, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.render(ctx);

      // Only layer 0 renders.
      const fills = spy.callsOf('fillRect');
      expect(fills).toHaveLength(1);
      expect(fills[0].fillStyle).toBe('#00aa00');
    });
  });

  describe('bar stacked percent', () => {
    it("fading layer's share smoothly redistributes during fade (not binary)", () => {
      const r = new BarRenderer(2, {
        colors: ['#00aa00', '#0000aa'],
        stacking: 'percent',
        entryAnimation: 'none',
      });
      r.setData([{ time: 50, value: 10 }], 0);
      r.setData([{ time: 50, value: 10 }], 1);

      r.setLayerAlpha(1, 0, 250);
      advance(125);

      const { ctx, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 100 },
      });
      r.render(ctx);

      const alpha = r.getLayerAlpha(1);
      expect(alpha).toBeLessThan(1);
      expect(alpha).toBeGreaterThan(0);

      // After fix: layer 1 contributes value*alpha to the total, so layer 0's
      // share grows smoothly from 50% (alpha=1) toward 100% (alpha=0). At
      // alpha=0.125 (easeOutCubic mid-point), layer 0 share = 10 / (10 + 1.25)
      // ≈ 88.9%. Before fix: layer 1 fully included → layer 0 share = 50%,
      // i.e. layer 0's bar covers exactly half the canvas with no transition.
      const expectedShareLayer0 = 10 / (10 + 10 * alpha);
      const bitmapHeight = ctx.scope.bitmapSize.height;
      const expectedLayer0Height = expectedShareLayer0 * bitmapHeight;

      const fills = spy.callsOf('fillRect');
      const layer0Fill = fills.find((c) => c.fillStyle === '#00aa00');
      expect(layer0Fill).toBeDefined();
      expect(layer0Fill?.args[3] as number).toBeCloseTo(expectedLayer0Height, 0);
    });

  });

  describe('line stacked normal', () => {
    it("cumulative head Y moves with fading layer's alpha (not binary jump)", () => {
      const r = new LineRenderer(2, {
        colors: ['#00aa00', '#0000aa'],
        stacking: 'normal',
        entryAnimation: 'none',
      });
      r.setData(
        [
          { time: 25, value: 10 },
          { time: 75, value: 10 },
        ],
        0,
      );
      r.setData(
        [
          { time: 25, value: 5 },
          { time: 75, value: 5 },
        ],
        1,
      );

      r.setLayerAlpha(1, 0, 250);
      advance(125);

      const { ctx, spy, yScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.render(ctx);

      const alpha = r.getLayerAlpha(1);
      expect(alpha).toBeLessThan(1);
      expect(alpha).toBeGreaterThan(0);

      // After fix: upper layer's cumulative = 10 + 5*alpha. Before fix: fully
      // included regardless of alpha → cumulative = 15. The visible difference
      // is the top edge of the upper area moving to where the user sees
      // smooth fade vs an instant drop.
      const expectedUpperY = yScale.valueToBitmapY(10 + 5 * alpha);
      const rawIncludedUpperY = yScale.valueToBitmapY(15);

      const ys = spy.callsOf('lineTo').map((c) => c.args[1] as number);
      // Tolerance: upper edge appears multiple times along the polyline; we
      // assert at least one occurrence matches the alpha-weighted Y, and
      // none matches the raw-included Y.
      expect(ys.some((y) => Math.abs(y - expectedUpperY) < 1)).toBe(true);
      expect(ys.some((y) => Math.abs(y - rawIncludedUpperY) < 1)).toBe(false);
    });

    it("fading layer's upper-edge stroke is drawn with globalAlpha = layerAlpha", () => {
      const r = new LineRenderer(2, {
        colors: ['#00aa00', '#0000aa'],
        stacking: 'normal',
        entryAnimation: 'none',
        strokeWidth: 2,
      });
      r.setData(
        [
          { time: 25, value: 10 },
          { time: 75, value: 10 },
        ],
        0,
      );
      r.setData(
        [
          { time: 25, value: 5 },
          { time: 75, value: 5 },
        ],
        1,
      );

      r.setLayerAlpha(1, 0, 250);
      advance(125);

      const { ctx, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.render(ctx);

      const alpha = r.getLayerAlpha(1);
      // Stroke for the fading layer must record reduced globalAlpha — fill
      // (with its gradient) is left at full alpha so the slice shape still
      // reads while the stroke fades away in lockstep with the collapse.
      const stroke = spy
        .callsOf('stroke')
        .find((c) => c.strokeStyle === '#0000aa');
      expect(stroke).toBeDefined();
      expect(stroke?.globalAlpha).toBeCloseTo(alpha, 3);
    });

    it('handoff lerp targets the next VISIBLE slice above (skipping hidden intermediate layers)', () => {
      const r = new LineRenderer(3, {
        colors: ['#00aa00', '#0000aa', '#aa00aa'],
        stacking: 'normal',
        entryAnimation: 'none',
      });
      r.setData(
        [
          { time: 25, value: 10 },
          { time: 75, value: 10 },
        ],
        0,
      );
      r.setData(
        [
          { time: 25, value: 5 },
          { time: 75, value: 5 },
        ],
        1,
      );
      r.setData(
        [
          { time: 25, value: 20 },
          { time: 75, value: 20 },
        ],
        2,
      );

      // Layer 1 already fully hidden. Layer 0 begins fading. Layer 2 stays.
      // Use yRange.min < 0 to simulate the chart's bottom padding — without
      // negative min, yScale.valueToBitmapY(0) already equals bitmapBottom
      // and the padding-residual issue this test guards against doesn't show.
      r.setLayerAlpha(1, 0, 0);
      r.setLayerAlpha(0, 0, 250);
      advance(125);

      const { ctx, spy, yScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: -50, max: 50 },
      });
      r.render(ctx);

      const alpha0 = r.getLayerAlpha(0);
      expect(alpha0).toBeLessThan(1);
      expect(alpha0).toBeGreaterThan(0);

      const bitmapBottom = ctx.scope.bitmapSize.height;
      // Natural lower for layer 2 (no fix): yScale.valueToBitmapY(cumulative[1]),
      // where cumulative[1] = value_0 * alpha_0 + value_1 * 0 = 10 * alpha_0.
      const naturalLowerY = yScale.valueToBitmapY(10 * alpha0);
      const lerpedLowerY = naturalLowerY + (bitmapBottom - naturalLowerY) * (1 - alpha0);

      // With the secondBottomVisibleLi fix, layer 2 is the handoff slice
      // (even though it's not bottomVisibleLi+1=1 — layer 1 is hidden).
      // Its lower should land at the lerped Y, not the natural one.
      const ys = spy.callsOf('lineTo').map((c) => c.args[1] as number);
      expect(ys.some((y) => Math.abs(y - lerpedLowerY) < 1)).toBe(true);
      expect(ys.some((y) => Math.abs(y - naturalLowerY) < 1)).toBe(false);
    });
  });
});
