import { mount } from '@vue/test-utils';
import { CandlestickSeries, ChartContainer, Navigator, catppuccin } from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

const candlestickData = [
  { time: 1, open: 1, high: 2, low: 1, close: 2 },
  { time: 2, open: 2, high: 3, low: 2, close: 3 },
  { time: 3, open: 3, high: 4, low: 3, close: 4 },
];

const lineData = {
  type: 'line' as const,
  points: candlestickData.map((p) => ({ time: p.time, value: p.close })),
};

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await nextTick();
    flushAllRaf();
  }
}

describe('<Navigator> (vue)', () => {
  beforeEach(() => {
    installRaf();
  });
  afterEach(() => {
    uninstallRaf();
  });

  it('mounts a navigator strip inside the chart container anchor', async () => {
    const Parent = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(CandlestickSeries, { data: candlestickData }),
            h(Navigator, { data: lineData }),
          ]);
      },
    });

    const wrapper = mount(Parent, { attachTo: document.body });
    await settle();

    const strip = document.querySelector('[data-chart-navigator]');
    expect(strip).not.toBeNull();
    expect(strip?.querySelector('canvas')).not.toBeNull();

    const anchor = document.querySelector('[data-navigator-anchor]');
    expect(anchor).not.toBeNull();
    // Strip lives inside the anchor via Teleport.
    expect(anchor?.contains(strip as Node)).toBe(true);

    wrapper.unmount();
  });

  it('applies an explicit height override', async () => {
    const Parent = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(CandlestickSeries, { data: candlestickData }),
            h(Navigator, { data: lineData, height: 40 }),
          ]);
      },
    });

    const wrapper = mount(Parent, { attachTo: document.body });
    await settle();

    const strip = document.querySelector('[data-chart-navigator]') as HTMLElement | null;
    expect(strip?.style.height).toBe('40px');

    wrapper.unmount();
  });
});
