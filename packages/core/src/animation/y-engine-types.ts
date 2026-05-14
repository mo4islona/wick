import type { YRange } from '../types';

/**
 * Per-call options for {@link YRangeAnimatorLike.setTarget}. The optional
 * `expandMs` / `contractMs` overrides let the host temporarily pick a
 * different speed for this single retarget — used during user gestures
 * (pan/zoom) so a contract during interaction doesn't ride the long
 * sticky-Y settle time.
 */
export interface SetTargetOptions {
  now?: number;
  /** One-shot expand-direction settle time (ms). Overrides the engine's
   *  internal default for this `setTarget` call only. */
  expandMs?: number;
  /** One-shot contract-direction settle time (ms). Overrides the engine's
   *  internal default for this `setTarget` call only. */
  contractMs?: number;
}

/**
 * Shared shape for the chart's Y-bound animators. Built-in engines
 * ({@link YRangeSpring} and {@link YRangeHermite}) implement this;
 * user-supplied animators must too.
 */
export interface YRangeAnimatorLike {
  readonly current: YRange;
  readonly target: YRange;
  readonly animating: boolean;
  setTarget(value: YRange, opts?: SetTargetOptions): void;
  snap(value: YRange, opts?: { now?: number }): void;
  tick(now: number): boolean;
}

/** Context handed to a {@link YEngineFactory} at chart construction time. */
export interface YEngineContext {
  initial: YRange;
}

/**
 * Factory function that produces an animator implementing
 * {@link YRangeAnimatorLike}. Pass one to
 * `animations.viewport.yEngine` to plug in a custom Y-bound smoothing
 * strategy. Built-in factories live in their own modules so unused
 * engines tree-shake out: `@wick-charts/core` → `hermiteAnimator`,
 * `springAnimator`.
 */
export type YEngineFactory = (ctx: YEngineContext) => YRangeAnimatorLike;

export interface BuiltinEngineOptions {
  /**
   * Settle time (ms) when a bound moves *outward* — toward a new extreme
   * entering the visible window. Default `250`.
   */
  expandMs?: number;
  /**
   * Settle time (ms) when a bound moves *inward* — contracting after an
   * extreme leaves the visible window. Larger values produce a sticky-Y
   * feel: the chart reacts quickly to new highs/lows but holds the wider
   * bound after the outlier scrolls off. Default `2500`.
   */
  contractMs?: number;
}

/** Defaults built into the spring / Hermite factories when caller omits them. */
export const DEFAULT_BUILTIN_EXPAND_MS = 250;
export const DEFAULT_BUILTIN_CONTRACT_MS = 2_500;
