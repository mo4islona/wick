/**
 * Resolve an `enterMs` / `smoothMs` / `pulseMs` option value to a concrete
 * number. `false` collapses to 0 (disabled); `undefined` falls back to the
 * built-in default.
 */
export function resolveMs(value: number | false | undefined, fallback: number): number {
  if (value === false) return 0;
  if (value === undefined) return fallback;

  return value;
}
