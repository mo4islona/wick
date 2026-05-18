import type { YRange } from '../types';
import type { Milliseconds } from './time';

/**
 * Per-call override for {@link Transition.retarget}. Either field overrides
 * the engine's baseline settle time for this single call — used during user
 * gestures (short ease) and visibility toggles (one-shot duration sync with
 * the alpha cross-fade). Asymmetric expand vs contract is the historical
 * sticky-Y mechanism; Phase 2 will collapse both into a single `duration`
 * once the engine becomes authoritative over per-call timing.
 */
export interface RetargetOptions {
  /** Optional wall clock. Defaults to `performance.now()`. */
  now?: number;
  /**
   * One-shot expand-direction settle time (ms). When the bound moves
   * *outward* — a side reaching a new extreme entering the visible window.
   */
  expandMs?: number;
  /**
   * One-shot contract-direction settle time (ms). When the bound moves
   * *inward* — contracting after an extreme leaves the window.
   */
  contractMs?: number;
}

/**
 * Smoothing-curve contract. Implementations (`YRangeHermite`, `YRangeSpring`,
 * `YRangeSnap` for Y; `VisibleRangeSpring` for X) drive a value of type `T`
 * from one snapshot to the next while maintaining `current` / `target` /
 * velocity continuity.
 *
 * Parametric over `T` so X and Y can share the same interface — Y uses
 * `Transition<YRange>` (default), X uses `Transition<VisibleRange>`.
 *
 * This is the single public customization point for the chart's curves.
 * Other animation math (entry tweens, pulse, axis tick fade) stays
 * engine-fixed.
 */
export interface Transition<T = YRange> {
  /** Current sampled position. Read by renderers on every frame. */
  readonly current: T;
  /** Active retarget destination. May equal `current` after settle. */
  readonly target: T;
  /** True while position has not yet converged to `target`. */
  readonly animating: boolean;

  /**
   * Begin a new transition toward `value`. Existing velocity is carried
   * over (no reset twitch) and direction-aware durations from the factory
   * apply unless overridden via `opts.expandMs` / `opts.contractMs`.
   */
  retarget(value: T, opts?: RetargetOptions): void;

  /** Land at `value` instantly. Velocity resets to zero. */
  snap(value: T, opts?: { now?: number }): void;

  /** Advance to `now`. Returns `true` while still perceptibly moving. */
  tick(now: number): boolean;
}

/**
 * Context handed to a {@link TransitionFactory} at chart construction.
 * Holds the initial value so the produced transition starts pinned to
 * the same value the chart will render on its first frame.
 */
export interface TransitionContext<T = YRange> {
  initial: T;
}

/**
 * Factory function returning a fresh {@link Transition}. Pass one as
 * `animations.y.transition` to plug a custom Y-bound smoothing strategy.
 * Built-in factories live in their own modules so unused curves tree-shake
 * out: `hermite` (default), `spring`, `snap` for Y; `xSpring` for X.
 */
export type TransitionFactory<T = YRange> = (ctx: TransitionContext<T>) => Transition<T>;

/** @internal — convenience re-export for factory implementations. */
export type { Milliseconds };
