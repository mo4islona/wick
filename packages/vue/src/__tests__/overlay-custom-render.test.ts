import { mount } from '@vue/test-utils';
import { CandlestickSeries, ChartContainer, InfoBar, LineSeries, Tooltip, catppuccin } from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Phase B: scoped-slot on Vue `InfoBar` / `Tooltip` replaces the built-in UI
 * with user markup. Asserts the slot receives snapshots and that
 * `Tooltip` stays hover-only.
 */

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

const MULTI_LINE = [
  Array.from({ length: 10 }, (_, i) => ({ time: (i + 1) * 60_000, value: 10 + i })),
  Array.from({ length: 10 }, (_, i) => ({ time: (i + 1) * 60_000, value: 20 + i })),
];

const OHLC = Array.from({ length: 10 }, (_, i) => ({
  time: (i + 1) * 60_000,
  open: 100 + i,
  high: 110 + i,
  low: 90 + i,
  close: 105 + i,
}));

describe('Vue overlay custom-render scoped slots', () => {
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

  it('<InfoBar> scoped slot receives snapshots and `isHover: false` at rest', async () => {
    let captured: { count: number; isHover: boolean } | null = null;

    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(
              InfoBar,
              {},
              {
                default: (ctx: { snapshots: readonly { seriesId: string }[]; isHover: boolean }) => {
                  captured = { count: ctx.snapshots.length, isHover: ctx.isHover };

                  return h('div', { 'data-testid': 'custom-bar' }, `${ctx.snapshots.length}`);
                },
              },
            ),
            h(LineSeries, { data: MULTI_LINE }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    expect(host.querySelector('[data-testid="custom-bar"]')).not.toBeNull();
    expect(captured).not.toBeNull();
    expect(captured!.count).toBe(MULTI_LINE.length);
    expect(captured!.isHover).toBe(false);

    wrapper.unmount();
  });

  it('<InfoBar> default UI rendered when no slot is provided', async () => {
    const App = defineComponent({
      setup() {
        return () => h(ChartContainer, { theme: catppuccin.theme }, () => [h(InfoBar), h(CandlestickSeries, { data: OHLC })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const bar = host.querySelector('[data-tooltip-legend]');
    expect(bar, 'default InfoBar UI renders').not.toBeNull();
    // Default OHLC layout contains the "O H L C" letters.
    expect(bar?.textContent ?? '').toMatch(/O.*H.*L.*C/);

    wrapper.unmount();
  });

  it('<Tooltip> scoped slot is NOT invoked without a crosshair (hover-only contract)', async () => {
    let invocations = 0;

    const App = defineComponent({
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(
              Tooltip,
              {},
              {
                default: () => {
                  invocations++;

                  return h('div', { 'data-testid': 'custom-tooltip' }, 'content');
                },
              },
            ),
            h(LineSeries, { data: MULTI_LINE }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    expect(invocations).toBe(0);
    expect(host.querySelector('[data-testid="custom-tooltip"]')).toBeNull();

    wrapper.unmount();
  });
});
