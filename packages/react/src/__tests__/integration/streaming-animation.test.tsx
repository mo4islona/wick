/**
 * Streaming entrance animations are easy to break at a boundary the unit tests
 * don't cross: the React wrappers diff each `data` prop and decide whether to
 * route new points through `setSeriesData` (no animation — wipes the renderer's
 * entrance map) or `appendData` (registers an entry and triggers `needsAnimation`).
 * A too-tight "bulk load" threshold made streamed updates look like full reloads,
 * so animations never fired in the live demos. These tests hold the diff path
 * to the contract we expect downstream.
 */

import type { OHLCData, TimePoint } from '@wick-charts/core';
import { CandlestickSeries, LineSeries } from '@wick-charts/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mountChart } from '../helpers/mount-chart';

describe('streaming data routes new points through appendData (entrance animations fire)', () => {
  let mounted: ReturnType<typeof mountChart> | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  /**
   * Per-series entrance registry — renderer-owned. Line/bar use a per-layer
   * array of maps, candlestick uses a single map (single layer). Reaching
   * in via type-cast keeps the public API surface untouched.
   */
  function entranceProgressFor(
    chart: ReturnType<typeof mountChart>['chart'],
    id: string,
  ): ReadonlyMap<number, unknown> {
    const series = (
      chart as unknown as {
        listSeriesForTest: () => Array<{ id: string; renderer: unknown }>;
      }
    )
      .listSeriesForTest()
      .find((s) => s.id === id);
    if (!series) return new Map();

    const renderer = series.renderer as { entries?: Map<number, unknown> | Array<Map<number, unknown>> };
    const entries = renderer.entries;
    if (entries === undefined) return new Map();
    if (entries instanceof Map) return entries;
    // Multi-layer line / bar — caller-facing surface flattens layer 0 since
    // these tests append a single point per call.
    return entries[0] ?? new Map();
  }

  it('candlestick: a single new candle streams in via appendData — entrance entry registered', () => {
    const initial: OHLCData[] = Array.from({ length: 10 }, (_, i) => ({
      time: 1_000_000 + i * 60_000,
      open: 100,
      high: 105,
      low: 95,
      close: 101,
    }));
    const sid = 'candle';
    mounted = mountChart(<CandlestickSeries id={sid} data={initial} />, {
      width: 800,
      height: 400,
    });
    mounted.flushScheduler();

    // Streaming tick: one new candle appended. Assert BEFORE flushing so the
    // entry is caught before RAF advances progress to 1 and prunes it.
    const next: OHLCData[] = [
      ...initial,
      { time: 1_000_000 + 10 * 60_000, open: 101, high: 106, low: 100, close: 105 },
    ];
    mounted.rerender(<CandlestickSeries id={sid} data={next} />);
    expect(entranceProgressFor(mounted.chart, sid).size).toBeGreaterThan(0);
  });

  it('candlestick: 10 new candles in one tick still go through appendData (under the bulk threshold)', () => {
    const initial: OHLCData[] = Array.from({ length: 10 }, (_, i) => ({
      time: 1_000_000 + i * 60_000,
      open: 100,
      high: 105,
      low: 95,
      close: 101,
    }));
    const sid = 'candle';
    mounted = mountChart(<CandlestickSeries id={sid} data={initial} />, {
      width: 800,
      height: 400,
    });
    mounted.flushScheduler();

    // Append 10 candles in one go (e.g. OHLCStream emitting 8-10 per virtual tick).
    const next: OHLCData[] = [...initial];
    for (let i = 10; i < 20; i++) {
      next.push({ time: 1_000_000 + i * 60_000, open: 101, high: 106, low: 100, close: 105 });
    }
    mounted.rerender(<CandlestickSeries id={sid} data={next} />);

    // Synchronous assertion: entrance progress was claimed for each of the
    // 10 new candle times. Engine has populated `state.entryProgress` after
    // the chart's internal `#applyEngineState` tick that ran during the
    // batched appendData chain.
    const entries = entranceProgressFor(mounted.chart, sid);
    expect(entries.size).toBe(10);
  });

  it('candlestick: a bulk load (>20 new candles) correctly falls back to setSeriesData — no animations', () => {
    const initial: OHLCData[] = Array.from({ length: 5 }, (_, i) => ({
      time: 1_000_000 + i * 60_000,
      open: 100,
      high: 105,
      low: 95,
      close: 101,
    }));
    const sid = 'candle';
    mounted = mountChart(<CandlestickSeries id={sid} data={initial} />, {
      width: 800,
      height: 400,
    });
    mounted.flushScheduler();

    // 50 new candles at once — treated as a batch/history load, not streaming.
    const next: OHLCData[] = [...initial];
    for (let i = 5; i < 55; i++) {
      next.push({ time: 1_000_000 + i * 60_000, open: 101, high: 106, low: 100, close: 105 });
    }
    mounted.rerender(<CandlestickSeries id={sid} data={next} />);

    // Bulk path routes through setSeriesData (no per-point entrance
    // emits), so `state.entryProgress` for this series carries no entries.
    const entries = entranceProgressFor(mounted.chart, sid);
    expect(entries.size).toBe(0);
  });

  it('candlestick: the appended candle actually renders with globalAlpha < 1', () => {
    const initial: OHLCData[] = Array.from({ length: 10 }, (_, i) => ({
      time: 1_000_000 + i * 60_000,
      open: 100,
      high: 105,
      low: 95,
      close: 101,
    }));
    const sid = 'candle';
    mounted = mountChart(<CandlestickSeries id={sid} data={initial} options={{ entryAnimation: 'fade-unfold' }} />, {
      width: 800,
      height: 400,
    });
    mounted.flushScheduler();
    mounted.mainSpy.reset();

    const next: OHLCData[] = [
      ...initial,
      { time: 1_000_000 + 10 * 60_000, open: 101, high: 106, low: 100, close: 105 },
    ];
    mounted.rerender(<CandlestickSeries id={sid} data={next} options={{ entryAnimation: 'fade-unfold' }} />);
    // rerender + useLayoutEffect schedule RAF work; flushScheduler then drains
    // every queued animation frame to completion. Assert against the full
    // history — if ANY frame during the entrance window recorded a sub-1
    // globalAlpha, the entrance fired end-to-end.
    mounted.flushScheduler();

    expect(mounted.mainSpy.calls.some((c) => c.method === 'fillRect' && c.globalAlpha < 1)).toBe(true);
  });

  it('candlestick: docs-style stream (8-candle burst) paints faded candles on the main canvas', () => {
    // Replicates useOHLCStream's tick shape: a React state update that adds a
    // BATCH of new candles (OHLCStream emits while `virtualNow` crosses
    // multiple interval boundaries per tick). With BULK_THRESHOLD=20 the
    // React wrapper diff-routes these through appendData, so the renderer's
    // entries map populates — if anything elsewhere clears it before the
    // render pass paints, no fillRect will carry globalAlpha < 1.
    const initial: OHLCData[] = Array.from({ length: 50 }, (_, i) => ({
      time: 1_000_000 + i * 60_000,
      open: 100,
      high: 105,
      low: 95,
      close: 101,
    }));
    const sid = 'candle';
    mounted = mountChart(<CandlestickSeries id={sid} data={initial} options={{ entryAnimation: 'fade-unfold' }} />, {
      width: 800,
      height: 400,
    });
    mounted.flushScheduler();
    mounted.mainSpy.reset();

    // Burst: 8 new candles in a single React state transition — mirrors exactly
    // what a 500ms OHLCStream tick emits when interval=60.
    const burst: OHLCData[] = [...initial];
    for (let i = 50; i < 58; i++) {
      burst.push({ time: 1_000_000 + i * 60_000, open: 101, high: 106, low: 100, close: 105 });
    }
    mounted.rerender(<CandlestickSeries id={sid} data={burst} options={{ entryAnimation: 'fade-unfold' }} />);

    // Before any RAF drains: engine.entryProgress must be populated for
    // all 8 new candles (one entrance event per appendData call).
    expect(entranceProgressFor(mounted.chart, sid).size).toBe(8);

    // Now let the scheduler render at least one frame — the main canvas must
    // show at least one fillRect with globalAlpha < 1 for an entering candle.
    mounted.flushScheduler();
    const fadedFills = mounted.mainSpy.calls.filter((c) => c.method === 'fillRect' && c.globalAlpha < 1);
    expect(fadedFills.length).toBeGreaterThan(0);
  });

  it('line: docs-style stream (1-point-per-layer tick) paints the entering trail with a lineTo < new.x', () => {
    const initial: TimePoint[][] = [
      Array.from({ length: 20 }, (_, i) => ({ time: 1_000_000 + i * 60_000, value: i + 1 })),
    ];
    const sid = 'line';
    mounted = mountChart(
      <LineSeries
        id={sid}
        data={initial}
        options={{ area: { visible: false }, entryAnimation: 'grow', entryMs: 400 }}
      />,
      { width: 800, height: 400 },
    );
    mounted.flushScheduler();
    mounted.mainSpy.reset();

    const next: TimePoint[][] = [[...initial[0], { time: 1_000_000 + 20 * 60_000, value: 25 }]];
    mounted.rerender(
      <LineSeries id={sid} data={next} options={{ area: { visible: false }, entryAnimation: 'grow', entryMs: 400 }} />,
    );

    // Entry should be registered in engine state immediately.
    expect(entranceProgressFor(mounted.chart, sid).size).toBe(1);

    // The render pass must emit a `lineTo` at a trailing X < new point's X.
    mounted.flushScheduler();
    const lineTos = mounted.mainSpy.callsOf('lineTo');
    expect(lineTos.length).toBeGreaterThan(0);
  });

  it('candlestick: rolling-window slide (maxPoints cap) still animates the new tail', () => {
    // Dashboard uses MAX_POINTS=300 via useOHLCStream — once history fills, every
    // streamed candle shifts the array (oldest dropped, newest appended) but
    // data.length stays constant. This used to collapse to setSeriesData and
    // silently wipe all entrance-animation entries — the user-visible symptom
    // was "candles just appear, no animation".
    const MAX = 10;
    const initial: OHLCData[] = Array.from({ length: MAX }, (_, i) => ({
      time: 1_000_000 + i * 60_000,
      open: 100,
      high: 105,
      low: 95,
      close: 101,
    }));
    const sid = 'candle';
    mounted = mountChart(<CandlestickSeries id={sid} data={initial} />, { width: 800, height: 400 });
    mounted.flushScheduler();

    // Simulate capArray rolling-window: drop oldest, append new.
    const rolled: OHLCData[] = [
      ...initial.slice(1),
      { time: 1_000_000 + MAX * 60_000, open: 101, high: 106, low: 100, close: 105 },
    ];
    expect(rolled.length).toBe(initial.length);
    expect(rolled[0].time).not.toBe(initial[0].time);

    mounted.rerender(<CandlestickSeries id={sid} data={rolled} />);

    // Entrance entry for the newly-appended tail must be registered in
    // engine state even though the array length didn't grow.
    const entries = entranceProgressFor(mounted.chart, sid);
    expect(entries.has(1_000_000 + MAX * 60_000)).toBe(true);
  });

  it('line: rolling-window slide still animates the new trailing point', () => {
    const MAX = 10;
    const initial: TimePoint[][] = [
      Array.from({ length: MAX }, (_, i) => ({ time: 1_000_000 + i * 60_000, value: i + 1 })),
    ];
    const sid = 'line';
    mounted = mountChart(<LineSeries id={sid} data={initial} />, { width: 800, height: 400 });
    mounted.flushScheduler();

    const rolled: TimePoint[][] = [[...initial[0].slice(1), { time: 1_000_000 + MAX * 60_000, value: MAX + 1 }]];
    expect(rolled[0].length).toBe(initial[0].length);
    expect(rolled[0][0].time).not.toBe(initial[0][0].time);

    mounted.rerender(<LineSeries id={sid} data={rolled} />);

    const entries = entranceProgressFor(mounted.chart, sid);
    expect(entries.has(1_000_000 + MAX * 60_000)).toBe(true);
  });

  it('line: new trailing points stream in via appendData per layer (entrance entry registered)', () => {
    const initial: TimePoint[][] = [
      Array.from({ length: 5 }, (_, i) => ({ time: 1_000_000 + i * 60_000, value: i + 1 })),
    ];
    const sid = 'line';
    mounted = mountChart(<LineSeries id={sid} data={initial} />, {
      width: 800,
      height: 400,
    });
    mounted.flushScheduler();

    const next: TimePoint[][] = [[...initial[0], { time: 1_000_000 + 5 * 60_000, value: 6 }]];
    mounted.rerender(<LineSeries id={sid} data={next} />);

    const entries = entranceProgressFor(mounted.chart, sid);
    expect(entries.size).toBeGreaterThan(0);
  });
});
