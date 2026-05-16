import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChartInstance } from '../chart';

/**
 * `ChartInstance.setPadding` refits the viewport only when horizontal padding
 * (left/right) actually changes. Vertical padding only affects the Y-scale
 * layout — touching it mustn't reset the user's zoom / pan / auto-scroll.
 * This regression suite pins that contract so wrappers can safely re-apply
 * padding from a Title / InfoBar ResizeObserver.
 */
describe('ChartInstance.setPadding — refit discipline', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container);
    chart = new ChartInstance(container, { interactive: false });
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1000, value: 10 },
      { time: 2000, value: 20 },
      { time: 3000, value: 30 },
    ]);
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('emits `viewportChange` when only vertical padding changes — yScale has shifted', () => {
    // Vertical padding changes the Y-range layout (padding.top/bottom extend
    // the mapped value range), so valueToY returns different pixels for the
    // same value. React consumers (YLabel, YAxis) need to pick that up —
    // without an emit they'd render against a stale scale. Horizontal
    // refits are still suppressed; only the notification fires.
    let fired = 0;
    chart.on('viewportChange', () => {
      fired++;
    });

    chart.setPadding({ top: 80 });
    expect(fired).toBe(1);

    chart.setPadding({ bottom: 60 });
    expect(fired).toBe(2);
  });

  it('does emit `viewportChange` when horizontal padding changes', () => {
    let fired = 0;
    chart.on('viewportChange', () => {
      fired++;
    });

    chart.setPadding({ right: { intervals: 10 } });
    expect(fired).toBeGreaterThan(0);
  });

  it('re-emits `viewportChange` after yRange refit when both horizontal and vertical change', () => {
    // `fitToData` (triggered by the horizontal change) emits via viewport
    // 'change' *before* `updateYRange(true)` runs, so subscribers that read
    // the yScale on that first emit see stale gutters. A second emit after
    // syncScales pushes the new yRange gives subscribers a chance to
    // reconcile. Without the re-emit they'd be stuck with a stale scale.
    let fired = 0;
    chart.on('viewportChange', () => {
      fired++;
    });

    chart.setPadding({ top: 80, right: { intervals: 10 } });
    // One emit from fitToData (horizontal refit) + one from the explicit
    // vertical-change emit after updateYRange.
    expect(fired).toBeGreaterThanOrEqual(2);
  });

  it('no-ops on identical padding — fitToData is not re-entered', () => {
    // Establish a baseline padding.
    chart.setPadding({ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } });
    let fired = 0;
    chart.on('viewportChange', () => {
      fired++;
    });

    // Identical payload — nothing should change, no refit.
    chart.setPadding({ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } });
    expect(fired).toBe(0);
  });
});
