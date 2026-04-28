import type { OHLCData, OHLCInput, TimePoint, TimePointInput, TimeValue } from '../types';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const YEAR = 365 * DAY;

/** Convert a {@link TimeValue} (number ms or Date) to a millisecond timestamp. */
export function normalizeTime(t: TimeValue): number {
  return t instanceof Date ? t.getTime() : t;
}

/** Normalize the `time` field of every element in an {@link OHLCInput} array to produce {@link OHLCData}. */
export function normalizeOHLCArray(data: OHLCInput[]): OHLCData[] {
  if (data.length === 0) return data as OHLCData[];
  // Check every item: TimeValue is declared per-entry, so mixed arrays must
  // normalize the Date items even when earlier ones are already numbers.
  if (!data.some((d) => d.time instanceof Date)) return data as OHLCData[];
  return data.map((d) => ({ ...d, time: normalizeTime(d.time) }));
}

/** Normalize the `time` field of every element in a {@link TimePointInput} array to produce {@link TimePoint}. */
export function normalizeTimePointArray(data: TimePointInput[]): TimePoint[] {
  if (data.length === 0) return data as TimePoint[];
  if (!data.some((d) => d.time instanceof Date)) return data as TimePoint[];
  return data.map((d) => ({ ...d, time: normalizeTime(d.time) }));
}

export function detectInterval(times: number[]): number {
  if (times.length < 2) return DAY;
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(times.length, 20); i++) {
    diffs.push(times[i] - times[i - 1]);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

export function formatTime(timestamp: number, interval: number): string {
  const d = new Date(timestamp);
  if (interval >= YEAR) {
    return d.toLocaleDateString('en-US', { year: 'numeric' });
  }
  if (interval >= DAY) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (interval >= HOUR) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function niceTimeIntervals(interval: number): number[] {
  const sub_minute = [1_000, 5_000, 10_000, 15_000, 30_000];
  const sub_hour = [MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE];
  const sub_day = [HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 12 * HOUR];
  const days = [DAY, 7 * DAY, 30 * DAY, 90 * DAY];
  const years = [YEAR, 2 * YEAR, 5 * YEAR, 10 * YEAR, 25 * YEAR, 50 * YEAR, 100 * YEAR];

  // Always include all larger interval tiers so zoomed-out views
  // can escalate beyond the data interval's native granularity
  if (interval < MINUTE) return [...sub_minute, ...sub_hour, ...sub_day, ...days, ...years];
  if (interval < HOUR) return [...sub_hour, ...sub_day, ...days, ...years];
  if (interval < DAY) return [...sub_day, ...days, ...years];
  if (interval < YEAR) return [...days, ...years];

  return years;
}
