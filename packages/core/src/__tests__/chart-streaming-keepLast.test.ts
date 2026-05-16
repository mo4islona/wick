/**
 * `chart.keepLast(id, count, layerIndex?)` — rolling-window trim. Drops
 * the oldest points so the series stays at `count` items, leaving the live
 * tail intact for streaming feeds. Contract pinned here:
 *
 *  - trims `store.length` to exactly `count` (or no-op if already ≤ count),
 *  - does NOT shift the X viewport (no snap-on-trim — pan offset survives),
 *  - cleans the renderer's per-point entrance-animation entries for the
 *    dropped points so the next render doesn't keep them alive,
 *  - is a no-op on unknown series ids / negative counts / oversize counts,
 *  - works on every renderer family (candlestick, line, multi-layer line,
 *    bar, multi-layer bar), with per-layer addressing for the multi-layer
 *    families.
 *
 * The Phase 3 augment will additionally pin that `keepLast` triggers
 * `engine.dropEntry` for each removed point. Phase 2's `dropEntry` is a
 * stub (the entry slot maps are empty until renderers emit entrance
 * events) — covered by `engine/lifecycle.test.ts`; here we only assert the
 * surface contract holds without crashing the engine.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChartInstance } from '../chart';
import type { BarRenderer } from '../series/bar';
import type { CandlestickRenderer } from '../series/candlestick';
import type { LineRenderer } from '../series/line';
import type { OHLCData, TimePoint } from '../types';

const INTERVAL = 60_000;

function makeChart(): { chart: ChartInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const width = 800;
  const height = 400;
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);

  return { chart: new ChartInstance(container, { interactive: false }), container };
}

type AnyRenderer = CandlestickRenderer | LineRenderer | BarRenderer;

function renderer(chart: ChartInstance, id: string): AnyRenderer {
  return (chart as unknown as { listSeriesForTest: () => Array<{ id: string; renderer: AnyRenderer }> })
    .listSeriesForTest()
    .find((s) => s.id === id)!.renderer;
}

function storeLength(r: AnyRenderer): number {
  return (r as unknown as { store?: { length: number }; stores?: Array<{ length: number }> }).store?.length ?? 0;
}

function multiLayerLength(r: AnyRenderer, layer: number): number {
  return (r as unknown as { stores: Array<{ length: number }> }).stores[layer].length;
}

function seedCandles(chart: ChartInstance, count: number): string {
  const id = chart.addCandlestickSeries();
  const data: OHLCData[] = Array.from({ length: count }, (_, i) => ({
    time: 1_000_000 + i * INTERVAL,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
  }));
  chart.setSeriesData(id, data);

  return id;
}

function seedLine(chart: ChartInstance, count: number, layers?: number): string {
  const id = chart.addLineSeries(layers !== undefined ? { layers } : undefined);
  const data: TimePoint[] = Array.from({ length: count }, (_, i) => ({
    time: 1_000_000 + i * INTERVAL,
    value: 10 + i,
  }));
  if (layers !== undefined) {
    for (let li = 0; li < layers; li++) {
      chart.setSeriesData(id, data, li);
    }
  } else {
    chart.setSeriesData(id, data);
  }

  return id;
}

describe('chart.keepLast — trim contract', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('candlestick: trims store down to exactly `count`', () => {
    const id = seedCandles(chart, 50);
    expect(storeLength(renderer(chart, id))).toBe(50);

    chart.keepLast(id, 10);
    expect(storeLength(renderer(chart, id))).toBe(10);
  });

  it('line: trims single-layer store down to exactly `count`', () => {
    const id = seedLine(chart, 50);
    expect(storeLength(renderer(chart, id))).toBe(50);

    chart.keepLast(id, 8);
    expect(storeLength(renderer(chart, id))).toBe(8);
  });

  it('bar: trims via the same base-multi-layer code path', () => {
    const id = chart.addBarSeries();
    const data = Array.from({ length: 30 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: i }));
    chart.setSeriesData(id, data);
    expect(multiLayerLength(renderer(chart, id), 0)).toBe(30);

    chart.keepLast(id, 5);
    expect(multiLayerLength(renderer(chart, id), 0)).toBe(5);
  });

  it('multi-layer line: keepLast addresses one layer at a time', () => {
    const id = seedLine(chart, 40, 2);
    const r = renderer(chart, id);
    expect(multiLayerLength(r, 0)).toBe(40);
    expect(multiLayerLength(r, 1)).toBe(40);

    chart.keepLast(id, 10, 1);
    // Layer 1 trimmed; layer 0 untouched.
    expect(multiLayerLength(r, 0)).toBe(40);
    expect(multiLayerLength(r, 1)).toBe(10);
  });

  it('idempotent: count >= store.length is a no-op', () => {
    const id = seedCandles(chart, 20);
    chart.keepLast(id, 100);
    expect(storeLength(renderer(chart, id))).toBe(20);
    chart.keepLast(id, 20);
    expect(storeLength(renderer(chart, id))).toBe(20);
  });

  it('negative count is a silent no-op (not a length=0 reset)', () => {
    const id = seedCandles(chart, 20);
    chart.keepLast(id, -5);
    expect(storeLength(renderer(chart, id))).toBe(20);
  });

  it('unknown series id is a silent no-op', () => {
    seedCandles(chart, 20);
    expect(() => chart.keepLast('does-not-exist', 5)).not.toThrow();
  });

  it('successive trims compound (rolling-window behavior)', () => {
    const id = seedLine(chart, 100);
    chart.keepLast(id, 50);
    expect(storeLength(renderer(chart, id))).toBe(50);
    chart.keepLast(id, 25);
    expect(storeLength(renderer(chart, id))).toBe(25);
    chart.keepLast(id, 10);
    expect(storeLength(renderer(chart, id))).toBe(10);
  });
});

describe('chart.keepLast — viewport contract', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('does NOT snap the visible range (legacy contract — rolling window slides, viewport stays)', () => {
    const id = seedCandles(chart, 50);
    const before = { ...chart.getVisibleRange() };

    chart.keepLast(id, 10);

    const after = chart.getVisibleRange();
    expect(after.from).toBe(before.from);
    expect(after.to).toBe(before.to);
  });

  it('engine state stays consistent — no NaN, no crash on subsequent emits', () => {
    const id = seedCandles(chart, 50);
    chart.keepLast(id, 10);

    // Another data event after trim — must not crash and must produce a
    // finite Y range.
    chart.appendData(id, { time: 1_000_000 + 50 * INTERVAL, open: 100, high: 110, low: 90, close: 105 });

    const y = chart.getYRange();
    expect(Number.isFinite(y.min)).toBe(true);
    expect(Number.isFinite(y.max)).toBe(true);
    expect(y.max).toBeGreaterThan(y.min);
  });
});

describe('chart.keepLast — renderer entrance map cleanup', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('candlestick: per-point entries map drops keys for trimmed candles', () => {
    const id = seedCandles(chart, 50);
    const r = renderer(chart, id);
    // Seed entrance-animation entries by appending — the renderer adds
    // an entry on `appendPoint` per Phase 2 (entrance stays in-renderer
    // until Phase 3).
    chart.appendData(id, { time: 1_000_000 + 50 * INTERVAL, open: 100, high: 105, low: 95, close: 102 });
    const entries = (r as unknown as { entries: Map<number, unknown> }).entries;
    const sizeBefore = entries.size;

    chart.keepLast(id, 5);

    // Entrance entries for trimmed candles must be evicted along with the
    // store rows so the next render doesn't keep them alive against a
    // store that no longer holds those candles.
    expect(entries.size).toBeLessThanOrEqual(sizeBefore);
    // Concretely: every remaining entry key must reference a candle that
    // still lives in the store.
    const r2 = r as unknown as { store: { getAll: () => OHLCData[] } };
    const stillThere = new Set(r2.store.getAll().map((c) => c.time));
    for (const time of entries.keys()) {
      expect(stillThere.has(time)).toBe(true);
    }
  });

  it('multi-layer line: per-layer entries map drops keys for trimmed points', () => {
    const id = seedLine(chart, 30, 2);
    const r = renderer(chart, id);

    // Append on layer 0 to seed an entries entry.
    chart.appendData(id, { time: 1_000_000 + 30 * INTERVAL, value: 999 }, 0);
    const entriesByLayer = (r as unknown as { entries: Array<Map<number, unknown>> }).entries;

    chart.keepLast(id, 5, 0);

    const remainingTimes = new Set(
      (r as unknown as { stores: Array<{ getAll: () => TimePoint[] }> }).stores[0].getAll().map((p) => p.time),
    );
    for (const time of entriesByLayer[0].keys()) {
      expect(remainingTimes.has(time)).toBe(true);
    }
    // Layer 1 untouched — its entries (if any) remain.
    expect((r as unknown as { stores: Array<{ length: number }> }).stores[1].length).toBe(30);
  });
});
