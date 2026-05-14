import {
  type BuiltinEngineOptions,
  DEFAULT_BUILTIN_CONTRACT_MS,
  DEFAULT_BUILTIN_EXPAND_MS,
  type YEngineFactory,
} from './y-engine-types';
import { YRangeHermite } from './y-range-hermite';

/**
 * Build a velocity-matched cubic Hermite factory for the Y bounds.
 * Each retarget reaches the new target in exactly the configured
 * duration (with starting velocity carried over). Best for one-shot
 * moves where a known arrival time matters.
 *
 * Lives in its own module so the Hermite class isn't pulled into
 * bundles that only use the spring engine (or a custom one).
 */
export function hermiteAnimator(opts: BuiltinEngineOptions = {}): YEngineFactory {
  return ({ initial }) =>
    new YRangeHermite({
      initial,
      expandMs: opts.expandMs ?? DEFAULT_BUILTIN_EXPAND_MS,
      contractMs: opts.contractMs ?? DEFAULT_BUILTIN_CONTRACT_MS,
    });
}
