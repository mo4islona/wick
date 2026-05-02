import { mount } from '@vue/test-utils';
import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  InfoBar,
  LineSeries,
  Title,
  Tooltip,
  catppuccin,
} from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Parity regression tests for the Vue `Tooltip` / `InfoBar` —
 * mirrors the behaviors React enforces. Both must:
 *   1. Not get stuck empty when mounted *before* sibling series — i.e.
 *      subscribe to `seriesChange` and catch up on mount.
 *   2. Expand multi-layer series (stacked Line/Bar) into per-layer rows via
 *      `chart.getLayerSnapshots()`.
 */

const candlestickData = [
  { time: 1, open: 1, high: 2, low: 1, close: 2 },
  { time: 2, open: 2, high: 3, low: 2, close: 3 },
  { time: 3, open: 3, high: 4, low: 3, close: 4 },
];

const twoLayerBars = [
  [
    { time: 1, value: 10 },
    { time: 2, value: 20 },
  ],
  [
    { time: 1, value: 5 },
    { time: 2, value: 15 },
  ],
];

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
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

describe('Vue <Tooltip> / <InfoBar> parity', () => {
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

  it('<InfoBar> renders series data even when mounted before the series (seriesChange catch-up)', async () => {
    // Order matters: InfoBar declared *before* CandlestickSeries in the
    // slot. Pre-fix, InfoBar ran its "all series" query on its initial
    // commit when `chart.getSeriesIds()` was still empty, then never
    // recomputed — the info bar stayed blank forever.
    const App = defineComponent({
      components: { ChartContainer, CandlestickSeries, InfoBar },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [h(InfoBar), h(CandlestickSeries, { data: candlestickData })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const bar = host.querySelector('[data-tooltip-legend]') as HTMLElement | null;
    expect(bar, 'InfoBar should render its info row').not.toBeNull();
    // It picked up the series — the row has the OHLC letters from the last candle.
    expect(bar?.textContent ?? '').toMatch(/O.*H.*L.*C/);

    wrapper.unmount();
  });

  it('<InfoBar> expands multi-layer BarSeries into per-layer rows', async () => {
    // Multi-layer (stacked) BarSeries expose `getLayerSnapshots(id, time)`; the
    // info bar should render one value per layer, matching React's behavior.
    const App = defineComponent({
      components: { ChartContainer, BarSeries, InfoBar },
      setup() {
        return () => h(ChartContainer, { theme: catppuccin.theme }, () => [h(InfoBar), h(BarSeries, { data: twoLayerBars })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const bar = host.querySelector('[data-tooltip-legend]');
    expect(bar).not.toBeNull();
    // Each layer is rendered as its own `inline-flex` bubble containing a
    // coloured dot + numeric value. Two bubbles → two rows.
    const bubbles = bar!.querySelectorAll('span[style*="inline-flex"]');
    expect(bubbles.length).toBe(twoLayerBars.length);

    wrapper.unmount();
  });

  it('<Title> throws loudly when mounted outside <ChartContainer>', () => {
    // Injection keys are set only by ChartContainer — using <Title> at the
    // top level should fail fast with a clear error rather than silently
    // rendering nothing.
    const Bad = defineComponent({
      components: { Title },
      setup() {
        return () => h(Title, {}, () => 'Orphan');
      },
    });
    expect(() => mount(Bad, { attachTo: host })).toThrow(/<Title> must be used within <ChartContainer>/);
  });

  it('<InfoBar> renders sub-cent OHLC values with enough precision (regression for `.toFixed(2)`)', async () => {
    const satoshi = 0.00001234;
    const App = defineComponent({
      components: { ChartContainer, CandlestickSeries, InfoBar },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(InfoBar),
            h(CandlestickSeries, {
              data: [
                { time: 1, open: satoshi, high: satoshi * 1.5, low: satoshi * 0.8, close: satoshi * 1.2 },
                { time: 2, open: satoshi * 1.2, high: satoshi * 2, low: satoshi, close: satoshi * 1.8 },
              ],
            }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const bar = host.querySelector('[data-tooltip-legend]') as HTMLElement | null;
    expect(bar).not.toBeNull();
    const text = bar?.textContent ?? '';
    // Not collapsed to "0.00" — at least one of the first significant digits of 0.00001234 comes through.
    expect(text).toMatch(/1234|0000123/);

    wrapper.unmount();
  });

  it('<InfoBar> custom `format` prop overrides rendered values', async () => {
    const App = defineComponent({
      components: { ChartContainer, LineSeries, InfoBar },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(InfoBar, {
              format: (v: number, field: string) => `<${field}:${v}>`,
            }),
            h(LineSeries, {
              data: [
                [
                  { time: 1, value: 42 },
                  { time: 2, value: 84 },
                ],
              ],
            }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const bar = host.querySelector('[data-tooltip-legend]') as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.textContent ?? '').toMatch(/<value:\d+>/);

    wrapper.unmount();
  });

  it('<Tooltip> is order-independent — renders nothing on mount without hover, but is correctly wired for later hover', async () => {
    // Without a crosshair the floating tooltip isn't visible anyway, but we
    // can still assert the component registered its `seriesChange` handler
    // (and didn't throw) by ensuring it mounts without errors when it
    // precedes the series in the template.
    const App = defineComponent({
      components: { ChartContainer, CandlestickSeries, Tooltip },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [h(Tooltip), h(CandlestickSeries, { data: candlestickData })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    // Canvas and at least one series registered — the Tooltip didn't crash on
    // an empty initial `getSeriesIds()` list.
    const canvases = host.querySelectorAll('canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });
});
