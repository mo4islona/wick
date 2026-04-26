import { render } from '@testing-library/svelte';
import { ChartInstance } from '@wick-charts/core';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PortedPropsHarness from './PortedPropsHarness.svelte';

/**
 * Coverage for the props ported from React for parity, on the Svelte side:
 * `ChartContainer.{gradient,interactive,headerLayout,padding}`, `TimeAxis` and
 * `YAxis` density overrides, `PieLegend.position`, `Title` named `sub` slot,
 * and `NumberFlow.format` accepting `Intl.NumberFormatOptions`.
 *
 * Mirrors the matching Vue test at
 * packages/vue/src/__tests__/ported-overlays.test.ts and the React tests at
 * packages/react/src/__tests__/components/{title,chart-container-props,...}.
 */

const candlestickData = [
  { time: 1, open: 1, high: 2, low: 1, close: 2 },
  { time: 2, open: 2, high: 3, low: 2, close: 3 },
  { time: 3, open: 3, high: 4, low: 3, close: 4 },
];

const pieData = [
  { label: 'A', value: 30 },
  { label: 'B', value: 70 },
];

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await tick();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await new Promise((r) => setTimeout(r, 0));
  }
}

function installSizePatch(width = 800, height = 400): () => void {
  const origRect = HTMLDivElement.prototype.getBoundingClientRect;
  HTMLDivElement.prototype.getBoundingClientRect = function patched() {
    const r = origRect.call(this);
    if (r.width > 0 && r.height > 0) return r;

    return { x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, width, height, toJSON: () => ({}) } as DOMRect;
  };
  const origWidthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const origHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });

  return () => {
    HTMLDivElement.prototype.getBoundingClientRect = origRect;
    if (origWidthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origWidthDesc);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    if (origHeightDesc) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origHeightDesc);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  };
}

