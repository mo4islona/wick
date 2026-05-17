import type { VisibleRange, YRange } from '../types';
import type { Transition, TransitionFactory } from './transition';
import { VisibleRangeSpring } from './visible-range-spring';
import { YRangeSpring } from './y-range-spring';

/**
 * Critically-damped spring transition factory. Generic over the value type
 * so the same factory works for both Y (`YRange`) and X (`VisibleRange`).
 *
 * The factory dispatches at construction time based on the shape of the
 * initial value:
 *
 * - `{ min, max }` → {@link YRangeSpring} (direction-aware ω: expand vs
 *   contract, used by the sticky-Y mechanism).
 * - `{ from, to }` → {@link VisibleRangeSpring} (single ω, no direction
 *   asymmetry — X has no analog of sticky-Y).
 *
 * Both implementations carry velocity through mid-flight retargets so
 * wheel-zoom sequences and rapid streaming ticks stay continuous.
 *
 * Usage:
 * ```ts
 * animations: {
 *   axis: {
 *     y: { curve: spring() },
 *     x: { curve: spring() },
 *   },
 * }
 * ```
 *
 * The engine is the single source of truth for the per-call durations —
 * settle times come through `RetargetOptions.expandMs` / `contractMs`.
 */
export function spring<T extends YRange | VisibleRange = YRange>(): TransitionFactory<T> {
  return ({ initial }) => {
    if (isYRange(initial)) {
      return new YRangeSpring({ initial }) as unknown as Transition<T>;
    }

    return new VisibleRangeSpring({ initial }) as unknown as Transition<T>;
  };
}

function isYRange(value: YRange | VisibleRange): value is YRange {
  return 'min' in value && 'max' in value;
}
