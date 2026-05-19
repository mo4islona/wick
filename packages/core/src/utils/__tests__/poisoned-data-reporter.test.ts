import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isPoisonedNumber, reportPoisonedData } from '../poisoned-data-reporter';

describe('isPoisonedNumber', () => {
  it('flags NaN and ±Infinity', () => {
    expect(isPoisonedNumber(Number.NaN)).toBe(true);
    expect(isPoisonedNumber(Number.POSITIVE_INFINITY)).toBe(true);
    expect(isPoisonedNumber(Number.NEGATIVE_INFINITY)).toBe(true);
  });

  it('passes finite numbers (including 0 and negatives)', () => {
    expect(isPoisonedNumber(0)).toBe(false);
    expect(isPoisonedNumber(-100)).toBe(false);
    expect(isPoisonedNumber(1e9)).toBe(false);
    expect(isPoisonedNumber(0.001)).toBe(false);
  });

  it('passes null / undefined (caller handles coercion-to-zero downstream)', () => {
    expect(isPoisonedNumber(null)).toBe(false);
    expect(isPoisonedNumber(undefined)).toBe(false);
  });
});

describe('reportPoisonedData', () => {
  let warns: unknown[][];
  let origWarn: typeof console.warn;

  beforeEach(() => {
    warns = [];
    origWarn = console.warn;
    console.warn = (...args) => {
      warns.push(args);
    };
  });

  afterEach(() => {
    console.warn = origWarn;
  });

  it('no-ops when the indices list is empty', () => {
    reportPoisonedData({}, 'candlestick', [], 'time 0');
    expect(warns).toHaveLength(0);
  });

  it('warns once per token with the full batch of offending indices', () => {
    const token = {};
    reportPoisonedData(token, 'candlestick', [1, 2, 3], 'time 30');

    expect(warns).toHaveLength(1);
    const msg = String(warns[0][0]);
    expect(msg).toContain('candlestick');
    expect(msg).toContain('skipping 3 rows');
    expect(msg).toContain('indices 1, 2, 3');
    expect(msg).toContain('time 30');
  });

  it('singular "row" for a single bad index', () => {
    reportPoisonedData({}, 'bar', [7], 'time 100');

    const msg = String(warns[0][0]);
    expect(msg).toContain('skipping 1 row ');
    expect(msg).not.toContain('1 rows');
  });

  it('dedupes per token — second call with the same token stays silent', () => {
    const token = {};
    reportPoisonedData(token, 'candlestick', [1], 'time 30');
    reportPoisonedData(token, 'candlestick', [1, 2], 'time 30');

    expect(warns).toHaveLength(1);
  });

  it('different tokens each get their own warning', () => {
    reportPoisonedData({}, 'candlestick', [1], 'time 30');
    reportPoisonedData({}, 'candlestick', [1], 'time 30');

    expect(warns).toHaveLength(2);
  });

  it('reuses the same closure state across `sourceLabel` values for a single token', () => {
    // The dedupe is per-token, not per-(token, label). Once a token has
    // warned, any subsequent call with that token — regardless of label —
    // stays silent. This matches "one warning per renderer instance".
    const token = {};
    reportPoisonedData(token, 'candlestick', [1], 'time 30');
    reportPoisonedData(token, 'bar', [4], 'time 90');

    expect(warns).toHaveLength(1);
  });
});
