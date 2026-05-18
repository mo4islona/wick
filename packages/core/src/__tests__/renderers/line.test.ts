import { describe, expect, it } from 'vitest';

import { LineRenderer } from '../../series/line';
import type { TimePoint } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

function seed(n: number, offset = 0, scale = 1): TimePoint[] {
  return Array.from({ length: n }, (_, i) => ({ time: i * 10 + 5, value: offset + i * scale }));
}

describe('LineRenderer.render', () => {
  it('empty stores → zero draw calls', () => {
    const r = new LineRenderer(2);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);
    expect(spy.calls).toHaveLength(0);
  });

  it('single-layer: beginPath → moveTo → (N-1) lineTo → stroke', () => {
    const r = new LineRenderer(1, { area: { visible: false } });
    r.setData(seed(5), 0);
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 10 } });
    r.render(ctx);

    expect(spy.matchesSequence(['beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'stroke'])).toBe(true);
    expect(spy.countOf('moveTo')).toBe(1);
    expect(spy.countOf('lineTo')).toBe(4); // N-1 lineTos for N=5 points
    expect(spy.countOf('stroke')).toBe(1);
  });

  it('stroke color matches the layer color', () => {
    const r = new LineRenderer(1, { area: { visible: false }, colors: ['#abcdef'] });
    r.setData(seed(3), 0);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    const stroke = spy.callsOf('stroke')[0];
    expect(stroke?.strokeStyle).toBe('#abcdef');
  });

  it('multi-layer stacking=off: one beginPath per visible layer, distinct colors', () => {
    const r = new LineRenderer(3, { area: { visible: false }, stacking: 'off', colors: ['#111', '#222', '#333'] });
    r.setData(seed(3), 0);
    r.setData(seed(3, 10), 1);
    r.setData(seed(3, 20), 2);
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 30 } });
    r.render(ctx);

    expect(spy.countOf('beginPath')).toBe(3);
    expect(spy.countOf('stroke')).toBe(3);
    const strokeColors = spy.callsOf('stroke').map((c) => c.strokeStyle);
    expect(strokeColors).toEqual(['#111', '#222', '#333']);
  });

  it('area: { visible: true } → each layer also calls fill() with a gradient fillStyle', () => {
    const r = new LineRenderer(1, { area: { visible: true }, colors: ['#00f'] });
    r.setData(seed(4), 0);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    expect(spy.countOf('fill')).toBe(1);
    const fill = spy.callsOf('fill')[0];
    expect(fill?.fillStyle).toContain('gradient(linear');
  });

  it('hidden layer is skipped (no beginPath/stroke for it)', () => {
    const r = new LineRenderer(2, { area: { visible: false }, stacking: 'off', colors: ['#111', '#222'] });
    r.setData(seed(3), 0);
    r.setData(seed(3, 10), 1);
    // Renderer's `setLayerVisible` flips the store flag (drives Y-range
    // exclusion); the layer's geometry only stops drawing once `setLayerAlpha`
    // brings alpha to 0. Chart's `setLayerVisible` calls both with `toggleMs`;
    // here we snap alpha to 0 so the assertion sees the settled state.
    r.setLayerVisible(1, false);
    r.setLayerAlpha(1, 0, 0);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 20 } });
    r.render(ctx);

    expect(spy.countOf('stroke')).toBe(1);
    expect(spy.callsOf('stroke')[0]?.strokeStyle).toBe('#111');
  });

  it('fewer than 2 points → layer is skipped (cannot draw a line)', () => {
    const r = new LineRenderer(2, { area: { visible: false }, stacking: 'off' });
    r.setData([{ time: 5, value: 1 }], 0); // single point
    r.setData(seed(3), 1);
    const { ctx, spy } = buildRenderContext();
    r.render(ctx);

    expect(spy.countOf('stroke')).toBe(1); // only layer 1 drew
  });

  it('stacking=normal: each visible layer draws a stroked edge (top-down order)', () => {
    const r = new LineRenderer(2, {
      stacking: 'normal',
      area: { visible: false },
      colors: ['#aaa', '#bbb'],
    });
    r.setData(seed(3, 0, 1), 0);
    r.setData(seed(3, 0, 1), 1);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 10 } });
    r.render(ctx);

    expect(spy.countOf('stroke')).toBe(2);
    // Upper layer drawn first (top-down).
    expect(spy.callsOf('stroke').map((c) => c.strokeStyle)).toEqual(['#bbb', '#aaa']);
  });

  it('stacking=percent: getValueRange returns fixed [0, 100]', () => {
    const r = new LineRenderer(2, { stacking: 'percent' });
    r.setData([{ time: 1, value: 2 }], 0);
    r.setData([{ time: 1, value: 8 }], 1);
    expect(r.getValueRange(0, 100)).toEqual({ min: 0, max: 100 });
  });

  it('mixed Date/number input normalizes through setData (regression #4)', () => {
    const r = new LineRenderer(1, { area: { visible: false } });
    r.setData([
      { time: 10, value: 1 },
      { time: new Date(30), value: 2 }, // Date in the middle
      { time: 50, value: 3 },
    ]);
    const { ctx, spy } = buildRenderContext({ yRange: { min: 0, max: 10 } });
    r.render(ctx);

    // All moveTo/lineTo calls should have finite x coordinates.
    const pathCalls = spy.calls.filter((c) => c.method === 'moveTo' || c.method === 'lineTo');
    for (const call of pathCalls) {
      expect(Number.isFinite(call.args[0] as number)).toBe(true);
    }
  });
});

