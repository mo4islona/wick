import type { YRange } from '../types';
import type { Transition, TransitionFactory } from './transition';

/**
 * No-animation Y transition. Every `retarget` lands instantly, every `tick`
 * is a no-op. Used internally when the caller sets `animations.y: false`
 * (or `animations: false`) — the Y bounds just track the data extremes
 * frame-by-frame with no easing.
 */
export class YRangeSnap implements Transition {
  #state: YRange;

  constructor(opts: { initial: YRange }) {
    this.#state = { min: opts.initial.min, max: opts.initial.max };
  }

  get current(): YRange {
    return this.#state;
  }

  get target(): YRange {
    return this.#state;
  }

  get animating(): boolean {
    return false;
  }

  retarget(value: YRange): void {
    this.#state = { min: value.min, max: value.max };
  }

  snap(value: YRange): void {
    this.#state = { min: value.min, max: value.max };
  }

  tick(): boolean {
    return false;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Snap factory — no animation, no parameters. Exposed so power users can
 * opt out of Y motion without disabling other animations:
 * `animations={{ y: { transition: snap() } }}`.
 */
export function snap(): TransitionFactory {
  return ({ initial }) => new YRangeSnap({ initial });
}
