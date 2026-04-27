import { CandlestickSeries } from '@wick-charts/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mountChart } from '../helpers/mount-chart';

/**
 * Integration test for mouse drag → pan → redraw. Unit coverage for
 * `PanHandler` lives in `packages/core/src/__tests__/pan-handler.test.ts`;
 * here we confirm the full React → core wiring works: a mousedown/move/up
 * sequence on the overlay canvas shifts the visible range and redraws.
 */
describe('mouse drag pan end-to-end', () => {
  let mounted: ReturnType<typeof mountChart> | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  const data = Array.from({ length: 30 }, (_, i) => ({
    time: 1_000_000 + i * 60_000,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 102 + i,
  }));

  it('mousedown → mousemove(+200px) shifts the visible range left during the drag', () => {
    mounted = mountChart(<CandlestickSeries data={data} />, { width: 800, height: 400 });
    const before = mounted.chart.getVisibleRange();

    // Dragging the content to the right pulls older (earlier) timestamps into
    // view → `from` decreases. The handler sign-inverts the pixel delta before
    // calling `viewport.pan`, so positive mousemove → negative time delta.
    //
    // Assert mid-drag (before mouseup) so post-mouseup rebound — which animates
    // the viewport back into soft bounds when the drag overshot the data edge —
    // doesn't restore the original range before we sample it.
    mounted.dispatchMouse('mousedown', { button: 0, clientX: 400, clientY: 200 }, mounted.overlayCanvas);
    mounted.dispatchMouse('mousemove', { clientX: 600, clientY: 200 }, mounted.overlayCanvas);
    mounted.flushScheduler();

    const after = mounted.chart.getVisibleRange();
    expect(after.from).toBeLessThan(before.from);
    expect(after.to).toBeLessThan(before.to);
    // Width preserved — pan translates, doesn't scale.
    expect(after.to - after.from).toBeCloseTo(before.to - before.from, -2);

    // Cleanup: release the mouse so the test exits a consistent state.
    mounted.dispatchMouse('mouseup', { clientX: 600, clientY: 200 }, mounted.overlayCanvas);
  });

  it('mousedown → mousemove(-200px) shifts the visible range right during the drag', () => {
    mounted = mountChart(<CandlestickSeries data={data} />, { width: 800, height: 400 });
    // After fitToData the right edge sits at `dataEnd + rightPadding`, which is
    // also the pan clamp — so without zooming in first, a right-pan is a no-op.
    // Wheel to zoom in so the visible range moves away from the clamp.
    mounted.dispatchWheel({ deltaY: -200, clientX: 400, clientY: 200 }, mounted.overlayCanvas);
    mounted.flushScheduler();
    const before = mounted.chart.getVisibleRange();

    mounted.dispatchMouse('mousedown', { button: 0, clientX: 400, clientY: 200 }, mounted.overlayCanvas);
    mounted.dispatchMouse('mousemove', { clientX: 200, clientY: 200 }, mounted.overlayCanvas);
    mounted.flushScheduler();

    const after = mounted.chart.getVisibleRange();
    expect(after.from).toBeGreaterThan(before.from);
    expect(after.to).toBeGreaterThan(before.to);

    mounted.dispatchMouse('mouseup', { clientX: 200, clientY: 200 }, mounted.overlayCanvas);
  });

  it('drag triggers a redraw on the main canvas', () => {
    mounted = mountChart(<CandlestickSeries data={data} />, { width: 800, height: 400 });
    mounted.mainSpy.reset();

    mounted.dispatchMouse('mousedown', { button: 0, clientX: 400, clientY: 200 }, mounted.overlayCanvas);
    mounted.dispatchMouse('mousemove', { clientX: 600, clientY: 200 }, mounted.overlayCanvas);
    mounted.dispatchMouse('mouseup', { clientX: 600, clientY: 200 }, mounted.overlayCanvas);
    mounted.flushScheduler();

    expect(mounted.mainSpy.countOf('fillRect')).toBeGreaterThan(0);
  });
});
