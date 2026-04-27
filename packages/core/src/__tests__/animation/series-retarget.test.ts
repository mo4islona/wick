/**
 * Series live-track retarget contract.
 *
 * Pin the rule that high-frequency `updateLastPoint` ticks retarget the
 * underlying live-track Animator without piling up — the displayed value
 * advances toward the latest target with visual continuity, regardless of
 * how many micro-updates arrived between renders.
 *
 * Drives the renderers directly via the existing test helper to keep the
 * suite focused on the animator contract; broader integration is covered by
 * the existing renderer-level animation tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeSeriesStore } from '../../data/store';
import { CandlestickRenderer } from '../../series/candlestick';
import { LineRenderer } from '../../series/line';
import type { OHLCData, TimePoint } from '../../types';
import { buildRenderContext } from '../helpers/render-context';

const BULL = { open: 10, high: 12, low: 9, close: 11 };

describe('series live-track retarget contract', () => {
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

  function renderCandle(r: CandlestickRenderer): void {
    const { ctx } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 50 } });
    r.render(ctx);
  }

  function renderLine(r: LineRenderer): void {
    const { ctx } = buildRenderContext({ timeRange: { from: 0, to: 100 }, yRange: { min: 0, max: 50 } });
    r.render(ctx);
  }

  function readDisplayedLast(r: CandlestickRenderer): OHLCData | null {
    return (r as unknown as { displayedLast: OHLCData | null }).displayedLast;
  }

  function readDisplayedValues(r: LineRenderer): Array<number | null> {
    return (r as unknown as { displayedLastValues: Array<number | null> }).displayedLastValues;
  }

  it('candlestick: rapid back-to-back updateLastPoint calls converge to the latest target', () => {
    const store = new TimeSeriesStore<OHLCData>();
    store.setData([{ time: 10, ...BULL }]);
    const r = new CandlestickRenderer(store, { smoothMs: 70 });
    renderCandle(r);

    // 5 rapid ticks — each one nudges the close upward and arrives roughly
    // every 8 ms (faster than the smoothMs=70 settle window).
    for (let i = 1; i <= 5; i++) {
      r.updateLastPoint({ time: 10, open: 10, high: 11 + i, low: 9, close: 11 + i });
      advance(8);
      renderCandle(r);
    }

    // Mid-burst: displayed close has moved but not yet caught the latest target.
    const mid = readDisplayedLast(r)!;
    expect(mid.close).toBeGreaterThan(11);
    expect(mid.close).toBeLessThan(16);

    // Drain — must converge to the most recent target, not an earlier one.
    for (let i = 0; i < 30; i++) {
      advance(16);
      renderCandle(r);
    }
    const settled = readDisplayedLast(r)!;
    expect(Math.abs(settled.close - 16)).toBeLessThan(0.01);
    expect(r.needsAnimation).toBe(false);
  });

  it('candlestick: retarget mid-flight preserves visual continuity (no jump)', () => {
    const store = new TimeSeriesStore<OHLCData>();
    store.setData([{ time: 10, ...BULL }]);
    const r = new CandlestickRenderer(store, { smoothMs: 100 });
    renderCandle(r);

    // First update — close 11 → 20.
    r.updateLastPoint({ time: 10, open: 10, high: 20, low: 9, close: 20 });
    advance(50);
    renderCandle(r);

    const midpoint1 = readDisplayedLast(r)!.close;
    expect(midpoint1).toBeGreaterThan(11);
    expect(midpoint1).toBeLessThan(20);

    // New update mid-flight — close 20 → 5 (reverse direction).
    r.updateLastPoint({ time: 10, open: 10, high: 20, low: 5, close: 5 });
    advance(0); // same frame as the retarget — no further progress yet
    renderCandle(r);

    // Visual continuity: displayed close immediately after retarget must be
    // ~midpoint1, not snapped to 5 (or to 20). The next render with no time
    // advance should still read midpoint1 (within tiny tolerance for the
    // FRAME_CAP_MS anchor's first-frame nudge).
    const afterRetarget = readDisplayedLast(r)!.close;
    expect(Math.abs(afterRetarget - midpoint1)).toBeLessThan(2);

    // Settle.
    for (let i = 0; i < 20; i++) {
      advance(16);
      renderCandle(r);
    }
    expect(Math.abs(readDisplayedLast(r)!.close - 5)).toBeLessThan(0.01);
  });

  it('line: rapid back-to-back updateLastPoint calls converge to the latest value', () => {
    const data: TimePoint[] = [
      { time: 0, value: 10 },
      { time: 10, value: 20 },
    ];
    const r = new LineRenderer(1, { smoothMs: 70 });
    r.setData(data);
    renderLine(r);

    for (let i = 1; i <= 5; i++) {
      r.updateLastPoint({ time: 10, value: 20 + i * 5 });
      advance(8);
      renderLine(r);
    }

    // Drain.
    for (let i = 0; i < 30; i++) {
      advance(16);
      renderLine(r);
    }

    expect(Math.abs(readDisplayedValues(r)[0]! - 45)).toBeLessThan(0.01);
    expect(r.needsAnimation).toBe(false);
  });

  it('line multi-layer: retargeting one layer leaves the other layers alone', () => {
    const r = new LineRenderer(2, { smoothMs: 70 });
    r.setData(
      [
        { time: 0, value: 10 },
        { time: 10, value: 20 },
      ],
      0,
    );
    r.setData(
      [
        { time: 0, value: 100 },
        { time: 10, value: 200 },
      ],
      1,
    );
    renderLine(r);

    const before = readDisplayedValues(r);
    expect(before[0]).toBe(20);
    expect(before[1]).toBe(200);

    // Update layer 0 only.
    r.updateLastPoint({ time: 10, value: 50 }, 0);
    advance(16);
    renderLine(r);

    const after = readDisplayedValues(r);
    // Layer 0 has moved (mid-animation).
    expect(after[0]!).toBeGreaterThan(20);
    expect(after[0]!).toBeLessThan(50);
    // Layer 1 untouched.
    expect(after[1]).toBe(200);
  });

  it('smoothMs: 0 disables live-track animation (snap path)', () => {
    const data: TimePoint[] = [
      { time: 0, value: 10 },
      { time: 10, value: 20 },
    ];
    const r = new LineRenderer(1, { smoothMs: 0 });
    r.setData(data);
    renderLine(r);

    r.updateLastPoint({ time: 10, value: 80 });
    advance(16);
    renderLine(r);

    expect(readDisplayedValues(r)[0]).toBe(80);
    expect(r.needsAnimation).toBe(false);
  });
});
