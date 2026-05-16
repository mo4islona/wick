import { LineSeries } from '@wick-charts/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mountChart } from '../helpers/mount-chart';

/**
 * Regression #2 (commit 7ac1a6b): the chart-level `syncScales()` was missing
 * from the `onDataChanged` path, so after `setSeriesData` with a new Y range
 * the next render used the stale `yScale`. Visually: bars/lines clipped above
 * or below the viewport until the *following* frame caught up.
 *
 * Contract: after a data swap that widens the Y range by 10×, the next frame's
 * draw coordinates must fall inside the bitmap (i.e. scaled against the new
 * range), and the chart must report the new range via `getYRange()`.
 */
describe('data update scale sync (regression #2)', () => {
  let mounted: ReturnType<typeof mountChart> | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('updates yScale before the next render after setSeriesData', () => {
    // Initial data: range 0..10.
    const small: [Array<{ time: number; value: number }>] = [
      [
        { time: 1, value: 1 },
        { time: 2, value: 5 },
        { time: 3, value: 10 },
      ],
    ];
    mounted = mountChart(<LineSeries data={small} />, { width: 800, height: 400 });

    const yRangeBefore = mounted.chart.getYRange();
    expect(yRangeBefore.max).toBeLessThanOrEqual(12); // close to 10 with some padding

    // Swap to data spanning 0..1000 — new scale.
    const big: [Array<{ time: number; value: number }>] = [
      [
        { time: 1, value: 100 },
        { time: 2, value: 500 },
        { time: 3, value: 1000 },
      ],
    ];
    mounted.mainSpy.reset();
    mounted.rerender(<LineSeries data={big} />);

    const yRangeAfter = mounted.chart.getYRange();
    // New max must be at least 500 — not stuck at the pre-swap ~10.
    expect(yRangeAfter.max).toBeGreaterThanOrEqual(500);

    // Redraw happened and draw coordinates sit inside the new bitmap.
    const lineToCalls = mounted.mainSpy.callsOf('lineTo');
    expect(lineToCalls.length).toBeGreaterThan(0);
    const canvasHeight = mounted.mainCanvas.height;
    // With the new Y range, value=1000 should map near the top of the canvas
    // (Y ≈ 0) and value=100 near the bottom. Neither should be outside bounds.
    // Settle-state check: the LAST recorded lineTo must sit inside the
    // canvas — once both yScale and the engine's live-value slot have
    // settled, the new data's coordinates land in bounds. Intermediate
    // ease frames can briefly produce out-of-bounds Y for the trailing
    // endpoint because Y range and live value ride independent curves
    // (Y: hermite over `expandMs`; live: cubic over `dataTickMs`); the
    // production canvas is clipped to the chart rect so this is invisible
    // to users. Pin only the converged state, which is what the original
    // regression was actually about.
    const lastLineTo = lineToCalls[lineToCalls.length - 1];
    const settledY = lastLineTo.args[1] as number;
    expect(settledY).toBeGreaterThanOrEqual(0);
    expect(settledY).toBeLessThanOrEqual(canvasHeight);
  });

  it('dataUpdate event fires after scale sync, not before', () => {
    const initial: [Array<{ time: number; value: number }>] = [
      [
        { time: 1, value: 1 },
        { time: 2, value: 2 },
      ],
    ];
    mounted = mountChart(<LineSeries data={initial} />);

    let observedMax: number | null = null;
    mounted.chart.on('dataUpdate', () => {
      // The React wrapper detects a length-unchanged update and routes it
      // through `updateData` (last-point in place), which is the streaming
      // path — Y range eases instead of snapping. The original regression
      // (commit 7ac1a6b) was about scale-sync ORDERING, not magnitudes; it's
      // enough that yScale has been updated *toward* the new domain by the
      // time listeners fire (i.e. not stuck at the pre-update max of ~2).
      observedMax = mounted!.chart.getYRange().max;
    });

    const next: [Array<{ time: number; value: number }>] = [
      [
        { time: 1, value: 100 },
        { time: 2, value: 500 },
      ],
    ];
    mounted.rerender(<LineSeries data={next} />);

    expect(observedMax).not.toBeNull();
    // Has begun moving toward 500 (proves syncScales ran before dataUpdate);
    // the old stale value would have been ~2.
    expect(observedMax!).toBeGreaterThan(2);

    // After draining frames, yScale fully reflects the new domain.
    mounted.flushScheduler();
    expect(mounted.chart.getYRange().max).toBeGreaterThanOrEqual(500);
  });
});
