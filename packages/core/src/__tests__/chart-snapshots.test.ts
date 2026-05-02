import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChartInstance } from '../chart';
import { buildHoverSnapshots, buildLastSnapshots } from '../snapshots';
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

describe('buildLastSnapshots', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('returns a snapshot per visible series at its last point', () => {
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    chart.setSeriesData(a, [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);
    chart.setSeriesData(b, [
      { time: 1, value: 100 },
      { time: 2, value: 50 },
    ]);

    const snaps = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(snaps).toHaveLength(2);
    expect(snaps.map((s) => s.id).sort()).toEqual([a, b].sort());
    const aSnap = snaps.find((s) => s.id === a)!;
    expect(aSnap.seriesId).toBe(a);
    expect(aSnap.layerIndex).toBeUndefined();
    expect((aSnap.data as { value: number }).value).toBe(20);
  });

  it('skips hidden series', () => {
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    chart.setSeriesData(a, [{ time: 1, value: 10 }]);
    chart.setSeriesData(b, [{ time: 1, value: 20 }]);
    chart.setSeriesVisible(b, false);

    const snaps = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(snaps.map((s) => s.id)).toEqual([a]);
  });

  it('expands multi-layer series into one snapshot per visible layer, each at its own time', () => {
    const id = chart.addLineSeries({ layers: 2 });
    chart.setSeriesData(id, [{ time: 1, value: 10 }], 0);
    chart.setSeriesData(
      id,
      [
        { time: 1, value: 20 },
        { time: 5, value: 30 },
      ],
      1,
    );

    const snaps = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({
      id: `${id}_layer0`,
      seriesId: id,
      layerIndex: 0,
    });
    expect(snaps[0].data as { time: number; value: number }).toMatchObject({ time: 1, value: 10 });
    expect(snaps[1]).toMatchObject({
      id: `${id}_layer1`,
      seriesId: id,
      layerIndex: 1,
    });
    expect(snaps[1].data as { time: number; value: number }).toMatchObject({ time: 5, value: 30 });
  });

  it('freezes the result so consumers cannot mutate it or the chart store', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 10 },
      { time: 2, value: 42 },
    ]);

    const snaps = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    const snap = snaps[0];
    expect(Object.isFrozen(snaps)).toBe(true);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.data)).toBe(true);

    const before = chart.getLastData(id);
    const originalValue = (before as { value: number }).value;
    expect(() => {
      // TypeScript rejects this; runtime with strict mode throws.
      (snap.data as unknown as { value: number }).value = 9999;
    }).toThrow();
    expect((chart.getLastData(id) as { value: number }).value).toBe(originalValue);
  });

  it('returns the same reference across calls when the chart state is unchanged', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [{ time: 1, value: 10 }]);

    const first = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    const second = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(second).toBe(first);
  });

  it('invalidates the cache on overlay mutations: setSeriesVisible, setTheme, updateSeriesOptions', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [{ time: 1, value: 10 }]);

    const before = buildLastSnapshots(chart, { cacheKey: 'infobar' });

    chart.setSeriesVisible(id, false);
    const afterHide = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(afterHide).not.toBe(before);

    chart.setSeriesVisible(id, true);
    const afterShow = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    chart.setTheme(githubLight.theme);
    const afterTheme = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(afterTheme).not.toBe(afterShow);

    chart.updateSeriesOptions(id, { label: 'renamed' });
    const afterOpts = buildLastSnapshots(chart, { cacheKey: 'infobar' });
    expect(afterOpts).not.toBe(afterTheme);
  });

  it('uses independent cache slots per cacheKey', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [{ time: 1, value: 10 }]);

    const a = buildLastSnapshots(chart, { cacheKey: 'a', sort: 'asc' });
    const b = buildLastSnapshots(chart, { cacheKey: 'b', sort: 'desc' });
    // Different bucket, not coerced to the same reference.
    expect(a).not.toBe(b);
  });

  it('respects sort order', () => {
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    chart.setSeriesData(a, [{ time: 1, value: 50 }]);
    chart.setSeriesData(b, [{ time: 1, value: 10 }]);

    const asc = buildLastSnapshots(chart, { cacheKey: 'asc', sort: 'asc' });
    expect((asc[0].data as { value: number }).value).toBe(10);
    expect((asc[1].data as { value: number }).value).toBe(50);

    const desc = buildLastSnapshots(chart, { cacheKey: 'desc', sort: 'desc' });
    expect((desc[0].data as { value: number }).value).toBe(50);
    expect((desc[1].data as { value: number }).value).toBe(10);
  });
});

