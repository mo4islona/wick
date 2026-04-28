import { describe, expect, it } from 'vitest';

import {
  detectInterval,
  formatTime,
  niceTimeIntervals,
  normalizeOHLCArray,
  normalizeTime,
  normalizeTimePointArray,
} from '../utils/time';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const YEAR = 365 * DAY;

describe('detectInterval', () => {
  it('detects 60s interval', () => {
    const times = [1000_000, 1060_000, 1120_000, 1180_000, 1240_000];
    expect(detectInterval(times)).toBe(MINUTE);
  });

  it('detects 5m interval', () => {
    const times = [0, 300_000, 600_000, 900_000, 1_200_000];
    expect(detectInterval(times)).toBe(5 * MINUTE);
  });

  it('returns DAY for single point', () => {
    expect(detectInterval([1_000_000])).toBe(DAY);
  });

  it('handles irregular data (uses median)', () => {
    // Most intervals are 60s, one outlier at 120s
    const times = [0, 60_000, 120_000, 180_000, 300_000, 360_000, 420_000];
    const result = detectInterval(times);
    expect(result).toBe(MINUTE);
  });
});

describe('normalizeTime', () => {
  it('passes numbers through unchanged', () => {
    expect(normalizeTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTime(0)).toBe(0);
  });

  it('converts Date to millisecond timestamp', () => {
    const ms = 1_700_000_000_000;
    expect(normalizeTime(new Date(ms))).toBe(ms);
  });
});

describe('normalizeOHLCArray', () => {
  it('normalizes mixed number/Date arrays per item', () => {
    // First item is a number (fast path), later items are Dates — must still be converted.
    const ms = 1_700_000_000_000;
    const out = normalizeOHLCArray([
      { time: ms, open: 1, high: 2, low: 0, close: 1.5 },
      { time: new Date(ms + 60_000), open: 1.5, high: 2.5, low: 1, close: 2 },
    ]);
    expect(out[0].time).toBe(ms);
    expect(out[1].time).toBe(ms + 60_000);
    expect(typeof out[1].time).toBe('number');
  });

  it('normalizes Date-first mixed arrays without throwing on later numbers', () => {
    const ms = 1_700_000_000_000;
    const out = normalizeOHLCArray([
      { time: new Date(ms), open: 1, high: 2, low: 0, close: 1.5 },
      { time: ms + 60_000, open: 1.5, high: 2.5, low: 1, close: 2 },
    ]);
    expect(out[0].time).toBe(ms);
    expect(out[1].time).toBe(ms + 60_000);
  });
});

describe('normalizeTimePointArray', () => {
  it('normalizes mixed number/Date arrays per item', () => {
    const ms = 1_700_000_000_000;
    const out = normalizeTimePointArray([
      { time: ms, value: 10 },
      { time: new Date(ms + 60_000), value: 20 },
    ]);
    expect(out[0].time).toBe(ms);
    expect(out[1].time).toBe(ms + 60_000);
    expect(typeof out[1].time).toBe('number');
  });

  it('normalizes Date-first mixed arrays without throwing on later numbers', () => {
    const ms = 1_700_000_000_000;
    const out = normalizeTimePointArray([
      { time: new Date(ms), value: 10 },
      { time: ms + 60_000, value: 20 },
    ]);
    expect(out[0].time).toBe(ms);
    expect(out[1].time).toBe(ms + 60_000);
  });
});

describe('niceTimeIntervals', () => {
  it('returns sub-minute intervals for < 60s data', () => {
    const intervals = niceTimeIntervals(10_000);
    expect(intervals[0]).toBeLessThan(MINUTE);
  });

  it('returns sub-hour intervals for minute data', () => {
    const intervals = niceTimeIntervals(MINUTE);
    expect(intervals[0]).toBe(MINUTE);
  });

  it('returns day intervals for daily data', () => {
    const intervals = niceTimeIntervals(DAY);
    expect(intervals[0]).toBe(DAY);
  });

  it('exposes multi-year tiers so 150-year spans can decimate to readable tick counts', () => {
    // 5y candles spanning 150y => 30 candles. With only 1y as the largest
    // tick interval, the axis paints ~30 labels and they collide.
    // Need at least one bucket >= 5*YEAR to space them out.
    const intervals = niceTimeIntervals(5 * YEAR);
    const max = Math.max(...intervals);
    expect(max).toBeGreaterThanOrEqual(5 * YEAR);
  });
});

describe('formatTime', () => {
  // 2018-12-31 UTC — chosen so locale tz drift can't bump it across a year
  // boundary in a way that would invalidate the assertion.
  const ts = Date.UTC(2018, 5, 15);

  it('formats yearly intervals as a year, not a month', () => {
    const out = formatTime(ts, YEAR);

    expect(out).toMatch(/2018/);
    // Specifically must NOT be "Dec" / "Jun" / etc. — that's the bug
    // ("Dec Dec Dec…" repeats across yearly axis).
    expect(out).not.toMatch(/^[A-Z][a-z]{2} \d+$/);
  });

  it('formats multi-year intervals as a year', () => {
    const out = formatTime(ts, 5 * YEAR);

    expect(out).toMatch(/2018/);
    expect(out).not.toMatch(/^[A-Z][a-z]{2} \d+$/);
  });

  it('still formats month/day for sub-year day-scale intervals', () => {
    const out = formatTime(ts, DAY);
    expect(out).toMatch(/^[A-Z][a-z]{2} \d+$/);
  });
});
