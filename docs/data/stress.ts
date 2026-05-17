/**
 * Stress-test data generators. Separate module from the main `docs/data.ts`
 * generators so the public demo pages don't accidentally import these —
 * they produce intentionally-broken data (nulls, NaN, unsorted, duplicates).
 */

import type { OHLCData, TimePoint } from '@wick-charts/react';

import { DEMO_INTERVAL, generateOHLCData } from '../data';

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Random OHLC series with a fraction of points poisoned by `null` fields. */
export function generateOHLCWithNulls(count: number, startPrice = 100, nullRate = 0.15): OHLCData[] {
  const base = generateOHLCData(count, startPrice, DEMO_INTERVAL) as Writable<OHLCData>[];
  for (let i = 0; i < base.length; i++) {
    if (Math.random() >= nullRate) continue;
    const field = ['close', 'open', 'high', 'low', 'volume'][Math.floor(Math.random() * 5)] as keyof OHLCData;
    // Cast through `unknown` because OHLCData's fields are number / number | undefined.
    // The renderer must not crash on these — that's what the panel stresses.
    (base[i] as Record<string, unknown>)[field as string] = null;
  }

  return base as OHLCData[];
}

/** Line series with scattered null / NaN / Infinity values. */
export function generateLineWithNulls(count: number, poisonRate = 0.2): TimePoint[] {
  const poisons = [null, Number.NaN, Number.POSITIVE_INFINITY, undefined];
  const out: TimePoint[] = [];
  for (let i = 0; i < count; i++) {
    const clean = { time: i * DEMO_INTERVAL, value: 50 + Math.sin(i * 0.1) * 30 + Math.random() * 10 };
    if (Math.random() < poisonRate) {
      (clean as unknown as Record<string, unknown>).value = poisons[i % poisons.length];
    }
    out.push(clean);
  }

  return out;
}

/** Bar data — effectively line data consumed by BarSeries — with nulls/NaN sprinkled in. */
export function generateBarWithNulls(count: number, poisonRate = 0.2): TimePoint[] {
  const poisons = [null, Number.NaN, Number.NEGATIVE_INFINITY, undefined];
  const out: TimePoint[] = [];
  for (let i = 0; i < count; i++) {
    const clean: TimePoint = { time: i * DEMO_INTERVAL, value: Math.sin(i * 0.2) * 80 + (Math.random() - 0.5) * 20 };
    if (Math.random() < poisonRate) {
      (clean as unknown as Record<string, unknown>).value = poisons[i % poisons.length];
    }
    out.push(clean);
  }

  return out;
}

/** OHLC series with scattered NaN / Infinity values. */
export function generateOHLCWithNanInfinity(count: number, startPrice = 100): OHLCData[] {
  const base = generateOHLCData(count, startPrice, DEMO_INTERVAL) as Writable<OHLCData>[];
  const poisons = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < base.length; i++) {
    if (i % 7 !== 0) continue;
    const field = ['close', 'high', 'low', 'volume'][i % 4] as keyof OHLCData;
    (base[i] as Record<string, unknown>)[field as string] = poisons[i % poisons.length];
  }

  return base as OHLCData[];
}

/** All OHLC values identical — min === max on the y-axis. */
export function generateConstantOHLC(count: number, value = 100): OHLCData[] {
  const out: OHLCData[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ time: i * DEMO_INTERVAL, open: value, high: value, low: value, close: value, volume: 0 });
  }

  return out;
}

/** Near-zero magnitudes — values in `[min, min * 2]` for some tiny `min`. */
export function generateNearZeroLine(count: number, min = 1e-8): TimePoint[] {
  const out: TimePoint[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ time: i * DEMO_INTERVAL, value: min * (1 + Math.sin(i * 0.3) * 0.4 + Math.random() * 0.1) });
  }

  return out;
}

/** Values spanning many orders of magnitude. */
export function generateHugeRangeLine(count: number): TimePoint[] {
  const out: TimePoint[] = [];
  for (let i = 0; i < count; i++) {
    // Exponential ramp from 1 → 1e9 with sinusoidal wobble to avoid pure-monotonic.
    const exp = (i / Math.max(1, count - 1)) * 9;
    const wobble = 1 + Math.sin(i * 0.2) * 0.2;
    out.push({ time: i * DEMO_INTERVAL, value: 10 ** exp * wobble });
  }

  return out;
}

/** Line series that crosses zero, positive → negative → positive. */
export function generateNegativeCrossingLine(count: number, amplitude = 500): TimePoint[] {
  const out: TimePoint[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ time: i * DEMO_INTERVAL, value: amplitude * Math.sin(i * 0.08) });
  }

  return out;
}

