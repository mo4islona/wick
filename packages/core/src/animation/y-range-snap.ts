import type { VisibleRange, YRange } from '../types';
import type { Transition, TransitionFactory } from './transition';

/**
 * No-animation transition. Every `retarget` lands instantly, every `tick`
 * is a no-op. Used internally when the caller sets `animations.axis.y: false`
 * (or `animations: false`) — the bounds just track the data extremes
 * frame-by-frame with no easing. Generic over `T` so the same factory works
 * for both Y (`YRange`) and X (`VisibleRange`).
 */
export class RangeSnap<T extends YRange | VisibleRange> implements Transition<T> {
  #state: T;

  constructor(opts: { initial: T }) {
    this.#state = { ...opts.initial };
  }

  get current(): T {
    return this.#state;
  }

  get target(): T {
    return this.#state;
  }

  get animating(): boolean {
    return false;
  }

  retarget(value: T): void {
    this.#state = { ...value };
  }

  snap(value: T): void {
    this.#state = { ...value };
  }

  tick(): boolean {
    return false;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Snap factory — no animation, no parameters. Generic so it works for both
 * Y and X. Exposed so power users can opt out of axis motion without
 * disabling other animations:
 *
 * ```
 * animations: { axis: { y: { curve: snap() } } }
 * ```
 */
export function snap<T extends YRange | VisibleRange = YRange>(): TransitionFactory<T> {
  return ({ initial }) => new RangeSnap<T>({ initial });
}
