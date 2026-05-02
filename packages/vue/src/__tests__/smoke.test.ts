import { mount } from '@vue/test-utils';
import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  LineSeries,
  PieSeries,
  catppuccin,
} from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Vue wrapper smoke tests — verify the components mount, the underlying
 * ChartInstance is created, and canvas draw calls land through the recording
 * context installed by the root test-setup.
 *
 * Tests cover two usage shapes:
 *   - Static data passed at mount time (the common public API).
 *   - Reactive data that mutates after mount (ref-driven updates).
 */

const candlestickData = [
  { time: 1, open: 1, high: 2, low: 1, close: 2 },
  { time: 2, open: 2, high: 3, low: 2, close: 3 },
  { time: 3, open: 3, high: 4, low: 3, close: 4 },
];

const lineData = [[
  { time: 1, value: 10 },
  { time: 2, value: 20 },
  { time: 3, value: 30 },
]];

const pieData = [
  { label: 'A', value: 30 },
  { label: 'B', value: 70 },
];

/**
 * Parent onMounted → chart.value set → re-render queued → slot renders
 * children → children's onMounted registers series → data watcher fires
 * after the next prop tick → scheduler RAF draws. Alternating `nextTick()`
 * and `flushAllRaf()` drains both pipelines until stable.
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

describe('Vue wrapper smoke', () => {
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

  it('mounts CandlestickSeries with initial data and draws fillRects immediately', async () => {
    const App = defineComponent({
      components: { ChartContainer, CandlestickSeries },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(CandlestickSeries, { data: candlestickData }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const canvases = host.querySelectorAll('canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(2);
    const main = canvases[0] as HTMLCanvasElement;
    main.getContext('2d');
    expect(main.__spy).toBeDefined();
    expect(main.__spy!.countOf('fillRect')).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('mounts LineSeries with initial data and draws lineTo primitives', async () => {
    const App = defineComponent({
      components: { ChartContainer, LineSeries },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [h(LineSeries, { data: lineData })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const main = host.querySelectorAll('canvas')[0] as HTMLCanvasElement;
    main.getContext('2d');
    expect(main.__spy!.countOf('lineTo')).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('mounts BarSeries (multi-layer) and draws bars per layer', async () => {
    const twoLayers = [
      [{ time: 1, value: 10 }, { time: 2, value: 20 }],
      [{ time: 1, value: 5 }, { time: 2, value: 15 }],
    ];
    const App = defineComponent({
      components: { ChartContainer, BarSeries },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [h(BarSeries, { data: twoLayers })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const main = host.querySelectorAll('canvas')[0] as HTMLCanvasElement;
    main.getContext('2d');
    expect(main.__spy!.countOf('fillRect')).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it('mounts PieSeries with initial data and draws arc primitives per slice', async () => {
    const App = defineComponent({
      components: { ChartContainer, PieSeries },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [h(PieSeries, { data: pieData })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const main = host.querySelectorAll('canvas')[0] as HTMLCanvasElement;
    main.getContext('2d');
    expect(main.__spy!.countOf('arc')).toBeGreaterThanOrEqual(pieData.length);
    wrapper.unmount();
  });

  it('reactive data updates produce additional draws', async () => {
    const data = ref(lineData);
    const App = defineComponent({
      components: { ChartContainer, LineSeries },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [h(LineSeries, { data: data.value })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    const main = host.querySelectorAll('canvas')[0] as HTMLCanvasElement;
    main.getContext('2d');
    const before = main.__spy!.countOf('lineTo');

    data.value = [[
      { time: 1, value: 100 },
      { time: 2, value: 200 },
      { time: 3, value: 300 },
      { time: 4, value: 400 },
    ]];
    await settle();

    // Swap produces additional draws on top of the initial mount draw.
    expect(main.__spy!.countOf('lineTo')).toBeGreaterThan(before);
    wrapper.unmount();
  });

  it('unmount removes both canvases from the DOM', async () => {
    const data = ref(candlestickData);
    const App = defineComponent({
      components: { ChartContainer, CandlestickSeries },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(CandlestickSeries, { data: data.value }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    expect(host.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
    expect(host.querySelectorAll('canvas').length).toBe(0);
  });
});