/** All-negative OHLC — inverts the usual mental model. */
export function generateAllNegativeOHLC(count: number): OHLCData[] {
  const base = generateOHLCData(count, 100, DEMO_INTERVAL);

  return base.map((c) => ({
    time: c.time,
    open: -c.open,
    high: -c.low,
    low: -c.high,
    close: -c.close,
    volume: c.volume,
  }));
}

/** Insert a gap — no data between `gapStart` and `gapStart + gapLen` bars. */
export function generateGappedOHLC(count: number, gapStart = 120, gapLen = 50): OHLCData[] {
  const left = generateOHLCData(gapStart, 100, DEMO_INTERVAL);
  const rightStart = (gapStart + gapLen) * DEMO_INTERVAL;
  const right = generateOHLCData(count - gapStart - gapLen, 100, DEMO_INTERVAL).map((c, i) => ({
    ...c,
    time: rightStart + i * DEMO_INTERVAL,
  }));

  return [...left, ...right];
}

/** Two bars sharing the same `time`. */
export function generateDuplicateTimestampOHLC(count: number): OHLCData[] {
  const base = generateOHLCData(count, 100, DEMO_INTERVAL) as Writable<OHLCData>[];
  if (base.length >= 3) {
    base[2].time = base[1].time;
  }

  return base as OHLCData[];
}

/** Reversed array — newest first, oldest last. */
export function generateUnsortedOHLC(count: number): OHLCData[] {
  return [...generateOHLCData(count, 100, DEMO_INTERVAL)].reverse();
}

/** N tiny slices with a single dominant one. */
export function manyPieSlices(total = 100): { label: string; value: number }[] {
  const slices: { label: string; value: number }[] = [];
  for (let i = 0; i < total; i++) {
    slices.push({ label: `Slice ${i + 1}`, value: Math.max(0.1, Math.random()) });
  }

  return slices;
}

/** Pie data with a mix of negatives and NaN. */
export function poisonedPieSlices(): { label: string; value: number }[] {
  return [
    { label: 'Healthy', value: 30 },
    { label: 'Negative', value: -10 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Zero', value: 0 },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: 'Tail', value: 20 },
  ];
}

/**
 * Simple moving average — returns a line series with the same `time` grid as
 * the input OHLC (first `window - 1` points omitted). Used for the
 * multi-renderer "candle + SMA + EMA" panel.
 */
export function sma(ohlc: OHLCData[], window: number): TimePoint[] {
  const out: TimePoint[] = [];
  let sum = 0;
  for (let i = 0; i < ohlc.length; i++) {
    sum += ohlc[i].close;
    if (i >= window) sum -= ohlc[i - window].close;
    if (i >= window - 1) out.push({ time: ohlc[i].time, value: sum / window });
  }

  return out;
}

/** Exponential moving average. */
export function ema(ohlc: OHLCData[], period: number): TimePoint[] {
  const k = 2 / (period + 1);
  const out: TimePoint[] = [];
  let prev = ohlc[0]?.close ?? 0;
  for (let i = 0; i < ohlc.length; i++) {
    const v = i === 0 ? ohlc[0].close : ohlc[i].close * k + prev * (1 - k);
    out.push({ time: ohlc[i].time, value: v });
    prev = v;
  }

  return out;
}

/**
 * OHLC where `|close - open|` collapses to ≤ 2 bitmap-px at typical panel
 * sizes. Regression case for the gradient-body flat-top-stop fix — the tuple
 * body path must fall through to a flat top-stop fill below the threshold, not
 * leak the prior wick color.
 *
 * Bodies are a constant ~0.00002 * price → ≈1 price unit at price=50_000.
 * Wicks give the axis something to range over (≈ ±50 units → ~100-unit range),
 * so the body-to-range ratio is ~1% → ≤3 px body height on a 300-px panel.
 */
export function generateThinCandles(count: number, price = 50_000): OHLCData[] {
  const out: OHLCData[] = [];
  for (let i = 0; i < count; i++) {
    const center = price + Math.sin(i * 0.03) * 30;
    // Body delta oscillates between ±1 price unit — sub-pixel at typical
    // panel heights since the axis spans ~100 units.
    const delta = Math.sin(i * 0.5) + Math.sin(i * 0.13) * 0.3;
    const open = center;
    const close = center + delta;
    const high = Math.max(open, close) + 10 + Math.abs(Math.sin(i * 0.17)) * 20;
    const low = Math.min(open, close) - 10 - Math.abs(Math.cos(i * 0.19)) * 20;
    out.push({ time: i * DEMO_INTERVAL, open, high, low, close });
  }

  return out;
}
