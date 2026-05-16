import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LineRenderer } from '../../series/line';
import type { TimePoint } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

const DATA: TimePoint[] = [
  { time: 10, value: 5 },
  { time: 20, value: 6 },
];

function displayed(r: LineRenderer): Array<number | null> {
  return (r as unknown as { displayedLastValues: Array<number | null> }).displayedLastValues;
}

function entries(r: LineRenderer, layer = 0): Map<number, { startTime: number }> {
  return (r as unknown as { entries: Array<Map<number, { startTime: number }>> }).entries[layer];
}

describe('LineRenderer — animation', () => {
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

  function renderFrame(r: LineRenderer): void {
    const { ctx } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 20 } });
    r.render(ctx);
  }

  it('first render seeds displayedLast to the store last; no animation on bulk load', () => {
    const r = new LineRenderer(1);
    r.setData(DATA);
    renderFrame(r);
    expect(displayed(r)[0]).toBe(6);
    expect(r.needsAnimation).toBe(false);
  });

  it('updateLastPoint smoothly chases target', () => {
    const r = new LineRenderer(1);
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 20, value: 16 });
    advance(16);
    renderFrame(r);

    const v = displayed(r)[0]!;
    expect(v).toBeGreaterThan(6);
    expect(v).toBeLessThan(16);
    expect(r.needsAnimation).toBe(true);
  });

  it('converges and clears needsAnimation after enough frames', () => {
    const r = new LineRenderer(1);
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 20, value: 16 });
    for (let i = 0; i < 60; i++) {
      advance(16);
      renderFrame(r);
    }

    expect(Math.abs((displayed(r)[0] ?? 0) - 16)).toBeLessThan(0.01);
    expect(r.needsAnimation).toBe(false);
  });

  it('smoothMs: 0 disables smoothing', () => {
    const r = new LineRenderer(1, { smoothMs: 0 });
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 20, value: 16 });
    advance(16);
    renderFrame(r);

    expect(displayed(r)[0]).toBe(16);
    expect(r.needsAnimation).toBe(false);
  });

  it('appendPoint registers an entrance entry (default grow)', () => {
    const r = new LineRenderer(1);
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    expect(entries(r).has(30)).toBe(true);
    expect(r.needsAnimation).toBe(true);
  });

  it("entryAnimation: 'none' skips entry registration", () => {
    const r = new LineRenderer(1, { entryAnimation: 'none' });
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    expect(entries(r).size).toBe(0);
  });

  it('entrance completes after entryMs and clears the entry', () => {
    const r = new LineRenderer(1, { entryMs: 250 });
    r.setData(DATA);
    renderFrame(r);

    r.appendPoint({ time: 30, value: 8 });
    for (let i = 0; i < 30; i++) {
      advance(16);
      renderFrame(r);
    }

    expect(entries(r).has(30)).toBe(false);
  });

  it('cancelEntranceAnimations clears entries on every layer; preserves displayedLast', () => {
    const r = new LineRenderer(2);
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

  describe('stacked mode live-tracking', () => {
    it('normal stacking: the rendered upper edge Y tracks the smoothed layer-1 value', () => {
      const r = new LineRenderer(2, { stacking: 'normal', area: { visible: false } });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);

      r.updateLastPoint({ time: 20, value: 14 }, 1);
      advance(16);

      const yRange = { min: 0, max: 30 };
      const { ctx, spy, yScale } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange });
      r.render(ctx);

      // The stacked render draws two strokes (one per layer). The topmost path's
      // last `lineTo` is at the upper cumulative at time=20 — i.e. y(4 + smoothed).
      // Without effectiveValue in the stacked path, it would be y(4 + 14) = y(18).
      const lineTos = spy.callsOf('lineTo');
      expect(lineTos.length).toBeGreaterThan(0);
      const topYs = lineTos.map((c) => c.args[1] as number);
      const highestEdge = Math.min(...topYs);

      const smoothed = displayed(r)[1]!;
      const smoothedCumulativeY = yScale.valueToBitmapY(4 + smoothed);
      const rawCumulativeY = yScale.valueToBitmapY(4 + 14);

      expect(Math.abs(highestEdge - smoothedCumulativeY)).toBeLessThan(2);
      expect(Math.abs(highestEdge - rawCumulativeY)).toBeGreaterThan(2);
    });

    it('percent stacking: the layer-split Y reflects the smoothed last value', () => {
      const r = new LineRenderer(2, { stacking: 'percent', area: { visible: false } });
      r.setData(
        [
          { time: 10, value: 2 },
          { time: 20, value: 3 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 2 },
          { time: 20, value: 7 },
        ],
        1,
      );
      renderFrame(r);

      r.updateLastPoint({ time: 20, value: 27 }, 1);
      advance(16);

      const { ctx, spy, yScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 100 },
      });
      r.render(ctx);

      const lineTos = spy.callsOf('lineTo');
      expect(lineTos.length).toBeGreaterThan(0);

      // Layer-0 cumulative at time=20 is 3 / (3 + smoothed) * 100, vs raw 3/(3+27)*100=10%.
      const smoothed = displayed(r)[1]!;
      const smoothedPct = (3 / (3 + smoothed)) * 100;
      const rawPct = (3 / (3 + 27)) * 100;

      // The layer-0 path's Y at x=time=20 (rightmost) — the lowest of the two layer strokes.
      // Capture the largest Y (smallest percentage → biggest screen Y for typical yScale).
      const ys = lineTos.map((c) => c.args[1] as number);
      const lowestPath = Math.max(...ys); // bottom of chart for smallest percent
      const expectedSmoothedY = yScale.valueToBitmapY(smoothedPct);
      const expectedRawY = yScale.valueToBitmapY(rawPct);

      expect(Math.abs(lowestPath - expectedSmoothedY)).toBeLessThan(2);
      expect(Math.abs(lowestPath - expectedRawY)).toBeGreaterThan(2);
    });
  });

  describe("stacked mode 'grow' entrance animates the trailing segment", () => {
    it("normal stacking: trailing X of the rendered stroke is between penultimate and new during 'grow'", () => {
      const r = new LineRenderer(2, {
        stacking: 'normal',
        area: { visible: false },
        entryAnimation: 'grow',
        entryMs: 400,
      });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);

      r.appendPoint({ time: 30, value: 6 }, 0);
      r.appendPoint({ time: 30, value: 6 }, 1);
      advance(100); // partway into the 400ms entrance

      const { ctx, spy, timeScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 30 },
      });
      r.render(ctx);

      const lineTos = spy.callsOf('lineTo');
      const X20 = timeScale.timeToBitmapX(20);
      const X30 = timeScale.timeToBitmapX(30);

      // At least one trailing endpoint must sit strictly between the penultimate
      // and new X — that's the lerped tail of the growing segment.
      const xs = lineTos.map((c) => c.args[0] as number);
      const between = xs.filter((x) => x > X20 + 1 && x < X30 - 1);
      expect(between.length).toBeGreaterThan(0);
    });

    it('normal stacking: trailing X lands on the new X after the entrance completes', () => {
      const r = new LineRenderer(2, {
        stacking: 'normal',
        area: { visible: false },
        entryAnimation: 'grow',
        entryMs: 200,
      });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);

      r.appendPoint({ time: 30, value: 6 }, 0);
      r.appendPoint({ time: 30, value: 6 }, 1);
      for (let i = 0; i < 30; i++) {
        advance(16);
        renderFrame(r);
      }

      const { ctx, spy, timeScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 30 },
      });
      r.render(ctx);

      const lineTos = spy.callsOf('lineTo');
      const X30 = timeScale.timeToBitmapX(30);
      // At least one stroke endpoint must land at X30 (within 1px) once progress hits 1.
      const xs = lineTos.map((c) => c.args[0] as number);
      const atX30 = xs.filter((x) => Math.abs(x - X30) < 1);
      expect(atX30.length).toBeGreaterThan(0);
    });

    it("'fade' entrance ramps globalAlpha on the stacked layer", () => {
      const r = new LineRenderer(2, {
        stacking: 'normal',
        area: { visible: false },
        entryAnimation: 'fade',
        entryMs: 400,
      });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);

      r.appendPoint({ time: 30, value: 6 }, 1);
      advance(100);

      const { ctx, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 30 },
      });
      r.render(ctx);

      // Each recorded call snapshots globalAlpha; the layer-1 stroke must run
      // with reduced alpha during the fade entrance.
      const strokes = spy.callsOf('stroke');
      expect(strokes.length).toBeGreaterThan(0);
      const lowAlphaStroke = strokes.some((c) => c.globalAlpha < 0.99);
      expect(lowAlphaStroke).toBe(true);
    });

    it('off-screen append must not lerp the on-screen trailing segment', () => {
      const r = new LineRenderer(2, {
        stacking: 'normal',
        area: { visible: false },
        entryAnimation: 'grow',
        entryMs: 400,
      });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);

      // Append at a time well outside the viewport (timeRange below is 0..30).
      r.appendPoint({ time: 5000, value: 6 }, 0);
      r.appendPoint({ time: 5000, value: 6 }, 1);
      advance(100);

      const { ctx, spy, timeScale } = buildRenderContext({
        timeRange: { from: 0, to: 30 },
        yRange: { min: 0, max: 30 },
      });
      r.render(ctx);

      // The rightmost on-screen X for both layers' strokes should land on
      // time=20 (un-lerped) — the appended off-screen point must not pull
      // the visible tail toward the off-screen X.
      const X20 = timeScale.timeToBitmapX(20);
      const lineToXs = spy.callsOf('lineTo').map((c) => c.args[0] as number);
      // No on-screen lineTo X should sit strictly between time=10 and time=20
      // due to a phantom lerp.
      const X10 = timeScale.timeToBitmapX(10);
      const onScreenXs = lineToXs.filter((x) => x >= X10 - 1 && x <= X20 + 1);
      const stuckAtX20 = onScreenXs.filter((x) => Math.abs(x - X20) < 0.5);
      expect(stuckAtX20.length).toBeGreaterThan(0);
    });

    it("hidden layer 0 with active 'grow' must not shift layer 1's lower edge", () => {
      const r = new LineRenderer(2, {
        stacking: 'normal',
        area: { visible: true },
        entryAnimation: 'grow',
        entryMs: 400,
      });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);
      r.setLayerVisible(0, false);

      r.appendPoint({ time: 30, value: 6 }, 0);
      r.appendPoint({ time: 30, value: 6 }, 1);
      advance(100);

      const { ctx, spy, timeScale, yScale } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 30 },
      });
      r.render(ctx);

      // With layer 0 hidden, layer 1's lower edge sits at y(0) (the zero line).
      // The fill polygon's bottom-right corner must land at (X30, y(0)) — never
      // a lerped X — because layer 0's progress is gated out by isVisible().
      const X30 = timeScale.timeToBitmapX(30);
      const yZero = yScale.valueToBitmapY(0);
      const lineTos = spy.callsOf('lineTo');
      const matches = lineTos.filter(
        (c) => Math.abs((c.args[0] as number) - X30) < 0.5 && Math.abs((c.args[1] as number) - yZero) < 0.5,
      );
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe('pulse-dot in stacked mode aligns with the rendered cumulative line', () => {
    it("normal stacking: pulse Y on layer 1 is at y(layer-0 + layer-1's smoothed last)", () => {
      const r = new LineRenderer(2, { pulse: true, stacking: 'normal', area: { visible: false } });
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 3 },
          { time: 20, value: 4 },
        ],
        1,
      );
      renderFrame(r);

      r.updateLastPoint({ time: 20, value: 14 }, 1);
      advance(16);
      // advance smoothed value by running render once
      renderFrame(r);
      const smoothed = displayed(r)[1]!;

      const { overlayCtx, yScale, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 30 },
      });
      r.drawOverlay(overlayCtx());

      // Pulse arcs come in pairs (glow + dot) per visible layer; the topmost
      // (smallest Y) belongs to layer 1 — that's where the bug surfaced.
      const arcs = spy.callsOf('arc');
      expect(arcs.length).toBeGreaterThan(0);
      const topArcY = Math.min(...arcs.map((c) => c.args[1] as number));

      const expectedStackedY = yScale.valueToBitmapY(4 + smoothed);
      const buggyRawY = yScale.valueToBitmapY(smoothed);

      expect(Math.abs(topArcY - expectedStackedY)).toBeLessThan(1);
      expect(Math.abs(topArcY - buggyRawY)).toBeGreaterThan(2);
    });

    it('percent stacking: pulse Y on layer 0 sits at its percent share, not the raw value', () => {
      const r = new LineRenderer(2, { pulse: true, stacking: 'percent', area: { visible: false } });
      r.setData(
        [
          { time: 10, value: 2 },
          { time: 20, value: 3 },
        ],
        0,
      );
      r.setData(
        [
          { time: 10, value: 2 },
          { time: 20, value: 7 },
        ],
        1,
      );
      renderFrame(r);

      r.updateLastPoint({ time: 20, value: 27 }, 1);
      advance(16);
      renderFrame(r);
      const smoothed = displayed(r)[1]!;

      const { overlayCtx, yScale, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 100 },
      });
      r.drawOverlay(overlayCtx());

      const arcs = spy.callsOf('arc');
      expect(arcs.length).toBeGreaterThan(0);
      const arcYs = arcs.map((c) => c.args[1] as number);
      // Layer-0 pulse (lower of the two) sits at its percent share.
      const layer0Y = Math.max(...arcYs);
      const expectedLayer0Y = yScale.valueToBitmapY((3 / (3 + smoothed)) * 100);
      const buggyRawY = yScale.valueToBitmapY(3); // raw value, not percent

      expect(Math.abs(layer0Y - expectedLayer0Y)).toBeLessThan(1);
      expect(Math.abs(layer0Y - buggyRawY)).toBeGreaterThan(2);
    });
  });

  it('pulse-dot position uses the smoothed last value', () => {
    const r = new LineRenderer(1, { pulse: true });
    r.setData(DATA);
    renderFrame(r);

    r.updateLastPoint({ time: 20, value: 18 });
    advance(16);
    // advanceLiveTracking only runs inside render() — trigger once, read smoothed value.
    renderFrame(r);
    const smoothedValue = displayed(r)[0]!;

    // Draw overlay and assert the pulse arc's y matches the smoothed value's Y,
    // not the raw 18.
    const { overlayCtx, yScale, spy } = buildRenderContext({
      timeRange: { from: 0, to: 100 },
      yRange: { min: 0, max: 20 },
    });
    r.drawOverlay(overlayCtx());
    const arcs = spy.callsOf('arc');
    // Arcs include crosshair (none here) and pulse (two per visible layer: glow + dot).
    expect(arcs.length).toBeGreaterThan(0);
    const arcY = arcs[0].args[1] as number;
    expect(Math.abs(arcY - yScale.valueToBitmapY(smoothedValue))).toBeLessThan(1);
    expect(Math.abs(arcY - yScale.valueToBitmapY(18))).toBeGreaterThan(1);
  });

  describe('pulse-dot X follows the trailing-segment entrance', () => {
    it("'grow' entrance: pulse X is between penultimate and new X during the animation", () => {
      const r = new LineRenderer(1, {
        pulse: true,
        entryAnimation: 'grow',
        entryMs: 400,
      });
      r.setData(DATA);
      renderFrame(r);

      r.appendPoint({ time: 30, value: 9 });
      advance(16);

      // Render main once to advance per-frame state; pulse dot is drawn in drawOverlay.
      renderFrame(r);

      const { overlayCtx, timeScale, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.drawOverlay(overlayCtx());
      const arcs = spy.callsOf('arc');
      expect(arcs.length).toBeGreaterThan(0);
      const arcX = arcs[0].args[0] as number;

      const penulX = timeScale.timeToBitmapX(20);
      const lastX = timeScale.timeToBitmapX(30);
      // Strictly between penultimate and new — confirms the interpolation wired in.
      expect(arcX).toBeGreaterThan(penulX);
      expect(arcX).toBeLessThan(lastX);
    });

    it('pulse dot X lands at the raw last-point X after the entrance completes', () => {
      const r = new LineRenderer(1, {
        pulse: true,
        entryAnimation: 'grow',
        entryMs: 250,
      });
      r.setData(DATA);
      renderFrame(r);

      r.appendPoint({ time: 30, value: 9 });
      // Run past the entrance duration.
      for (let i = 0; i < 30; i++) {
        advance(16);
        renderFrame(r);
      }

      const { overlayCtx, timeScale, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.drawOverlay(overlayCtx());
      const arcs = spy.callsOf('arc');
      expect(arcs.length).toBeGreaterThan(0);
      const arcX = arcs[0].args[0] as number;

      const lastX = timeScale.timeToBitmapX(30);
      expect(Math.abs(arcX - lastX)).toBeLessThan(1);
    });

    it("'entryAnimation: none' — pulse dot X snaps to the new X on the first frame", () => {
      const r = new LineRenderer(1, {
        pulse: true,
        entryAnimation: 'none',
      });
      r.setData(DATA);
      renderFrame(r);

      r.appendPoint({ time: 30, value: 9 });
      advance(16);
      renderFrame(r);

      const { overlayCtx, timeScale, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      r.drawOverlay(overlayCtx());
      const arcs = spy.callsOf('arc');
      expect(arcs.length).toBeGreaterThan(0);
      const arcX = arcs[0].args[0] as number;

      const lastX = timeScale.timeToBitmapX(30);
      expect(Math.abs(arcX - lastX)).toBeLessThan(1);
    });
  });

  describe('trailingEndpoint — non-finite penultimate guard', () => {
    it('does not lerp through a NaN penultimate during the grow animation', () => {
      // Seed data whose penultimate point is NaN. Without the guard,
      // `lerp(penulY, lastRawY, progress)` feeds NaN into the Y and the
      // pulse-dot overlay renders at (NaN, NaN), which poisons canvas calls.
      const r = new LineRenderer(1, { entryMs: 250 });
      r.setData([
        { time: 10, value: 5 },
        { time: 20, value: Number.NaN as unknown as number },
      ]);
      renderFrame(r);

      r.appendPoint({ time: 30, value: 8 });
      // Advance mid-animation so `progress < 1` and the lerp would normally fire.
      advance(120);

      const { ctx, overlayCtx, spy } = buildRenderContext({
        timeRange: { from: 0, to: 100 },
        yRange: { min: 0, max: 20 },
      });
      // Must not throw, and no NaN coords may reach canvas.
      expect(() => r.render(ctx)).not.toThrow();
      expect(() => r.drawOverlay(overlayCtx())).not.toThrow();
      for (const call of spy.calls) {
        for (const arg of call.args) {
          if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
        }
      }
    });
  });
});
