/**
 * Edge-indicator rendering. Pulled out of ChartInstance because both
 * functions are pure reads — they hand off to {@link renderEdgeIndicator}
 * and only need the current per-side state + cached overshoot boundary
 * to anchor the indicator.
 */

import type { CanvasManager } from '../canvas-manager';
import { type EdgeSide, type EdgeState, renderEdgeIndicator } from '../components/edge-indicator';
import type { TimeScale } from '../scales/time-scale';
import type { ChartTheme } from '../theme/types';

export interface EdgeIndicatorContext {
  scope: Parameters<Parameters<CanvasManager['useOverlayLayer']>[0]>[0];
  chartMediaHeight: number;
  timeScale: TimeScale;
  theme: ChartTheme;
  edgeStates: Record<EdgeSide, EdgeState>;
  /**
   * Resolve a side's anchor time. Returns `null` when neither a cached
   * overshoot nor a current data edge is available.
   */
  resolveBoundary(side: EdgeSide): number | null;
}

export function drawEdgeIndicators(ctx: EdgeIndicatorContext): void {
  const now = performance.now();
  for (const side of ['left', 'right'] as const) {
    const state = ctx.edgeStates[side];
    if (state === 'idle' || state === 'has-more') continue;

    const boundaryTime = ctx.resolveBoundary(side);
    if (boundaryTime === null) continue;

    renderEdgeIndicator({
      scope: ctx.scope,
      timeScale: ctx.timeScale,
      theme: ctx.theme,
      chartMediaHeight: ctx.chartMediaHeight,
      boundaryTime,
      side,
      state,
      now,
    });
  }
}

/**
 * Pick the boundary time to anchor an edge indicator. Prefer the cached
 * value emitted by the most recent `edgeReached` — that's the *exact* point
 * the user overshot. Fall back to the current data edge when no gesture has
 * fired yet (host may invoke `setEdgeState` directly on mount to show a
 * "no-data" marker from the start).
 */
export function resolveEdgeBoundary(
  side: EdgeSide,
  cached: number | null,
  dataBounds: { first: number | undefined; last: number | undefined },
): number | null {
  if (cached !== null) return cached;

  return side === 'left' ? (dataBounds.first ?? null) : (dataBounds.last ?? null);
}
