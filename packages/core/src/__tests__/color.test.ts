import { describe, expect, it } from 'vitest';

import { darken, hexToRgba, lighten } from '../utils/color';

describe('hexToRgba', () => {
  it('converts a 6-digit hex to rgba with the supplied alpha', () => {
    expect(hexToRgba('#ff8040', 0.5)).toBe('rgba(255, 128, 64, 0.5)');
  });

  it('caches the result so repeat calls return the same string instance', () => {
    const a = hexToRgba('#001020', 0.25);
    const b = hexToRgba('#001020', 0.25);
    expect(a).toBe(b);
  });

  it('rewrites the alpha of an existing rgba(...) string instead of re-parsing', () => {
    expect(hexToRgba('rgba(10, 20, 30, 0.9)', 0.1)).toBe('rgba(10, 20, 30, 0.1)');
  });

  it('promotes an rgb(...) string to rgba with the supplied alpha', () => {
    expect(hexToRgba('rgb(10, 20, 30)', 0.4)).toBe('rgba(10, 20, 30, 0.4)');
  });
});

describe('lighten', () => {
  it('moves each channel toward 255 by the supplied fraction', () => {
    // (255-0)*0.5 = 127.5 → 128
    expect(lighten('#000000', 0.5)).toBe('#808080');
  });

  it('clamps at #ffffff when the channel would overflow', () => {
    expect(lighten('#ffffff', 0.5)).toBe('#ffffff');
  });

  it('caches by hex+amount so a second call is the same string', () => {
    const a = lighten('#123456', 0.3);
    const b = lighten('#123456', 0.3);
    expect(a).toBe(b);
  });
});

describe('darken', () => {
  it('scales each channel toward 0 by the supplied fraction', () => {
    // 200 * (1 - 0.5) = 100 → 0x64
    expect(darken('#c8c8c8', 0.5)).toBe('#646464');
  });

  it('clamps at #000000 when the channel would underflow', () => {
    expect(darken('#000000', 0.9)).toBe('#000000');
  });

  it('caches by hex+amount so a second call is the same string', () => {
    const a = darken('#abcdef', 0.4);
    const b = darken('#abcdef', 0.4);
    expect(a).toBe(b);
  });

  it('pads single-digit channels with a leading zero', () => {
    // 10 * (1 - 0.9) = 1 → "01"
    expect(darken('#0a0a0a', 0.9)).toBe('#010101');
  });
});
