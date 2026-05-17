/**
 * Test-only Viewport builder. Provides the data-anchor wiring (`getDataAnchors`
 * callback + mutable refs) and a `fit(first, last, opts)` shortcut that
 * routes through the pure `computeFitToData` function — covers the test
 * setup pattern that used to call `Viewport.fitToData` / `setDataStart` /
 * `setDataEnd` directly.
 */
import { computeFitToData } from '../../chart/fit-to-data';
import { Viewport, type ViewportOptions } from '../../viewport';

const DEFAULT_INTERVAL = 60_000;

export interface TestViewportHandle {
  viewport: Viewport;
  /** Mutate the dataStart / dataEnd anchors the viewport reads via callback. */
  setData(start: number | null, end: number | null): void;
  /** Compute a fit-to-data range and apply via `viewport.setRange`. */
  fit(firstTime: number, lastTime: number, opts?: { chartWidth?: number }): void;
}

export function makeTestViewport(
  opts: {
    padding?: ViewportOptions['padding'];
    dataInterval?: number;
    dataStart?: number | null;
    dataEnd?: number | null;
    maxVisibleBars?: number;
  } = {},
): TestViewportHandle {
  const anchors = {
    dataStart: opts.dataStart ?? null,
    dataEnd: opts.dataEnd ?? null,
  };
  const dataInterval = opts.dataInterval ?? DEFAULT_INTERVAL;
  const maxVisibleBars = opts.maxVisibleBars ?? 200;

  const viewport = new Viewport({
    padding: opts.padding,
    getDataAnchors: () => anchors,
  });
  viewport.setDataInterval(dataInterval);

  return {
    viewport,
    setData(start, end) {
      anchors.dataStart = start;
      anchors.dataEnd = end;
    },
    fit(firstTime, lastTime, fitOpts = {}) {
      const padding = viewport.getPadding();
      const range = computeFitToData({
        firstTime,
        lastTime,
        dataInterval,
        maxVisibleBars,
        chartWidth: fitOpts.chartWidth ?? 0,
        padding: { left: padding.left, right: padding.right },
      });
      viewport.setRange(range);
    },
  };
}