describe('LineRenderer.drawOverlay', () => {
  it('pulse dots: each visible layer with data draws a glow + dot arc on the overlay', () => {
    const r = new LineRenderer(2, { area: { visible: false }, pulse: true, colors: ['#111', '#222'] });
    r.setData(seed(3), 0);
    r.setData(seed(3, 10), 1);
    const { overlayCtx, spy } = buildRenderContext({ yRange: { min: 0, max: 20 } });
    r.drawOverlay(overlayCtx(null));

    // Each visible layer draws 2 arcs (outer glow + inner dot) — 4 total for 2 layers.
    expect(spy.countOf('arc')).toBe(4);
  });

  it('crosshair present → extra arcs for nearest-point markers', () => {
    const r = new LineRenderer(1, { area: { visible: false }, pulse: false, colors: ['#111'] });
    r.setData(seed(5), 0);
    const { overlayCtx, spy } = buildRenderContext({ yRange: { min: 0, max: 10 } });
    r.drawOverlay(overlayCtx({ mediaX: 50, mediaY: 100, time: 25, y: 2 }));

    // Crosshair contributes 2 arcs (glow + dot) per visible layer.
    expect(spy.countOf('arc')).toBeGreaterThanOrEqual(2);
  });

  it('breaks the stroke path at non-finite values (null / NaN / ±Infinity / undefined)', () => {
    // Poisoned values must produce a *gap* — consecutive finite points form
    // an independent run, runs with ≥ 2 points get their own `moveTo`
    // subpath, and NaN coordinates must never reach the canvas.
    const r = new LineRenderer(1, { area: { visible: false } });
    const data: TimePoint[] = [
      { time: 10, value: 1 },
      { time: 20, value: 2 },
      { time: 25, value: Number.NaN },
      { time: 30, value: 3 },
      { time: 40, value: 4 },
      { time: 45, value: Number.POSITIVE_INFINITY },
      { time: 55, value: 5.5 },
      { time: 60, value: undefined as unknown as number },
      { time: 65, value: 6 },
      { time: 70, value: 7 },
      { time: 75, value: null as unknown as number },
      { time: 80, value: 8 },
      { time: 90, value: 9 }, // bodyEnd → becomes trailing, attached to the {8} run
    ];
    r.setData(data, 0);
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 10 } });

    // Must not throw.
    expect(() => r.render(ctx)).not.toThrow();

    // Four multi-point finite runs: {1,2}, {3,4}, {6,7}, {8, 9=trailing}.
    // (The lone {5.5} is a 1-point run between two gaps — not strokable as a
    // line segment, so no moveTo.) Each multi-point run opens its own subpath.
    expect(spy.countOf('moveTo')).toBeGreaterThanOrEqual(4);
    expect(spy.countOf('stroke')).toBe(1);
    // No NaN coordinates should have reached the canvas.
    for (const call of spy.calls) {
      for (const arg of call.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it('isolated single-finite-point runs render as visible dots, not silently dropped', () => {
    // Prior bug: a finite point sandwiched between two non-finite neighbors
    // becomes a 1-point run. Multi-point stroke logic skipped these,
    // leaving the point invisible. Now each orphan is drawn as a small
    // filled arc so you can still see that a valid value exists.
    const r = new LineRenderer(1, { area: { visible: false } });
    r.setData(
      [
        { time: 10, value: Number.NaN },
        { time: 20, value: 5 }, // orphan: gap on both sides
        { time: 30, value: null as unknown as number },
        { time: 40, value: Number.POSITIVE_INFINITY },
        { time: 50, value: 8 }, // orphan
        { time: 60, value: undefined as unknown as number },
        { time: 70, value: 3 }, // last → becomes trailing, also orphan (no finite penultimate)
      ],
      0,
    );
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 80 }, yRange: { min: 0, max: 10 } });
    expect(() => r.render(ctx)).not.toThrow();

    // One arc per orphan (using Math.PI*2 sweep). 3 orphans → 3 arcs and
    // one fill call for the grouped arc path.
    expect(spy.countOf('arc')).toBeGreaterThanOrEqual(3);
    expect(spy.countOf('fill')).toBeGreaterThanOrEqual(1);
    // No NaN coords reached canvas.
    for (const call of spy.calls) {
      for (const arg of call.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it('stacked rendering substitutes 0 for non-finite values (no NaN cumulative)', () => {
    // Prior bug: valueMaps[li].get(t) ?? 0 only catches missing keys, not
    // NaN / ±Infinity stored as the map's value. Once one layer's value was
    // NaN, `running += raw` poisoned every layer above it in the stack for
    // that time slot — ctx would then receive NaN Y coords.
    const r = new LineRenderer(2, {
      area: { visible: false },
      stacking: 'normal',
      colors: ['#111', '#222'],
    });
    r.setData(
      [
        { time: 10, value: 3 },
        { time: 20, value: 4 },
        { time: 30, value: Number.NaN },
        { time: 40, value: 5 },
      ],
      0,
    );
    r.setData(
      [
        { time: 10, value: 1 },
        { time: 20, value: Number.POSITIVE_INFINITY },
        { time: 30, value: 2 },
        { time: 40, value: null as unknown as number },
      ],
      1,
    );
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 50 }, yRange: { min: 0, max: 20 } });
    expect(() => r.render(ctx)).not.toThrow();

    // No NaN / ±Infinity coordinates reached canvas — the previously poisoned
    // cumulative sums would have leaked here.
    for (const call of spy.calls) {
      for (const arg of call.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it('area fill closes a separate polygon per finite run (no cross-gap spill)', () => {
    // With area.visible: true and gaps in the data, each finite run must be
    // its own closed fill polygon anchored to the baseline. If the fill
    // shared a single path with the stroke (old behavior), gaps would bleed
    // into adjacent runs.
    const r = new LineRenderer(1, { area: { visible: true }, colors: ['#00f'] });
    r.setData(
      [
        { time: 10, value: 1 },
        { time: 20, value: 2 },
        { time: 25, value: Number.NaN },
        { time: 30, value: 3 },
        { time: 40, value: 4 },
        { time: 45, value: null as unknown as number },
        { time: 50, value: 5 },
        { time: 60, value: 6 },
      ],
      0,
    );
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 10 } });
    expect(() => r.render(ctx)).not.toThrow();

    // 3 finite runs: {1,2}, {3,4}, {5, trailing(6)} → 3 fill polygons → 3
    // fills + 3 closePath. One stroke pass across all runs.
    expect(spy.countOf('fill')).toBe(3);
    expect(spy.countOf('closePath')).toBe(3);
    expect(spy.countOf('stroke')).toBe(1);

    // No NaN coordinates should reach canvas calls for either stroke or fill.
    for (const call of spy.calls) {
      for (const arg of call.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it('all-non-finite data renders without crash and draws no stroke geometry', () => {
    const r = new LineRenderer(1, { area: { visible: false } });
    r.setData(
      [
        { time: 10, value: Number.NaN },
        { time: 20, value: null as unknown as number },
        { time: 30, value: Number.POSITIVE_INFINITY },
      ],
      0,
    );
    const { ctx, spy } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 10 } });
    expect(() => r.render(ctx)).not.toThrow();
    // No `lineTo` with a finite value → nothing visible even though stroke() fires.
    for (const c of spy.callsOf('lineTo')) {
      for (const arg of c.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });
});
