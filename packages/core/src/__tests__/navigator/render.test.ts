import { describe, expect, it } from 'vitest';

import {
  type NavigatorRenderContext,
  computeWindowGeometry,
  renderBackground,
  renderMiniBar,
  renderMiniCandlestick,
  renderMiniLine,
  renderWindow,
} from '../../navigator/render';
import { resolveCandlestickBodyColor } from '../../theme/resolve';
import type { ChartTheme } from '../../theme/types';
import { createRecordingContext } from '../helpers/recording-context';

const MEDIA_W = 200;
const MEDIA_H = 60;

const NAV_THEME: ChartTheme['navigator'] = {
  height: 60,
  background: '#222222',
  borderColor: '#333333',
  line: {
    color: '#88aaff',
    width: 2,
    areaTopColor: '#88aaff',
    areaBottomColor: '#88aaff00',
  },
  candlestick: {
    up: { body: '#22cc88', wick: '#22cc88' },
    down: { body: '#cc4444', wick: '#cc4444' },
  },
  window: { fill: '#ffffff20', border: '#ffffff', borderWidth: 1 },
  handle: { color: '#ffffff', width: 4 },
  mask: { fill: '#00000080' },
};

/** Linear x-mapping over `[dataFrom, dataTo] → [0, mediaWidth]`. */
function fakeTimeScale(dataFrom: number, dataTo: number) {
  const span = dataTo - dataFrom || 1;

  return {
    timeToX(time: number): number {
      return ((time - dataFrom) / span) * MEDIA_W;
    },
  } as unknown as NavigatorRenderContext['timeScale'];
}

/** Linear y-mapping over `[valueMin, valueMax] → [mediaHeight, 0]` (top is high). */
function fakeYScale(valueMin: number, valueMax: number) {
  const span = valueMax - valueMin || 1;

  return {
    valueToY(value: number): number {
      return MEDIA_H - ((value - valueMin) / span) * MEDIA_H;
    },
  } as unknown as NavigatorRenderContext['yScale'];
}

function makeRc(opts?: { dataFrom?: number; dataTo?: number; vmin?: number; vmax?: number }): {
  rc: NavigatorRenderContext;
  spy: ReturnType<typeof createRecordingContext>['spy'];
} {
  const { ctx, spy } = createRecordingContext();
  const rc: NavigatorRenderContext = {
    ctx,
    timeScale: fakeTimeScale(opts?.dataFrom ?? 0, opts?.dataTo ?? 100),
    yScale: fakeYScale(opts?.vmin ?? 0, opts?.vmax ?? 100),
    mediaWidth: MEDIA_W,
    mediaHeight: MEDIA_H,
    theme: NAV_THEME,
  };

  return { rc, spy };
}

describe('renderBackground', () => {
  it('paints one full-canvas fillRect at the theme background color', () => {
    const { rc, spy } = makeRc();
    renderBackground(rc);

    expect(spy.countOf('fillRect')).toBe(1);
    const [x, y, w, h] = spy.callsOf('fillRect')[0].args as [number, number, number, number];
    expect([x, y, w, h]).toEqual([0, 0, MEDIA_W, MEDIA_H]);
    expect(spy.callsOf('fillRect')[0].fillStyle).toBe(NAV_THEME.background);
  });
});

