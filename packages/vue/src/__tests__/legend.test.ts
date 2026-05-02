import { mount } from '@vue/test-utils';
import { BarSeries, ChartContainer, Legend, LineSeries, catppuccin } from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Parity regression tests for the Vue `Legend` — mirrors the behaviors
 * enforced by `packages/react/src/__tests__/components/legend.test.tsx`.
 *
 * Covers:
 *   - seriesChange catch-up when Legend is declared before the series
 *   - toggle mode (click flips visibility through the ChartInstance)
 *   - solo mode (second click on the same item restores all)
 *   - position="right" teleports into the right anchor
 */

const twoLayerLine = [
  [
    { time: 1, value: 10 },
    { time: 2, value: 20 },
  ],
  [
    { time: 1, value: 100 },
    { time: 2, value: 200 },
  ],
];

const threeLayerBars = [[{ time: 1, value: 10 }], [{ time: 1, value: 100 }], [{ time: 1, value: 1000 }]];

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

describe('Vue <Legend> parity', () => {
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

  it('renders one item per layer even when declared before the series (seriesChange catch-up)', async () => {
    // Legend is placed *before* LineSeries in the slot, so on its first commit
    // `chart.getSeriesIds()` is empty. Without the seriesChange subscription it
    // would stay empty forever.
    const App = defineComponent({
      components: { ChartContainer, LineSeries, Legend },
      setup() {
        return () => h(ChartContainer, { theme: catppuccin.theme }, () => [h(Legend), h(LineSeries, { data: twoLayerLine })]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const items = host.querySelectorAll('[data-legend] > *');
    expect(items.length).toBe(twoLayerLine.length);
    wrapper.unmount();
  });

  it('toggle mode: click flips layer visibility in the ChartInstance', async () => {
    const App = defineComponent({
      components: { ChartContainer, LineSeries, Legend },
      setup() {
        return () => h(ChartContainer, { theme: catppuccin.theme }, () => [h(LineSeries, { data: twoLayerLine }), h(Legend)]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    // Dig the ChartInstance out via the series overlay — it's the nearest
    // proxy to what React's `mountChart()` helper returns.
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    const buttons = host.querySelectorAll('[data-legend] button');
    expect(buttons.length).toBe(twoLayerLine.length);

    // Click the first legend item — first layer should go invisible, second stays.
    (buttons[0] as HTMLButtonElement).click();
    await settle();

    const firstEl = buttons[0] as HTMLButtonElement;
    expect(firstEl.style.opacity).toBe('0.35');
    expect((buttons[1] as HTMLButtonElement).style.opacity).toBe('1');

    wrapper.unmount();
  });

  it('solo mode: second click on the same item restores all layers', async () => {
    const App = defineComponent({
      components: { ChartContainer, BarSeries, Legend },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(BarSeries, { data: threeLayerBars }),
            h(Legend, { mode: 'solo' }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const buttons = () => host.querySelectorAll('[data-legend] button');
    expect(buttons().length).toBe(threeLayerBars.length);

    // Solo on index 1 → only layer 1 visible (others dimmed).
    (buttons()[1] as HTMLButtonElement).click();
    await settle();
    expect((buttons()[0] as HTMLButtonElement).style.opacity).toBe('0.35');
    expect((buttons()[1] as HTMLButtonElement).style.opacity).toBe('1');
    expect((buttons()[2] as HTMLButtonElement).style.opacity).toBe('0.35');

    // Second click on the same solo'd item restores everything.
    (buttons()[1] as HTMLButtonElement).click();
    await settle();
    expect((buttons()[0] as HTMLButtonElement).style.opacity).toBe('1');
    expect((buttons()[1] as HTMLButtonElement).style.opacity).toBe('1');
    expect((buttons()[2] as HTMLButtonElement).style.opacity).toBe('1');

    wrapper.unmount();
  });

  it('scoped slot replaces the default UI and receives LegendItem[] with closures', async () => {
    let captured: unknown[] = [];
    const App = defineComponent({
      components: { ChartContainer, LineSeries, Legend },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(LineSeries, { data: twoLayerLine }),
            h(
              Legend,
              {},
              {
                default: ({ items }: { items: readonly unknown[] }) => {
                  captured = items as unknown[];
                  return h(
                    'div',
                    { 'data-testid': 'custom' },
                    items.map((it: unknown) => {
                      const item = it as { id: string; label: string };
                      return h('span', { key: item.id, 'data-id': item.id }, item.label);
                    }),
                  );
                },
              },
            ),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const custom = host.querySelector('[data-testid="custom"]');
    expect(custom).not.toBeNull();
    expect(captured.length).toBe(twoLayerLine.length);
    // Default UI uses <button>; slot replaces it entirely.
    expect(host.querySelectorAll('[data-legend] button').length).toBe(0);
    wrapper.unmount();
  });

  it('slot item.toggle() flips visibility through the ChartInstance', async () => {
    let itemsRef: Array<{ toggle: () => void; isolate: () => void }> = [];
    const App = defineComponent({
      components: { ChartContainer, LineSeries, Legend },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(LineSeries, { data: twoLayerLine }),
            h(
              Legend,
              {},
              {
                default: ({ items }: { items: readonly unknown[] }) => {
                  itemsRef = items as Array<{ toggle: () => void; isolate: () => void }>;
                  return h('div', { 'data-testid': 'custom' });
                },
              },
            ),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    expect(itemsRef.length).toBe(2);
    itemsRef[0].toggle();
    await settle();

    // After toggle, the slot re-ran — re-read to see the updated disabled state.
    const first = itemsRef[0] as unknown as { isDisabled: boolean };
    expect(first.isDisabled).toBe(true);
    wrapper.unmount();
  });

  it('position="right" teleports into the right-side anchor', async () => {
    const App = defineComponent({
      components: { ChartContainer, LineSeries, Legend },
      setup() {
        return () =>
          h(ChartContainer, { theme: catppuccin.theme }, () => [
            h(LineSeries, { data: twoLayerLine }),
            h(Legend, { position: 'right' }),
          ]);
      },
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();

    const rightAnchor = host.querySelector('[data-legend-right-anchor]');
    const bottomAnchor = host.querySelector('[data-legend-anchor]');
    expect(rightAnchor).not.toBeNull();
    expect(bottomAnchor).not.toBeNull();

    const legend = host.querySelector('[data-legend="right"]') as HTMLElement;
    expect(legend).not.toBeNull();
    // It landed in the right anchor, not the bottom one.
    expect(rightAnchor!.contains(legend)).toBe(true);
    expect(bottomAnchor!.contains(legend)).toBe(false);

    wrapper.unmount();
  });
});