describe('buildHoverSnapshots', () => {
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('returns a snapshot per visible series at the queried time', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
      { time: 3, value: 30 },
    ]);
    const snaps = buildHoverSnapshots(chart, { time: 2, cacheKey: 'tooltip' });
    expect(snaps).toHaveLength(1);
    expect((snaps[0].data as { value: number }).value).toBe(20);
  });

  it('caches by (time, sort, overlayVersion) and returns the same reference for repeat calls', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);
    const a = buildHoverSnapshots(chart, { time: 2, cacheKey: 'tooltip' });
    const b = buildHoverSnapshots(chart, { time: 2, cacheKey: 'tooltip' });
    expect(b).toBe(a);
  });

  it('recomputes when the queried time changes', () => {
    const id = chart.addLineSeries();
    chart.setSeriesData(id, [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);
    const a = buildHoverSnapshots(chart, { time: 1, cacheKey: 'tooltip' });
    const b = buildHoverSnapshots(chart, { time: 2, cacheKey: 'tooltip' });
    expect(b).not.toBe(a);
  });

  it('filters hidden series from the result', () => {
    const a = chart.addLineSeries();
    const b = chart.addLineSeries();
    chart.setSeriesData(a, [{ time: 1, value: 10 }]);
    chart.setSeriesData(b, [{ time: 1, value: 20 }]);
    chart.setSeriesVisible(b, false);

    const snaps = buildHoverSnapshots(chart, { time: 1, cacheKey: 'tooltip' });
    expect(snaps.map((s) => s.seriesId)).toEqual([a]);
  });

  it('preserves real layerIndex even when earlier layers are hidden', () => {
    // Previously `layerIndex` was the filtered array position: hiding
    // layer 0 would report layer 1 as `layerIndex: 0`, breaking row keys
    // and any slot code grouping by layer.
    const id = chart.addLineSeries({ layers: 3 });
    chart.setSeriesData(id, [{ time: 10, value: 1 }], 0);
    chart.setSeriesData(id, [{ time: 10, value: 2 }], 1);
    chart.setSeriesData(id, [{ time: 10, value: 3 }], 2);
    chart.setLayerVisible(id, 0, false);

    const snaps = buildHoverSnapshots(chart, { time: 10, cacheKey: 'tooltip' });
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({ id: `${id}_layer1`, layerIndex: 1 });
    expect(snaps[1]).toMatchObject({ id: `${id}_layer2`, layerIndex: 2 });
  });

  it('uses resolved sample time for each layer, not the query time', () => {
    const id = chart.addLineSeries({ layers: 2 });
    chart.setSeriesData(
      id,
      [
        { time: 100, value: 1 },
        { time: 200, value: 2 },
      ],
      0,
    );
    chart.setSeriesData(
      id,
      [
        { time: 100, value: 10 },
        { time: 200, value: 20 },
      ],
      1,
    );

    const snaps = buildHoverSnapshots(chart, { time: 150, cacheKey: 'tooltip' });
    // Later point wins at a midpoint tie → t=200.
    expect((snaps[0].data as { time: number }).time).toBe(200);
    expect((snaps[1].data as { time: number }).time).toBe(200);
  });

  it('skips multi-layer series when every layer is hidden (no phantom fallback)', () => {
    // Previously: getLayerSnapshots → null when every layer is hidden,
    // helper fell through to getDataAtTime (which returns layer 0's data),
    // producing a snapshot for a series the chart isn't drawing.
    const multi = chart.addLineSeries({ layers: 2 });
    chart.setSeriesData(multi, [{ time: 1, value: 10 }], 0);
    chart.setSeriesData(multi, [{ time: 1, value: 20 }], 1);
    chart.setLayerVisible(multi, 0, false);
    chart.setLayerVisible(multi, 1, false);

    const hover = buildHoverSnapshots(chart, { time: 1, cacheKey: 'tooltip' });
    expect(hover.find((s) => s.seriesId === multi)).toBeUndefined();
  });
});
