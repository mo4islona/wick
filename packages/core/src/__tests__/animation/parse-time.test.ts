import { describe, expect, it } from 'vitest';

import { parseAnimationTime, resolveAnimationTime } from '../../animation/time';

describe('parseAnimationTime', () => {
  it('passes through positive numbers untouched', () => {
    expect(parseAnimationTime(0)).toBe(0);
    expect(parseAnimationTime(250)).toBe(250);
    expect(parseAnimationTime(1234.5)).toBe(1234.5);
  });

  it('treats `false` as 0', () => {
    expect(parseAnimationTime(false)).toBe(0);
  });

  it('parses `Nms` strings', () => {
    expect(parseAnimationTime('0ms')).toBe(0);
    expect(parseAnimationTime('250ms')).toBe(250);
    expect(parseAnimationTime('1500ms')).toBe(1500);
  });

  it('parses `Ns` strings into milliseconds', () => {
    expect(parseAnimationTime('1s')).toBe(1000);
    expect(parseAnimationTime('2.5s')).toBe(2500);
    expect(parseAnimationTime('0.1s')).toBe(100);
  });

  it('rejects bare number strings (unit required)', () => {
    expect(() => parseAnimationTime('250')).toThrow();
  });

  it('rejects unknown units', () => {
    expect(() => parseAnimationTime('250mins')).toThrow();
    expect(() => parseAnimationTime('5min')).toThrow();
    expect(() => parseAnimationTime('1h')).toThrow();
  });

  it('rejects unparseable strings', () => {
    expect(() => parseAnimationTime('abc')).toThrow();
    expect(() => parseAnimationTime('')).toThrow();
    expect(() => parseAnimationTime(' 250ms')).toThrow();
  });
});

describe('resolveAnimationTime', () => {
  it('returns fallback when input is undefined', () => {
    expect(resolveAnimationTime(undefined, 250)).toBe(250);
  });

  it('parses input when present', () => {
    expect(resolveAnimationTime('500ms', 250)).toBe(500);
    expect(resolveAnimationTime(false, 250)).toBe(0);
    expect(resolveAnimationTime(1234, 250)).toBe(1234);
  });
});
