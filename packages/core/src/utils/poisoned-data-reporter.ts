/**
 * Generic "skip + warn-once" reporter for poisoned upstream data.
 *
 * Series renderers (`candlestick`, `bar`, `line`, …) all face the same
 * class of bug: a single bar / point with `NaN` or `±Infinity` in a
 * numeric field propagates through the scale arithmetic into
 * `ctx.createLinearGradient(NaN, ...)` (or similar canvas calls) and
 * crashes the whole frame. The fix at every site is the same — filter
 * the bad rows out, then warn the integrator so they can clean their
 * feed.
 *
 * To keep that filter cheap and side-effect-free for the common
 * everything-finite case, this module exposes a single closure-backed
 * helper. State (which renderers have already warned) lives inside the
 * closure's `WeakSet`, not on the renderer class, so:
 *
 *  - No renderer needs an extra `#warnedPoisoned` field.
 *  - Disposed renderers get GC'd normally (WeakSet entries clear).
 *  - The first poisoned render emits one batched warning listing
 *    *every* offending index — subsequent renders against the same
 *    instance stay silent.
 *
 * Renderers pass their own `this` as the token. Two renderer instances
 * (e.g. two charts on the same page) each get their own one-shot
 * warning.
 */

/**
 * Tighter "is this value a NaN / ±Infinity number" predicate than
 * `!Number.isFinite(v)`: it deliberately lets `null` / `undefined`
 * through because their `valueToY` arithmetic coerces them to `0` and
 * the renderers ship working behavior for that case — filtering them
 * here would visibly hide bars that previously rendered.
 */
export function isPoisonedNumber(v: number | null | undefined): boolean {
  return typeof v === 'number' && !Number.isFinite(v);
}

/**
 * `console.warn` once per `token`, listing every offending index in one
 * message so the integrator can audit the whole dirty feed in a single
 * pass instead of re-running with new data after each hidden bar pops up.
 *
 * @param token         Stable per-renderer identity. Pass `this`.
 * @param sourceLabel   Human-readable subsystem name (e.g. `"candlestick"`).
 * @param indices       Zero-based positions of every poisoned row.
 * @param firstBadAt    A description / time anchor of the first poisoned
 *                      row — embedded into the warning so the integrator
 *                      can correlate against the upstream feed.
 */
export const reportPoisonedData: (
  token: object,
  sourceLabel: string,
  indices: readonly number[],
  firstBadAt: string | number,
) => void = (() => {
  const warned = new WeakSet<object>();

  return (token, sourceLabel, indices, firstBadAt) => {
    if (indices.length === 0 || warned.has(token)) return;

    warned.add(token);
    console.warn(
      `[wick-charts] ${sourceLabel}: skipping ${indices.length} row${indices.length === 1 ? '' : 's'} ` +
        `with NaN / Infinity values (indices ${indices.join(', ')}; first offending row: ${firstBadAt}). ` +
        'Filter upstream data; the renderer drops poisoned rows to keep the rest of the chart alive.',
    );
  };
})();
