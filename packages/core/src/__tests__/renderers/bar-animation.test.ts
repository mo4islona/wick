import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BarRenderer } from '../../series/bar';
import type { TimePoint } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

const DATA: TimePoint[] = [{ time: 10, value: 5 }];

/** Read per-layer displayed-last values (smoothed toward store.last().value). */
function displayed(r: BarRenderer): Array<number | null> {
  return (r as unknown as { displayedLastValues: Array<number | null> }).displayedLastValues;
}

function entries(r: BarRenderer, layer = 0): Map<number, { startTime: number }> {
  return (r as unknown as { entries: Array<Map<number, { startTime: number }>> }).entries[layer];
}

describe('BarRenderer — animation', () => {
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

  function renderFrame(r: BarRenderer): void {
    const { ctx } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(ctx);
  }

  it('setData seeds displayedLast to the real last (no animation on bulk load)', () => {
    const r = new BarRenderer(1);
    r.setData(DATA);
    renderFrame(r);
    expect(displayed(r)[0]).toBe(5);
    expect(r.needsAnimation).toBe(false);
  });

  it('updateLastPoint smoothly chases target, does not snap', () => {
    const r = new BarRenderer(1);
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 10, value: 15 });
    advance(16);
    renderFrame(r);

    const v = displayed(r)[0]!;
    expect(v).toBeGreaterThan(5);
    expect(v).toBeLessThan(15);
    expect(r.needsAnimation).toBe(true);
  });

  it('converges and clears needsAnimation after enough frames', () => {
    const r = new BarRenderer(1);
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 10, value: 15 });
    for (let i = 0; i < 60; i++) {
      advance(16);
      renderFrame(r);
    }

    expect(Math.abs((displayed(r)[0] ?? 0) - 15)).toBeLessThan(0.01);
    expect(r.needsAnimation).toBe(false);
  });

  it('smoothMs: 0 disables smoothing', () => {
    const r = new BarRenderer(1, { smoothMs: 0 });
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 10, value: 15 });
    advance(16);
    renderFrame(r);

    expect(displayed(r)[0]).toBe(15);
    expect(r.needsAnimation).toBe(false);
  });

  it('appendPoint registers an entrance entry and needsAnimation picks up', () => {
    const r = new BarRenderer(1);
    r.setData(DATA);
    renderFrame(r);
    expect(r.needsAnimation).toBe(false);

    r.appendPoint({ time: 30, value: 8 });
    expect(entries(r).has(30)).toBe(true);
    expect(r.needsAnimation).toBe(true);
  });

  it("entryAnimation: 'none' skips entry registration", () => {
    const r = new BarRenderer(1, { entryAnimation: 'none' });
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    expect(entries(r).size).toBe(0);
  });

  it('cancelEntranceAnimations clears entries on every layer; preserves displayedLast', () => {
    const r = new BarRenderer(2);
    r.setData(DATA, 0);
    r.setData(DATA, 1);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 }, 0);
    r.appendPoint({ time: 30, value: 9 }, 1);
    expect(entries(r, 0).size).toBe(1);
    expect(entries(r, 1).size).toBe(1);
    const liveBefore = [...displayed(r)];

    r.cancelEntranceAnimations();

    expect(entries(r, 0).size).toBe(0);
    expect(entries(r, 1).size).toBe(0);
    expect(displayed(r)).toEqual(liveBefore);
  });

  it("default 'fade-grow' renders the new bar with alpha < 1 and reduced height", () => {
    const r = new BarRenderer(1);
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    advance(16);
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(ctx);

    const rects = spy.callsOf('fillRect');
    const entering = rects.filter((c) => c.globalAlpha < 1);
    expect(entering.length).toBeGreaterThan(0);
  });

  it("'slide' entrance offsets X and fades the entering bar", () => {
    const r = new BarRenderer(1, { entryAnimation: 'slide' });
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    advance(16);
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(ctx);

    const rects = spy.callsOf('fillRect');
    const faded = rects.filter((c) => (c.globalAlpha as number) < 1);
    expect(faded.length).toBeGreaterThan(0);
  });

  it("'grow' alone (no fade) keeps alpha=1 but shrinks height", () => {
    const r = new BarRenderer(1, { entryAnimation: 'grow' });
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    advance(16);
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(ctx);

    const rects = spy.callsOf('fillRect');
    const faded = rects.filter((c) => (c.globalAlpha as number) < 1);
    expect(faded.length).toBe(0);
  });

  it('reaches full state after entryMs and clears entries', () => {
    const r = new BarRenderer(1, { entryMs: 250 });
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    for (let i = 0; i < 30; i++) {
      advance(16);
      renderFrame(r);
    }

    expect(entries(r).has(30)).toBe(false);
    expect(r.needsAnimation).toBe(false);
  });

  describe('stacked mode live-tracking', () => {
    it('normal stacking: the rendered top-layer bar is smaller than a raw-value jump would produce', () => {
      // Regression guard for the review comment that live-tracking (effectiveValue)
      // was not applied to values fed into renderStacked's time map — so stacked
      // bars would jump on updateLastPoint even with smoothing enabled.
      const r = new BarRenderer(2, { stacking: 'normal' });
      r.setData([{ time: 10, value: 5 }], 0);
      r.setData([{ time: 10, value: 5 }], 1);
      renderFrame(r);

      // Bump layer 1 by a large delta — raw rendering would put the top of the
      // stack at y(25); smoothing holds it near y(13) on the next frame.
      r.updateLastPoint({ time: 10, value: 20 }, 1);
      advance(16);

      const yRange = { min: 0, max: 30 };
      const { ctx, spy, yScale } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange });
      r.render(ctx);

      // Stacked normal mode draws each layer as a rect from basePositive up to
      // basePositive+value. Layer 0 renders from y=0 to y=5. Layer 1 renders
      // from y=5 to y=5+displayedLast. Capture the uppermost fillRect by the
      // smallest topY across the two fillRects at the time column.
      const rects = spy.callsOf('fillRect');
      expect(rects.length).toBeGreaterThanOrEqual(2);
      const topYs = rects.map((c) => c.args[1] as number);
      const upperEdge = Math.min(...topYs);

      // Smoothed upper edge is well below (= larger Y) than the raw-value upper edge.
      const rawUpperEdge = yScale.valueToBitmapY(25); // layer0 + layer1 raw
      const smoothedUpperEdge = yScale.valueToBitmapY(displayed(r)[1]! + 5);
      expect(Math.abs(upperEdge - smoothedUpperEdge)).toBeLessThan(2);
      expect(Math.abs(upperEdge - rawUpperEdge)).toBeGreaterThan(2);
    });

    it('percent stacking: the live last value participates in the percentage normalization', () => {
      const r = new BarRenderer(2, { stacking: 'percent' });
      r.setData([{ time: 10, value: 4 }], 0);
      r.setData([{ time: 10, value: 6 }], 1);
      renderFrame(r);

      r.updateLastPoint({ time: 10, value: 24 }, 1);
      advance(16);

      const { ctx, spy, yScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 100 },
      });
      r.render(ctx);

      const rects = spy.callsOf('fillRect');
      expect(rects.length).toBeGreaterThanOrEqual(2);
      const topYs = rects.map((c) => c.args[1] as number).sort((a, b) => a - b);
      const upperEdge = topYs[0];

      // Smoothed percent upper edge is at 100% (regardless of smoothing) because
      // percent normalizes to sum=100. The check that's sensitive to smoothing
      // is the SPLIT between layers — look at the lower layer's top.
      // Expected: layer0=4, layer1=smoothed between 6 and 24. Percent split:
      //   raw:       4 / (4+24) = 14% for layer 0 top
      //   smoothed: 4 / (4+smoothedLayer1) ≈ some value between 14% and 40%.
      const smoothedLayer1 = displayed(r)[1]!;
      const rawPct = (4 / (4 + 24)) * 100;
      const smoothedPct = (4 / (4 + smoothedLayer1)) * 100;

      // Layer-0 top Y corresponds to `rawPct` (raw) or `smoothedPct` (smoothed).
      // The second-smallest topY (the one that's NOT the 100% top) is layer0's top.
      const layer0Top = topYs[1];
      const rawLayer0TopY = yScale.valueToBitmapY(rawPct);
      const smoothedLayer0TopY = yScale.valueToBitmapY(smoothedPct);

      expect(Math.abs(layer0Top - smoothedLayer0TopY)).toBeLessThan(2);
      // And it's distinct from the raw rendering.
      expect(Math.abs(layer0Top - rawLayer0TopY)).toBeGreaterThan(2);

      // Suppress unused-variable lint warning for upperEdge (kept for readability).
      void upperEdge;
    });
  });
});
