/**
 * Test-only handles for privileged internals of the core package.
 *
 * @internal — not re-exported from `src/index.ts`. Consumers installing
 * `@wick-charts/core` via the published barrel cannot reach these
 * references, so we can poke at viewport state in unit tests without
 * widening the public surface (which would otherwise lock the method
 * into the package's stability contract).
 */

import type { ChartInstance } from '../chart';
import type { Viewport } from '../viewport';

const viewports = new WeakMap<ChartInstance, Viewport>();

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
