import type { YRange } from '../types';
import type { YEngineFactory, YRangeAnimatorLike } from './y-engine-types';

/**
 * Build a no-animation factory: every `setTarget` lands instantly, every
 * `tick` is a no-op. Used internally when the caller sets
 * `animations.viewport: false` (or `animations: false`) — the Y bounds
 * just track the data extremes frame-by-frame with no easing.
 *
 * Exposed so power users can opt out of Y motion without disabling other
 * animations: `animations={{ viewport: { yEngine: snapAnimator() } }}`.
 */
export function snapAnimator(): YEngineFactory {
  return ({ initial }): YRangeAnimatorLike => {
    let state: YRange = { min: initial.min, max: initial.max };

    return {
      get current() {
        return state;
      },
      get target() {
        return state;
      },
      get animating() {
        return false;
      },
      setTarget(value) {
        state = { min: value.min, max: value.max };
      },
      snap(value) {
        state = { min: value.min, max: value.max };
      },
      tick() {
        return false;
      },
    };
  };
}
