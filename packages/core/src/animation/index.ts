export { Animator, type AnimatorOptions } from './animator';
export { ANIM, type AnimKey } from './durations';
export { type Easing, easeLinear, easeOutCubic } from './easing';
export { YRangeHermite, type YRangeHermiteOptions } from './y-range-hermite';
export { YRangeSpring, type YRangeSpringOptions } from './y-range-spring';

import type { YRange } from '../types';

/**
 * Shared shape for the chart's Y-bound animators. Both
 * {@link YRangeSpring} (physics-based, asymptotic) and
 * {@link YRangeHermite} (cubic, bounded duration) implement this so
 * `chart.ts` can hold one or the other behind the same call sites.
 */
export interface YRangeAnimatorLike {
  readonly current: YRange;
  readonly target: YRange;
  readonly animating: boolean;
  setSettleMs(opts: { expandMs?: number; contractMs?: number }): void;
  setTarget(value: YRange, opts?: { now?: number }): void;
  snap(value: YRange, opts?: { now?: number }): void;
  tick(now: number): boolean;
}