describe('Svelte ported props parity', () => {
  let restoreSize: () => void;

  beforeEach(() => {
    restoreSize = installSizePatch();
  });

  afterEach(() => {
    restoreSize();
  });

  it('<ChartContainer gradient={false}> drops the linear-gradient background', async () => {
    const result = render(PortedPropsHarness, { variant: 'gradient-off', candlestickData });
    await settle();

    const root = result.container.querySelector('div') as HTMLElement;
    expect(root.style.background).not.toContain('linear-gradient');
    result.unmount();
  });

  it('<ChartContainer headerLayout="inline"> renders Title/InfoBar above the canvas (not absolute)', async () => {
    const result = render(PortedPropsHarness, { variant: 'header-inline', candlestickData });
    await settle();

    const header = result.container.querySelector('[data-chart-header]') as HTMLElement | null;
    const overlay = result.container.querySelector('[data-chart-top-overlay]');
    expect(header).not.toBeNull();
    expect(header!.style.position).not.toBe('absolute');
    // Inline mode is mutually exclusive with the absolute overlay marker.
    expect(overlay).toBeNull();
    result.unmount();
  });

  it('<ChartContainer headerLayout="overlay"> renders Title/InfoBar in the absolute top-overlay strip', async () => {
    const result = render(PortedPropsHarness, { variant: 'header-overlay', candlestickData });
    await settle();

    const overlay = result.container.querySelector('[data-chart-top-overlay]') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.position || getComputedStyle(overlay).position).toBe('absolute');
    result.unmount();
  });

  it('<ChartContainer headerLayout="inline" padding={{top:20}}> passes the user-configured top through (no fold-in)', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setPadding');
    const result = render(PortedPropsHarness, { variant: 'padded', candlestickData });
    await settle();

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[0]?.top).toBe(20);
    }
    spy.mockRestore();
    result.unmount();
  });

  it('<TimeAxis labelCount minLabelSpacing> calls chart.setTimeAxisLabelDensity with the props', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setTimeAxisLabelDensity');
    const result = render(PortedPropsHarness, {
      variant: 'time-axis-density',
      candlestickData,
      labelCount: 7,
      minLabelSpacing: 50,
    });
    await settle();

    const matching = spy.mock.calls.find((c) => c[0]?.labelCount === 7 && c[0]?.minLabelSpacing === 50);
    expect(matching).toBeDefined();
    spy.mockRestore();
    result.unmount();
  });

  it('<TimeAxis> with no density props passes through nulls', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setTimeAxisLabelDensity');
    const result = render(PortedPropsHarness, { variant: 'time-axis-default', candlestickData });
    await settle();

    const matching = spy.mock.calls.find((c) => c[0]?.labelCount === null && c[0]?.minLabelSpacing === null);
    expect(matching).toBeDefined();
    spy.mockRestore();
    result.unmount();
  });

  it('<YAxis labelCount> calls chart.setYAxisLabelDensity with the prop and resets on destroy', async () => {
    const spy = vi.spyOn(ChartInstance.prototype, 'setYAxisLabelDensity');
    const result = render(PortedPropsHarness, {
      variant: 'y-axis-density',
      candlestickData,
      yLabelCount: 5,
    });
    await settle();

    const set = spy.mock.calls.find((c) => c[0]?.labelCount === 5);
    expect(set).toBeDefined();

    spy.mockClear();
    result.unmount();
    await settle();

    // Destroy path resets density to nulls.
    const reset = spy.mock.calls.find((c) => c[0]?.labelCount === null && c[0]?.minLabelSpacing === null);
    expect(reset).toBeDefined();
    spy.mockRestore();
  });

  it('<PieLegend position="bottom"> portals into the bottom legend anchor', async () => {
    const result = render(PortedPropsHarness, { variant: 'pie-legend-bottom', pieData });
    await settle();

    const bottomAnchor = result.container.querySelector('[data-legend-anchor]') as HTMLElement;
    const legend = result.container.querySelector('[data-chart-pie-legend]') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(bottomAnchor.contains(legend)).toBe(true);
    expect(legend.getAttribute('data-chart-pie-legend-position')).toBe('bottom');
    result.unmount();
  });

  it('<PieLegend position="right"> portals into the right legend anchor', async () => {
    const result = render(PortedPropsHarness, { variant: 'pie-legend-right', pieData });
    await settle();

    const rightAnchor = result.container.querySelector('[data-legend-right-anchor]') as HTMLElement;
    const legend = result.container.querySelector('[data-chart-pie-legend]') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(rightAnchor.contains(legend)).toBe(true);
    expect(legend.getAttribute('data-chart-pie-legend-position')).toBe('right');
    result.unmount();
  });

  it('<PieLegend position="overlay"> stays inside the series-overlay layer (no portal)', async () => {
    const result = render(PortedPropsHarness, { variant: 'pie-legend-overlay', pieData });
    await settle();

    const seriesOverlay = result.container.querySelector('[data-chart-series-overlay]') as HTMLElement;
    const legend = result.container.querySelector('[data-chart-pie-legend]') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(seriesOverlay.contains(legend)).toBe(true);
    expect(legend.getAttribute('data-chart-pie-legend-position')).toBe('overlay');
    result.unmount();
  });

  it('<Title> renders the named "sub" slot as rich content', async () => {
    const result = render(PortedPropsHarness, { variant: 'title-sub-slot', candlestickData });
    await settle();

    const title = result.container.querySelector('[data-chart-title]') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toContain('BTC/USD');
    expect(title.querySelector('.sub-marker')).not.toBeNull();
    expect(title.querySelector('.sub-marker')?.textContent?.trim()).toBe('Live');
    result.unmount();
  });

  it('<Title sub="..."> still works as a back-compat string prop (deprecated path from 0.3.1)', async () => {
    const result = render(PortedPropsHarness, { variant: 'title-sub-prop', candlestickData });
    await settle();

    const title = result.container.querySelector('[data-chart-title]') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toContain('BTC');
    expect(title.textContent).toContain('Live');
    expect(title.children.length).toBe(2);
    result.unmount();
  });

  it('<Title> sub slot wins over sub prop when both are provided', async () => {
    const result = render(PortedPropsHarness, { variant: 'title-sub-both', candlestickData });
    await settle();

    const title = result.container.querySelector('[data-chart-title]') as HTMLElement;
    expect(title.querySelector('.slot-marker')).not.toBeNull();
    expect(title.textContent).toContain('SLOT-VALUE');
    expect(title.textContent).not.toContain('PROP-VALUE');
    result.unmount();
  });

  it('<Title> with no "sub" slot omits the secondary span entirely', async () => {
    const result = render(PortedPropsHarness, { variant: 'title-no-sub', candlestickData });
    await settle();

    const title = result.container.querySelector('[data-chart-title]') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.children.length).toBe(1);
    result.unmount();
  });

  it('<NumberFlow format={Intl.NumberFormatOptions}> formats via the built-in Intl.NumberFormat', async () => {
    const result = render(PortedPropsHarness, { variant: 'numberflow-options' });
    await settle();

    const flat = Array.from(result.container.querySelectorAll('span > span'))
      .map((s) => (s as HTMLElement).textContent?.trim() ?? '')
      .filter((t) => t.length === 1)
      .join('');
    expect(flat).toContain('$');
    expect(flat).toContain(',');
    result.unmount();
  });

  it('<NumberFlow format={fn}> still accepts a function (back-compat with the narrower type)', async () => {
    const result = render(PortedPropsHarness, { variant: 'numberflow-fn' });
    await settle();

    const flat = Array.from(result.container.querySelectorAll('span > span'))
      .map((s) => (s as HTMLElement).textContent?.trim() ?? '')
      .filter((t) => t.length === 1)
      .join('');
    expect(flat).toContain('~');
    expect(flat).toContain('4');
    expect(flat).toContain('2');
    result.unmount();
  });
});
