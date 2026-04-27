import { mount } from '@vue/test-utils';
import type { ChartInstance, OHLCInput, PieSliceData, TimePoint } from '@wick-charts/core';
import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  PieSeries,
  darkTheme,
  useChartInstance,
} from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Ref, defineComponent, h, nextTick, ref } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Watcher coverage for the three series SFCs. Smoke tests verify mount-time
 * draws; this suite exercises the *update* paths — bulk replace vs. append
 * thresholds (CandlestickSeries), per-layer batch (BarSeries), data-only
 * vs. options-only watchers (all three).
 */

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await nextTick();
    flushAllRaf();
  }
}

function sizeDescendants(host: HTMLElement, width = 800, height = 400): () => void {
  Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(host, 'clientHeight', { value: height, configurable: true });
  host.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, width, height, toJSON: () => ({}) }) as DOMRect;
  const origRect = HTMLDivElement.prototype.getBoundingClientRect;
  HTMLDivElement.prototype.getBoundingClientRect = function patched() {
    const r = origRect.call(this);
    if (r.width > 0 && r.height > 0) return r;
    if (this === host || host.contains(this)) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: height,
        right: width,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return r;
  };

  return () => {
    HTMLDivElement.prototype.getBoundingClientRect = origRect;
  };
}

interface ChartProbe {
  chart: ChartInstance;
}

function probeFor(captured: { value: ChartProbe | null }) {
  return defineComponent({
    setup() {
      captured.value = { chart: useChartInstance() };

      return () => null;
    },
  });
}

describe('Vue series watchers', () => {
  let host: HTMLElement;
  let restore: () => void;

  beforeEach(() => {
    installRaf();
    host = document.createElement('div');
    document.body.appendChild(host);
    restore = sizeDescendants(host);
  });

  afterEach(() => {
    restore();
    host.remove();
    uninstallRaf();
  });

  it('CandlestickSeries: empty data initial mount + later population fires the watcher', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const data: Ref<OHLCInput[]> = ref([]);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');
    expect(probeRef.value.chart.getLastValue('cs')).toBeNull();

    data.value = [
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 13, low: 10, close: 12 },
    ];
    await settle();

    const last = probeRef.value.chart.getLastValue('cs');
    expect(last?.value).toBe(12);

    wrapper.unmount();
  });

  it('CandlestickSeries: appending one bar takes the appendData branch (length grows by 1)', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const initial: OHLCInput[] = Array.from({ length: 6 }, (_, i) => ({
      time: i + 1,
      open: 100,
      high: 105,
      low: 95,
      close: 100 + i,
    }));
    const data: Ref<OHLCInput[]> = ref(initial);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    data.value = [...initial, { time: 7, open: 100, high: 110, low: 100, close: 109 }];
    await settle();

    expect(probeRef.value.chart.getLastValue('cs')?.value).toBe(109);

    wrapper.unmount();
  });

  it('CandlestickSeries: same-length swap takes the updateData branch (last point only)', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const seed: OHLCInput[] = [
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 13, low: 10, close: 12 },
      { time: 3, open: 12, high: 14, low: 11, close: 13 },
    ];
    const data: Ref<OHLCInput[]> = ref(seed);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    data.value = [seed[0], seed[1], { time: 3, open: 12, high: 20, low: 11, close: 19 }];
    await settle();

    expect(probeRef.value.chart.getLastValue('cs')?.value).toBe(19);

    wrapper.unmount();
  });

  it('CandlestickSeries: clearing data takes the empty-data branch', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const data: Ref<OHLCInput[]> = ref<OHLCInput[]>([
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 13, low: 10, close: 12 },
    ]);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    data.value = [];
    await settle();

    expect(probeRef.value.chart.getLastValue('cs')).toBeNull();

    wrapper.unmount();
  });

  it('CandlestickSeries: a long jump takes the bulk-replace branch (len grows by >5)', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const seed: OHLCInput[] = Array.from({ length: 3 }, (_, i) => ({
      time: i + 1,
      open: 10,
      high: 12,
      low: 9,
      close: 11 + i,
    }));
    const data: Ref<OHLCInput[]> = ref(seed);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    data.value = Array.from({ length: 20 }, (_, i) => ({
      time: i + 1,
      open: 100,
      high: 110,
      low: 90,
      close: 100 + i,
    }));
    await settle();

    expect(probeRef.value.chart.getLastValue('cs')?.value).toBe(119);

    wrapper.unmount();
  });

  it('CandlestickSeries: options watcher forwards to chart.updateSeriesOptions on change', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const seed: OHLCInput[] = [
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 13, low: 10, close: 12 },
    ];
    const opts = ref<{ wickWidth?: number }>({ wickWidth: 1 });

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs', data: seed, options: opts.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    // Mutate options — the deep watcher must fire even though `data` is
    // unchanged. We assert no throws + the chart still has the series.
    opts.value = { wickWidth: 3 };
    await settle();

    expect(probeRef.value.chart.getSeriesIds()).toContain('cs');

    wrapper.unmount();
  });

  it('BarSeries: multi-layer data swap rebuilds each layer through chart.batch', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const layerA: TimePoint[] = [
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ];
    const layerB: TimePoint[] = [
      { time: 1, value: 5 },
      { time: 2, value: 15 },
    ];
    const data: Ref<TimePoint[][]> = ref([layerA, layerB]);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(BarSeries, { id: 'bar', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    // Swap each layer to fresh values — exercises the per-layer setSeriesData
    // loop inside the watcher.
    data.value = [
      [
        { time: 1, value: 100 },
        { time: 2, value: 200 },
      ],
      [
        { time: 1, value: 50 },
        { time: 2, value: 150 },
      ],
    ];
    await settle();

    expect(probeRef.value.chart.getSeriesIds()).toContain('bar');

    wrapper.unmount();
  });

  it('PieSeries: data swap forwards to chart.setSeriesData on the lazy watcher', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const data: Ref<PieSliceData[]> = ref<PieSliceData[]>([
      { label: 'A', value: 30 },
      { label: 'B', value: 70 },
    ]);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(PieSeries, { id: 'pie', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    data.value = [
      { label: 'X', value: 25 },
      { label: 'Y', value: 25 },
      { label: 'Z', value: 50 },
    ];
    await settle();

    expect(probeRef.value.chart.getSeriesIds()).toContain('pie');

    wrapper.unmount();
  });

  it('PieSeries: empty-data swap is a no-op (the watcher guards on length > 0)', async () => {
    const probeRef: { value: ChartProbe | null } = { value: null };
    const Probe = probeFor(probeRef);
    const data: Ref<PieSliceData[]> = ref<PieSliceData[]>([
      { label: 'A', value: 30 },
      { label: 'B', value: 70 },
    ]);

    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(PieSeries, { id: 'pie', data: data.value }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!probeRef.value) throw new Error('probe did not run');

    data.value = [];
    await settle();

    expect(probeRef.value.chart.getSeriesIds()).toContain('pie');

    wrapper.unmount();
  });
});