describe('renderMiniLine', () => {
  const points = [
    { time: 0, value: 0 },
    { time: 50, value: 50 },
    { time: 100, value: 100 },
  ];

  it('returns without drawing when fewer than 2 points', () => {
    const { rc, spy } = makeRc();
    renderMiniLine(rc, [{ time: 0, value: 0 }]);

    expect(spy.calls.length).toBe(0);
  });

  it('draws a stroke and gradient area fill by default', () => {
    const { rc, spy } = makeRc();
    renderMiniLine(rc, points);

    expect(spy.matchesSequence(['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'beginPath', 'stroke'])).toBe(
      true,
    );
    const stroke = spy.callsOf('stroke')[0];
    expect(stroke.strokeStyle).toBe(NAV_THEME.line.color);
    expect(stroke.lineWidth).toBe(NAV_THEME.line.width);
    // Gradient is the recorded fillStyle for the area fill — its toString tag
    // confirms the area pass actually used the gradient and not a flat color.
    const fill = spy.callsOf('fill')[0];
    expect(fill.fillStyle).toMatch(/^gradient\(linear/);
  });

  it('skips the area pass when drawArea=false (no closePath, no fill)', () => {
    const { rc, spy } = makeRc();
    renderMiniLine(rc, points, false);

    expect(spy.countOf('closePath')).toBe(0);
    expect(spy.countOf('fill')).toBe(0);
    expect(spy.countOf('stroke')).toBe(1);
  });

  it('splits stroke + area into a tail pass when trailingAlpha < 1', () => {
    const { rc, spy } = makeRc();
    renderMiniLine(rc, points, true, 0.4);

    // Two area fills (steady + tail) and two strokes (steady + tail).
    expect(spy.countOf('fill')).toBe(2);
    expect(spy.countOf('stroke')).toBe(2);
    // The tail pass is wrapped in save/restore so globalAlpha is captured at
    // the supplied trailingAlpha for the tail-only calls.
    const tailFill = spy.callsOf('fill')[1];
    expect(tailFill.globalAlpha).toBeCloseTo(0.4, 5);
    const tailStroke = spy.callsOf('stroke')[1];
    expect(tailStroke.globalAlpha).toBeCloseTo(0.4, 5);
  });
});

describe('renderMiniBar', () => {
  it('returns without drawing when there are no points', () => {
    const { rc, spy } = makeRc();
    renderMiniBar(rc, []);

    expect(spy.calls.length).toBe(0);
  });

  it('draws one fillRect per point at the theme line color', () => {
    const { rc, spy } = makeRc();
    const pts = [
      { time: 0, value: 25 },
      { time: 50, value: 50 },
      { time: 100, value: 75 },
    ];
    renderMiniBar(rc, pts);

    expect(spy.countOf('fillRect')).toBe(pts.length);
    for (const c of spy.callsOf('fillRect')) {
      expect(c.fillStyle).toBe(NAV_THEME.line.color);
    }
  });

  it('wraps the last bar in save/restore at trailingAlpha when < 1', () => {
    const { rc, spy } = makeRc();
    const pts = [
      { time: 0, value: 10 },
      { time: 50, value: 20 },
      { time: 100, value: 30 },
    ];
    renderMiniBar(rc, pts, 0.6);

    const fills = spy.callsOf('fillRect');
    // Steady bars draw at full alpha…
    for (const c of fills.slice(0, -1)) expect(c.globalAlpha).toBe(1);
    // …and the trailing bar inherits the supplied alpha while inside save/restore.
    expect(fills[fills.length - 1].globalAlpha).toBeCloseTo(0.6, 5);
    expect(spy.countOf('save')).toBeGreaterThanOrEqual(1);
    expect(spy.countOf('restore')).toBeGreaterThanOrEqual(1);
  });

  it('uses a 1px-wide bar when only a single point is supplied', () => {
    const { rc, spy } = makeRc();
    renderMiniBar(rc, [{ time: 50, value: 80 }]);

    const [, , w] = spy.callsOf('fillRect')[0].args as [number, number, number, number];
    // 0.8 * 2 (single-point fallback) = 1.6 — clamped to ≥1 by Math.max.
    expect(w).toBeGreaterThanOrEqual(1);
  });
});

describe('renderMiniCandlestick', () => {
  it('returns without drawing when there are no points', () => {
    const { rc, spy } = makeRc();
    renderMiniCandlestick(rc, []);

    expect(spy.calls.length).toBe(0);
  });

  it('paints up vs down candle bodies with their respective theme colors', () => {
    const { rc, spy } = makeRc();
    renderMiniCandlestick(rc, [
      { time: 0, open: 50, high: 60, low: 40, close: 55 }, // up
      { time: 50, open: 55, high: 65, low: 45, close: 48 }, // down
    ]);

    const fills = spy.callsOf('fillRect');
    expect(fills.length).toBe(2);
    expect(fills[0].fillStyle).toBe(resolveCandlestickBodyColor(NAV_THEME.candlestick.up.body));
    expect(fills[1].fillStyle).toBe(resolveCandlestickBodyColor(NAV_THEME.candlestick.down.body));
  });

  it('draws one wick stroke per candle', () => {
    const { rc, spy } = makeRc();
    renderMiniCandlestick(rc, [
      { time: 0, open: 50, high: 60, low: 40, close: 55 },
      { time: 50, open: 55, high: 65, low: 45, close: 48 },
      { time: 100, open: 48, high: 70, low: 30, close: 60 },
    ]);

    expect(spy.countOf('stroke')).toBe(3);
  });

  it('fades the trailing candle when trailingAlpha < 1', () => {
    const { rc, spy } = makeRc();
    renderMiniCandlestick(
      rc,
      [
        { time: 0, open: 50, high: 60, low: 40, close: 55 },
        { time: 50, open: 55, high: 65, low: 45, close: 60 },
      ],
      0.25,
    );

    const fills = spy.callsOf('fillRect');
    expect(fills[0].globalAlpha).toBe(1);
    expect(fills[1].globalAlpha).toBeCloseTo(0.25, 5);
  });
});

describe('renderWindow', () => {
  const dataRange = { from: 0, to: 100 };

  it('returns without drawing when dataRange is empty', () => {
    const { rc, spy } = makeRc();
    renderWindow(rc, { from: 10, to: 20 }, { from: 5, to: 5 });

    expect(spy.calls.length).toBe(0);
  });

  it('paints both side masks, the window body, and two handle bars', () => {
    const { rc, spy } = makeRc();
    renderWindow(rc, { from: 25, to: 75 }, dataRange);

    const fills = spy.callsOf('fillRect');
    // 2 mask side-rects + 1 window body + 2 handle bars = 5.
    expect(fills.length).toBe(5);
    expect(fills[0].fillStyle).toBe(NAV_THEME.mask.fill);
    expect(fills[1].fillStyle).toBe(NAV_THEME.mask.fill);
    expect(fills[2].fillStyle).toBe(NAV_THEME.window.fill);
    expect(fills[3].fillStyle).toBe(NAV_THEME.handle.color);
    expect(fills[4].fillStyle).toBe(NAV_THEME.handle.color);
  });

  it('strokes the window border when borderWidth > 0', () => {
    const { rc, spy } = makeRc();
    renderWindow(rc, { from: 25, to: 75 }, dataRange);

    expect(spy.countOf('strokeRect')).toBe(1);
    const stroke = spy.callsOf('strokeRect')[0];
    expect(stroke.strokeStyle).toBe(NAV_THEME.window.border);
    expect(stroke.lineWidth).toBe(NAV_THEME.window.borderWidth);
  });

  it('skips the border when theme.window.borderWidth is 0', () => {
    const { rc, spy } = makeRc();
    rc.theme = { ...NAV_THEME, window: { ...NAV_THEME.window, borderWidth: 0 } };
    renderWindow(rc, { from: 25, to: 75 }, dataRange);

    expect(spy.countOf('strokeRect')).toBe(0);
  });

  it('omits the left mask when the window is flush against the left edge', () => {
    const { rc, spy } = makeRc();
    renderWindow(rc, { from: 0, to: 50 }, dataRange);

    // Left mask (left > 0) must not exist, but right mask still does.
    const masks = spy.callsOf('fillRect').filter((c) => c.fillStyle === NAV_THEME.mask.fill);
    expect(masks.length).toBe(1);
    const [x] = masks[0].args as [number, number, number, number];
    expect(x).toBeGreaterThan(0);
  });

  it('omits the right mask when the window extends to the right edge', () => {
    const { rc, spy } = makeRc();
    renderWindow(rc, { from: 50, to: 100 }, dataRange);

    const masks = spy.callsOf('fillRect').filter((c) => c.fillStyle === NAV_THEME.mask.fill);
    expect(masks.length).toBe(1);
    const [x] = masks[0].args as [number, number, number, number];
    expect(x).toBe(0);
  });

  it('clamps a visible range that overshoots the data into the data span', () => {
    const { rc, spy } = makeRc();
    renderWindow(rc, { from: -100, to: 200 }, dataRange);

    // Overshoot collapses both sides to dataRange — no side masks at all,
    // window covers full canvas.
    const masks = spy.callsOf('fillRect').filter((c) => c.fillStyle === NAV_THEME.mask.fill);
    expect(masks.length).toBe(0);
    const window = spy.callsOf('fillRect').find((c) => c.fillStyle === NAV_THEME.window.fill)!;
    const [, , w] = window.args as [number, number, number, number];
    expect(w).toBe(MEDIA_W);
  });
});

describe('computeWindowGeometry', () => {
  const dataRange = { from: 0, to: 100 };

  it('returns left/right/width for a window inside the data range', () => {
    const ts = fakeTimeScale(0, 100);
    const geom = computeWindowGeometry(ts, { from: 25, to: 75 }, dataRange);

    expect(geom.left).toBe(50);
    expect(geom.right).toBe(150);
    expect(geom.width).toBe(100);
  });

  it('clamps overshooting visible range into the data span', () => {
    const ts = fakeTimeScale(0, 100);
    const geom = computeWindowGeometry(ts, { from: -50, to: 200 }, dataRange);

    // Both edges land exactly on the data extents.
    expect(geom.left).toBe(0);
    expect(geom.right).toBe(MEDIA_W);
    expect(geom.width).toBe(MEDIA_W);
  });

  it('keeps width at least 1px when the window collapses to a point', () => {
    const ts = fakeTimeScale(0, 100);
    const geom = computeWindowGeometry(ts, { from: 50, to: 50 }, dataRange);

    expect(geom.left).toBe(geom.right);
    expect(geom.width).toBe(1);
  });
});
