import { describe, expect, it } from 'vitest';

import { decimateLineData, decimateOHLCData } from '../data/decimation';
import type { OHLCData, TimePoint } from '../types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeLine(count: number, valueFn: (i: number) => number = (i) => i): TimePoint[] {
  return Array.from({ length: count }, (_, i) => ({ time: i, value: valueFn(i) }));
}

function makeOHLC(count: number): OHLCData[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i * 60_000,
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 105 + i,
    volume: 1000 + i,
  }));
}

// ---------------------------------------------------------------------------
// decimateLineData
// ---------------------------------------------------------------------------

describe('decimateLineData', () => {
  it('returns data as-is when length <= target', () => {
    const data = makeLine(5);
    const result = decimateLineData(data, 10);
    expect(result).toBe(data);
  });

  it('returns data as-is when length equals target', () => {
    const data = makeLine(5);
    const result = decimateLineData(data, 5);
    expect(result).toBe(data);
  });

  it('preserves first and last points', () => {
    const data = makeLine(100);
    const result = decimateLineData(data, 10);
    expect(result[0]).toBe(data[0]);
    expect(result[result.length - 1]).toBe(data[data.length - 1]);
  });

  it('output length matches target count', () => {
    const data = makeLine(200);
    const target = 20;
    const result = decimateLineData(data, target);
    expect(result).toHaveLength(target);
  });

  it('preserves extremes (max/min values appear in output)', () => {
    // Build data where a clear spike and dip exist in the middle
    const data = makeLine(100, (i) => {
      if (i === 30) return 9999; // extreme high
      if (i === 70) return -9999; // extreme low
      return Math.sin(i * 0.1) * 10;
    });

    const result = decimateLineData(data, 20);
    const values = result.map((d) => d.value);
    expect(values).toContain(9999);
    expect(values).toContain(-9999);
  });

  it('empty data returns empty', () => {
    const result = decimateLineData([], 10);
    expect(result).toEqual([]);
  });

  it('single point returns as-is', () => {
    const data: TimePoint[] = [{ time: 1, value: 42 }];
    const result = decimateLineData(data, 10);
    expect(result).toBe(data);
  });
});

// ---------------------------------------------------------------------------
// decimateOHLCData
// ---------------------------------------------------------------------------

describe('decimateOHLCData', () => {
  it('returns data as-is when length <= target', () => {
    const data = makeOHLC(5);
    const result = decimateOHLCData(data, 10);
    expect(result).toBe(data);
  });

  it('returns data as-is when length equals target', () => {
    const data = makeOHLC(5);
    const result = decimateOHLCData(data, 5);
    expect(result).toBe(data);
  });

  it('preserves first and last candles', () => {
    const data = makeOHLC(20);
    const result = decimateOHLCData(data, 5);
    // First bucket starts with the first candle
    expect(result[0].time).toBe(data[0].time);
    expect(result[0].open).toBe(data[0].open);
    // Last bucket ends with the last candle's close
    expect(result[result.length - 1].close).toBe(data[data.length - 1].close);
  });

  it('high/low extremes preserved in bucketed output', () => {
    const data = makeOHLC(20);
    // Inject a clear extreme into the middle
    data[10].high = 5000;
    data[12].low = -5000;

    const result = decimateOHLCData(data, 5);
    const allHighs = result.map((d) => d.high);
    const allLows = result.map((d) => d.low);

    expect(Math.max(...allHighs)).toBe(5000);
    expect(Math.min(...allLows)).toBe(-5000);
  });

  it('volume aggregated correctly', () => {
    const data: OHLCData[] = Array.from({ length: 6 }, (_, i) => ({
      time: i * 60_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 10,
    }));

    // target 3 => bucketSize = ceil(6/3) = 2, so 3 buckets of 2
    const result = decimateOHLCData(data, 3);
    for (const candle of result) {
      expect(candle.volume).toBe(20); // 2 candles x 10 volume each
    }
  });

  it('volume defaults to 0 for undefined volume', () => {
    const data: OHLCData[] = Array.from({ length: 4 }, (_, i) => ({
      time: i * 60_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      // no volume field
    }));

    const result = decimateOHLCData(data, 2);
    expect(result[0].volume).toBe(0);
    expect(result[1].volume).toBe(0);
  });

  it('output length matches target', () => {
    const data = makeOHLC(100);
    const result = decimateOHLCData(data, 10);
    expect(result).toHaveLength(10);
  });

  it('empty data returns empty', () => {
    const result = decimateOHLCData([], 10);
    expect(result).toEqual([]);
  });
});
