import type { Milliseconds } from './time';

/**
 * Per-call settle times supplied by the engine to {@link Transition.retarget}.
 * The engine owns all durations and pushes them per call; the curves carry
 * no baseline of their own.
 *
 * X transitions use only `expandMs` (single direction). Y transitions use
 * both `expandMs` (outward — new extreme enters window) and `contractMs`
 * (inward — extreme leaves; the sticky-Y mechanism).
 */
export interface RetargetOptions {
  /** Optional wall clock. Defaults to `performance.now()`. */
  now?: number;
  /**
   * Settle time (ms) for *outward* motion — bound reaching a new extreme.
   * Also used by X (single-direction) as the spring's settle time.
   */
  expandMs?: number;
  /**
   * Settle time (ms) for *inward* motion — bound contracting after an
   * extreme leaves the window. Y-only; X transitions ignore this field.
   */
  contractMs?: number;
}

/**
 * Smoothing-curve contract. Implementations (`YRangeHermite`, `YRangeSpring`,
 * `RangeSnap` for Y; `VisibleRangeSpring`, `RangeSnap` for X) drive a value
 * of type `T` from one snapshot to the next while maintaining `current` /
 * `target` / velocity continuity.
 *
 * Parametric over `T` so X and Y share the same interface — Y uses
 * `Transition<YRange>` (default), X uses `Transition<VisibleRange>`.
 *
 * This is the single public customization point for the chart's curves.
 * Other animation math (entry tweens, pulse, axis tick fade) stays
 * engine-fixed.
 */
export interface Transition<T> {
  /** Current sampled position. Read by renderers on every frame. */
  readonly current: T;
  /** Active retarget destination. May equal `current` after settle. */
  readonly target: T;
  /** True while position has not yet converged to `target`. */
  readonly animating: boolean;

  /**
   * Begin a new transition toward `value`. Existing velocity is carried
   * over (no reset twitch). The engine supplies the active settle times
   * via `opts.expandMs` (and `opts.contractMs` for Y).
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
export interface TransitionContext<T> {
  initial: T;
}

/**
 * Factory function returning a fresh {@link Transition}. Pass one as
 * `animations.axis.y.curve` (or `animations.axis.x.curve`) to plug a custom
 * smoothing strategy. Built-in factories: {@link hermite} (Y default),
 * {@link spring} (X default, also valid for Y), {@link snap} (no animation).
 */
export type TransitionFactory<T> = (ctx: TransitionContext<T>) => Transition<T>;

/** @internal — convenience re-export for factory implementations. */
export type { Milliseconds };
