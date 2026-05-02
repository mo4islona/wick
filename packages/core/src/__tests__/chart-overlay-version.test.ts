import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance } from '../chart';
import { githubLight } from '../theme/themes/github-light';

function makeChart(): { chart: ChartInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const width = 800;
  const height = 400;
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, width, height, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);

  return { chart: new ChartInstance(container, { interactive: false }), container };
}

describe('ChartInstance overlayVersion + overlayChange', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('starts at 0 on a fresh chart', () => {
    expect(chart.getOverlayVersion()).toBe(0);
  });

  it('bumps and emits overlayChange when a series is added or removed', () => {
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    const before = chart.getOverlayVersion();
    const id = chart.addLineSeries();
    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    const mid = chart.getOverlayVersion();
    chart.removeSeries(id);
    expect(chart.getOverlayVersion()).toBeGreaterThan(mid);
    expect(listener).toHaveBeenCalled();
  });

  it('bumps on dataUpdate', () => {
    const id = chart.addLineSeries();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    const before = chart.getOverlayVersion();
    chart.setSeriesData(id, [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);

    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
  });

  it('bumps on setSeriesVisible', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [{ time: 1, value: 10 }]);
    const before = chart.getOverlayVersion();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    chart.setSeriesVisible(id, false);
    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
  });

  it('bumps on setLayerVisible for multi-layer series', () => {
    const id = chart.addLineSeries({ layers: 2 });
    chart.setSeriesData(id, [{ time: 1, value: 10 }], 0);
    chart.setSeriesData(id, [{ time: 1, value: 20 }], 1);
    const before = chart.getOverlayVersion();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    chart.setLayerVisible(id, 1, false);
    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
  });

  it('bumps on updateSeriesOptions', () => {
    const id = chart.addLineSeries();
    const before = chart.getOverlayVersion();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    chart.updateSeriesOptions(id, { label: 'renamed' });
    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
  });

  it('bumps on setTheme', () => {
    chart.addLineSeries();
    const before = chart.getOverlayVersion();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    chart.setTheme(githubLight.theme);
    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
  });

  it('does not bump on no-op setSeriesVisible', () => {
    const id = chart.addLineSeries();
    chart.setSeriesVisible(id, true);
    const stable = chart.getOverlayVersion();
    chart.setSeriesVisible(id, true);
    expect(chart.getOverlayVersion()).toBe(stable);
  });

  it('does not bump on updateSeriesOptions when overlay-relevant fields are unchanged', () => {
    // Vue deep watchers replay `updateSeriesOptions` with fresh but equal
    // objects every render. Those must not thrash the snapshot cache.
    const id = chart.addLineSeries({ label: 'same', colors: ['#112233'] });
    const stable = chart.getOverlayVersion();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    chart.updateSeriesOptions(id, { label: 'same', colors: ['#112233'] });

    expect(chart.getOverlayVersion()).toBe(stable);
    expect(listener).not.toHaveBeenCalled();
  });

  it('bumps on updateSeriesOptions only when label or layer colors actually change', () => {
    const id = chart.addLineSeries({ label: 'first', colors: ['#112233'] });
    const afterAdd = chart.getOverlayVersion();

    chart.updateSeriesOptions(id, { label: 'second' });
    const afterLabel = chart.getOverlayVersion();
    expect(afterLabel).toBeGreaterThan(afterAdd);

    chart.updateSeriesOptions(id, { colors: ['#445566'] });
    const afterColors = chart.getOverlayVersion();
    expect(afterColors).toBeGreaterThan(afterLabel);

    // A non-overlay-relevant option (e.g. strokeWidth) by itself is not
    // required to bump — guard against false positives.
    chart.updateSeriesOptions(id, { strokeWidth: 3 });
    expect(chart.getOverlayVersion()).toBe(afterColors);
  });

  it('coalesces overlayChange into a single emission across a batch', () => {
    // Legend's isolate batches many setSeriesVisible / setLayerVisible
    // calls. Emitting N overlayChange events during the batch caused N
    // overlay renders instead of one.
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    const c = chart.addLineSeries();
    chart.setSeriesData(a, [{ time: 1, value: 1 }]);
    chart.setSeriesData(b, [{ time: 1, value: 2 }]);
    chart.setSeriesData(c, [{ time: 1, value: 3 }]);
    const before = chart.getOverlayVersion();
    const listener = vi.fn();
    chart.on('overlayChange', listener);

    chart.batch(() => {
      chart.setSeriesVisible(a, false);
      chart.setSeriesVisible(b, false);
      chart.setSeriesVisible(c, false);
    });

    // Version still bumped (cache must invalidate at least once).
    expect(chart.getOverlayVersion()).toBeGreaterThan(before);
    // But only one overlayChange event escaped the batch.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not emit overlayChange when a batch made no overlay-affecting changes', () => {
    const id = chart.addLineSeries();
    const listener = vi.fn();
    chart.on('overlayChange', listener);
    listener.mockClear();

    chart.batch(() => {
      // No-op: toggling to the already-true value is a no-op.
      chart.setSeriesVisible(id, true);
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
