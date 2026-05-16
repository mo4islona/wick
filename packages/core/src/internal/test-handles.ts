/**
 * Test-only handles for privileged internals of the core package.
 *
 * @internal — not re-exported from `src/index.ts`. Consumers installing
 * `@wick-charts/core` via the published barrel cannot reach these
 * references, so we can poke at viewport state in unit tests without
 * widening the public surface (which would otherwise lock the method
 * into the package's stability contract).
 */

import type { AnimationEngine } from '../animation/engine';
import type { ChartInstance } from '../chart';
import type { Viewport } from '../viewport';

const viewports = new WeakMap<ChartInstance, Viewport>();
const engines = new WeakMap<ChartInstance, AnimationEngine>();

/** Register a chart's viewport for later test access. Chart constructor only. */
export function registerChartViewport(chart: ChartInstance, viewport: Viewport): void {
  viewports.set(chart, viewport);
}

/** Retrieve the viewport a chart was constructed with. Test code only. */
export function getChartViewportForTest(chart: ChartInstance): Viewport {
  const v = viewports.get(chart);
  if (!v) throw new Error('getChartViewportForTest: chart has no registered viewport');

  return v;
}

/** Register a chart's animation engine for later test access. Chart constructor only. */
export function registerChartEngine(chart: ChartInstance, engine: AnimationEngine): void {
  engines.set(chart, engine);
}

/**
 * Retrieve the chart's `AnimationEngine` directly. Lets tests call
 * `engine.tick(t)` without driving the full render scheduler — needed when
 * the test wants to assert on engine state in isolation.
 */
export function getChartEngineForTest(chart: ChartInstance): AnimationEngine {
  const e = engines.get(chart);
  if (!e) throw new Error('getChartEngineForTest: chart has no registered engine');

  return e;
}
