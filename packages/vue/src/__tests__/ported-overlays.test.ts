import { mount } from '@vue/test-utils';
import { ChartInstance } from '@wick-charts/core';
import {
  CandlestickSeries,
  ChartContainer,
  NumberFlow,
  PieLegend,
  PieSeries,
  TimeAxis,
  Title,
  YAxis,
  darkTheme,
} from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Coverage for the per-overlay props ported from React for parity:
 * `TimeAxis.{labelCount,minLabelSpacing}`, `YAxis.{labelCount,minLabelSpacing}`,
 * `PieLegend.position`, `Title` sub slot, `NumberFlow.format` accepting
 * `Intl.NumberFormatOptions`.
 */

const ohlc = [
  { time: 1, open: 1, high: 2, low: 1, close: 2 },
  { time: 2, open: 2, high: 3, low: 2, close: 3 },
  { time: 3, open: 3, high: 4, low: 3, close: 4 },
];

const pieData = [
  { label: 'A', value: 30 },
  { label: 'B', value: 70 },
];

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

describe('Vue overlays — ported props', () => {
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

  it('<TimeAxis labelCount minLabelSpacing> calls chart.setTimeAxisLabelDensity with the props', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setTimeAxisLabelDensity');
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(TimeAxis, { labelCount: 7, minLabelSpacing: 50 }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const matching = spy.mock.calls.find((c) => c[0]?.labelCount === 7 && c[0]?.minLabelSpacing === 50);
    expect(matching).toBeDefined();

    wrapper.unmount();
    spy.mockRestore();
  });

  it('<TimeAxis> with no density props passes through nulls', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setTimeAxisLabelDensity');
    const App = defineComponent({
      setup() {
        return () => h(ChartContainer, { theme: darkTheme }, () => [h(CandlestickSeries, { data: ohlc }), h(TimeAxis)]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const matching = spy.mock.calls.find((c) => c[0]?.labelCount === null && c[0]?.minLabelSpacing === null);
    expect(matching).toBeDefined();

    wrapper.unmount();
    spy.mockRestore();
  });

  it('<YAxis labelCount minLabelSpacing> calls chart.setYAxisLabelDensity with the props', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setYAxisLabelDensity');
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(YAxis, { labelCount: 5, minLabelSpacing: 30 }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const matching = spy.mock.calls.find((c) => c[0]?.labelCount === 5 && c[0]?.minLabelSpacing === 30);
    expect(matching).toBeDefined();

    wrapper.unmount();
    spy.mockRestore();
  });

  it('<YAxis> resets density to null on unmount', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setYAxisLabelDensity');
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(YAxis, { labelCount: 5 }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();
    spy.mockClear();

    wrapper.unmount();
    await settle();

    const reset = spy.mock.calls.find((c) => c[0]?.labelCount === null && c[0]?.minLabelSpacing === null);
    expect(reset).toBeDefined();

    spy.mockRestore();
  });

  it('<PieLegend position="bottom"> teleports into the bottom legend anchor', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(PieSeries, { data: pieData }),
            h(PieLegend, { position: 'bottom' }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const bottomAnchor = host.querySelector('[data-legend-anchor]') as HTMLElement;
    const legend = host.querySelector('[data-chart-pie-legend]') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(bottomAnchor.contains(legend)).toBe(true);
    expect(legend.getAttribute('data-chart-pie-legend-position')).toBe('bottom');

    wrapper.unmount();
  });

  it('<PieLegend position="right"> teleports into the right legend anchor', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(PieSeries, { data: pieData }),
            h(PieLegend, { position: 'right' }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const rightAnchor = host.querySelector('[data-legend-right-anchor]') as HTMLElement;
    const legend = host.querySelector('[data-chart-pie-legend]') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(rightAnchor.contains(legend)).toBe(true);
    expect(legend.getAttribute('data-chart-pie-legend-position')).toBe('right');

    wrapper.unmount();
  });

  it('<PieLegend position="overlay"> stays inside the series-overlay layer (no teleport)', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(PieSeries, { data: pieData }),
            h(PieLegend, { position: 'overlay' }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const seriesOverlay = host.querySelector('[data-chart-series-overlay]') as HTMLElement;
    const legend = host.querySelector('[data-chart-pie-legend]') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(seriesOverlay.contains(legend)).toBe(true);
    expect(legend.getAttribute('data-chart-pie-legend-position')).toBe('overlay');

    wrapper.unmount();
  });

  it('<Title> renders the named "sub" slot as rich content', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(Title, null, {
              default: () => 'BTC/USD',
              sub: () => h('span', { class: 'sub-marker' }, 'Live'),
            }),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const title = host.querySelector('[data-chart-title]') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toContain('BTC/USD');
    // The named slot must be rendered into the muted secondary span — and
    // since it's a slot, consumers can pass markup like a `<span>` rather
    // than a string-only prop.
    expect(title.querySelector('.sub-marker')).not.toBeNull();
    expect(title.querySelector('.sub-marker')?.textContent).toBe('Live');

    wrapper.unmount();
  });

  it('<Title sub="..."> still works as a back-compat string prop (deprecated path from 0.3.1)', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(Title, { sub: 'Live' }, () => 'BTC'),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const title = host.querySelector('[data-chart-title]') as HTMLElement;
    expect(title).not.toBeNull();
    // Both the primary text and the prop-supplied sub label should render.
    expect(title.textContent).toContain('BTC');
    expect(title.textContent).toContain('Live');
    expect(title.children.length).toBe(2);

    wrapper.unmount();
  });

  it('<Title> sub slot wins over sub prop when both are provided', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(
              Title,
              { sub: 'PROP-VALUE' },
              {
                default: () => 'BTC',
                sub: () => h('span', { class: 'slot-marker' }, 'SLOT-VALUE'),
              },
            ),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const title = host.querySelector('[data-chart-title]') as HTMLElement;
    expect(title.querySelector('.slot-marker')).not.toBeNull();
    expect(title.textContent).toContain('SLOT-VALUE');
    expect(title.textContent).not.toContain('PROP-VALUE');

    wrapper.unmount();
  });

  it('<Title> with no "sub" slot omits the secondary span entirely', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: darkTheme }, () => [
            h(CandlestickSeries, { data: ohlc }),
            h(Title, null, () => 'BTC'),
          ]);
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    const title = host.querySelector('[data-chart-title]') as HTMLElement;
    expect(title).not.toBeNull();
    // Only the primary <span> child for the default slot — no secondary span.
    expect(title.children.length).toBe(1);

    wrapper.unmount();
  });

  it('<NumberFlow format={Intl.NumberFormatOptions}> formats via the built-in Intl.NumberFormat', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(NumberFlow, {
            value: 1234.5,
            // Pass an object — the wider union must accept it and route through Intl.NumberFormat.
            format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
            locale: 'en-US',
          });
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    // The decomposed digits and symbols spell out something like "$1,234".
    // Accumulate the visible text via slot ordering.
    const textRuns: string[] = [];
    for (const span of host.querySelectorAll('span > span')) {
      // Inner-most spans hold either a digit (from the spinner column) or a
      // single symbol character. Grab the symbol-only ones — symbols are
      // single characters wrapped in a flat <span style="display:inline-block">.
      if ((span as HTMLElement).textContent && (span as HTMLElement).textContent!.length === 1) {
        textRuns.push((span as HTMLElement).textContent!);
      }
    }
    const flat = textRuns.join('');
    // Currency formatting always inserts the `$` prefix and the thousands separator.
    expect(flat).toContain('$');
    expect(flat).toContain(',');

    wrapper.unmount();
  });

  it('<NumberFlow format={fn}> still accepts a function (back-compat with the narrower type)', async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h(NumberFlow, {
            value: 42,
            format: (v: number) => `~${v}~`,
          });
      },
    });
    const wrapper = mount(App, { attachTo: host });
    await settle();

    // The custom formatter wraps the value in `~`. Read flat single-character spans.
    const flat = Array.from(host.querySelectorAll('span > span'))
      .map((s) => (s as HTMLElement).textContent ?? '')
      .filter((t) => t.length === 1)
      .join('');
    expect(flat).toContain('~');
    expect(flat).toContain('4');
    expect(flat).toContain('2');

    wrapper.unmount();
  });
});
