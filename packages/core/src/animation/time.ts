/**
 * Time helpers for the animation config surface. The public config accepts
 * three shapes: a number (already milliseconds), a string with an explicit
 * unit (`"250ms"`, `"1s"`, `"2.5s"`), or `false` to disable. The resolver
 * parses each input once at chart construction; the hot render path then
 * only ever sees numbers.
 */

export type Milliseconds = number;

/**
 * Public animation-time input. Accepts:
 *  - `number` — already milliseconds (`250`)
 *  - `string` in `<n>ms` or `<n>s` form (`"250ms"`, `"1s"`, `"2.5s"`)
 *  - `false` — disable (equivalent to `0`)
 */
export type AnimationTime = Milliseconds | string | false;

const TIME_PATTERN = /^(\d+(?:\.\d+)?)(ms|s)$/;

/**
 * Parse an {@link AnimationTime} to milliseconds. Invalid strings throw at
 * config-resolution time so a typo surfaces at startup, not silently as zero
 * animation later. Used once per field in `resolveAnimationsConfig`.
 */
export function parseAnimationTime(value: AnimationTime): Milliseconds {
  if (value === false) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = TIME_PATTERN.exec(value);
    if (!match) throw new Error(`Invalid AnimationTime: ${JSON.stringify(value)}`);

    const n = Number.parseFloat(match[1]);

    return match[2] === 's' ? n * 1000 : n;
  }

  throw new Error(`Invalid AnimationTime: ${String(value)}`);
}

/**
 * Parse with fallback when input is `undefined`. Used pervasively in
 * `resolveAnimationsConfig` to merge a partial user config against defaults.
 */
export function resolveAnimationTime(value: AnimationTime | undefined, fallback: Milliseconds): Milliseconds {
  if (value === undefined) return fallback;

  return parseAnimationTime(value);
}
