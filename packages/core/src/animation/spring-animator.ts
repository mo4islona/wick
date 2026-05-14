import {
  type BuiltinEngineOptions,
  DEFAULT_BUILTIN_CONTRACT_MS,
  DEFAULT_BUILTIN_EXPAND_MS,
  type YEngineFactory,
} from './y-engine-types';
import { YRangeSpring } from './y-range-spring';

/**
 * Build a critically-damped spring factory for the Y bounds.
 * Velocity-handoff on every retarget, asymptotic approach to target.
 * Best for streaming / continuously-retargeted Y.
 *
 * Lives in its own module so the spring class isn't pulled into bundles
 * that only use the cubic Hermite engine (or a custom one).
 */
export function springAnimator(opts: BuiltinEngineOptions = {}): YEngineFactory {
  return ({ initial }) =>
    new YRangeSpring({
      initial,
      expandMs: opts.expandMs ?? DEFAULT_BUILTIN_EXPAND_MS,
      contractMs: opts.contractMs ?? DEFAULT_BUILTIN_CONTRACT_MS,
    });
}
