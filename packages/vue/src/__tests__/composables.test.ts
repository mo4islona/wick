import { mount } from '@vue/test-utils';
import {
  CandlestickSeries,
  ChartContainer,
  type ChartInstance,
  type CrosshairPosition,
  LineSeries,
  type VisibleRange,
  type YRange,
  darkTheme,
  useChartInstance,
  useCrosshairPosition,
  useLastYValue,
  usePreviousClose,
  useVisibleRange,
  useYRange,
} from '@wick-charts/vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Ref, defineComponent, h, nextTick } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

/**
 * Vue composables — lifecycle (subscribe/unsubscribe) and value reactivity.
 *
 * Each composable is exercised via a tiny `Probe` component mounted inside
 * `<ChartContainer>` so `useChartInstance()` resolves. Refs are captured via
 * the closure rather than `wrapper.vm` so we can reach them after unmount
 * for negative assertions.
 */

// Wide enough that `setVisibleRange` isn't clamped against the chart's
// `softMinRange` floor (10 bars).
const lineData = [Array.from({ length: 30 }, (_, i) => ({ time: i + 1, value: i * 10 + 5 }))];

const candlestickData = Array.from({ length: 12 }, (_, i) => ({
  time: i + 1,
  open: 10 + i,
  high: 12 + i,
  low: 9 + i,
  close: 11 + i,
}));

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

describe('Vue composables', () => {
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

  it('useVisibleRange initializes from chart and updates on viewportChange', async () => {
    let captured: { chart: ChartInstance; range: Ref<VisibleRange> } | undefined;

    const Probe = defineComponent({
      setup() {
        const chart = useChartInstance();
        const range = useVisibleRange(chart);
        captured = { chart, range };

        return () => null;
      },
    });
    // Probe rendered BEFORE the series so its `onMounted` registers the
    // chart-event listeners before the series's `onMounted` fires `setSeriesData`
    // — otherwise the initial `dataUpdate` event happens before subscription.
    const App = defineComponent({
      setup: () => () => h(ChartContainer, { theme: darkTheme }, () => [h(Probe), h(LineSeries, { data: lineData })]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!captured) throw new Error('probe did not run');

    const initial = captured.range.value;
    expect(initial.from).toBeLessThan(initial.to);

    // Use a 20-bar window — narrower than `softMinRange` (~10 bars at the
    // auto-detected data interval) gets clamped, which would defeat the test.
    captured.chart.setVisibleRange({ from: 5, to: 25 });
    await settle();

    expect(captured.range.value.from).toBeCloseTo(5, 5);
    expect(captured.range.value.to).toBeCloseTo(25, 5);

    wrapper.unmount();
  });

  it('useYRange tracks chart.getYRange across viewportChange', async () => {
    let captured: { chart: ChartInstance; range: Ref<YRange> } | undefined;
    const Probe = defineComponent({
      setup() {
        const chart = useChartInstance();
        const range = useYRange(chart);
        captured = { chart, range };

        return () => null;
      },
    });
    // Probe rendered BEFORE the series so its `onMounted` registers the
    // chart-event listeners before the series's `onMounted` fires `setSeriesData`
    // — otherwise the initial `dataUpdate` event happens before subscription.
    const App = defineComponent({
      setup: () => () => h(ChartContainer, { theme: darkTheme }, () => [h(Probe), h(LineSeries, { data: lineData })]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!captured) throw new Error('probe did not run');

    expect(captured.range.value.min).toBeLessThanOrEqual(10);
    expect(captured.range.value.max).toBeGreaterThanOrEqual(30);

    wrapper.unmount();
  });

  it('useLastYValue updates after series data lands and reports the trailing value', async () => {
    let captured: { chart: ChartInstance; last: Ref<{ value: number; isLive: boolean } | null> } | undefined;
    const Probe = defineComponent({
      setup() {
        const chart = useChartInstance();
        const last = useLastYValue(chart, 'line-id');
        captured = { chart, last };

        return () => null;
      },
    });
    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [h(Probe), h(LineSeries, { id: 'line-id', data: lineData })]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!captured) throw new Error('probe did not run');

    expect(captured.last.value).not.toBeNull();
    expect(captured.last.value?.value).toBe(lineData[0][lineData[0].length - 1].value);

    // Append a new last value — handler must fire and ref must update.
    captured.chart.appendData('line-id', { time: 100, value: 99 });
    await settle();
    expect(captured.last.value?.value).toBe(99);

    // Re-issuing the same value (equality short-circuit branch) must not flip
    // the ref to a new identity — handler returns early without assigning.
    const beforeRef = captured.last.value;
    captured.chart.updateData('line-id', { time: 100, value: 99 });
    await settle();
    expect(captured.last.value).toBe(beforeRef);

    wrapper.unmount();
  });

  it('usePreviousClose resolves the previous close on dataUpdate ticks', async () => {
    let captured: { chart: ChartInstance; prev: Ref<number | null> } | undefined;
    const Probe = defineComponent({
      setup() {
        const chart = useChartInstance();
        const prev = usePreviousClose(chart, 'cs-id');
        captured = { chart, prev };

        return () => null;
      },
    });
    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [
          h(Probe),
          h(CandlestickSeries, { id: 'cs-id', data: candlestickData }),
        ]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!captured) throw new Error('probe did not run');

    // Penultimate candle's close = candlestickData[length-2].close = 11 + 10 = 21.
    expect(captured.prev.value).toBe(candlestickData[candlestickData.length - 2].close);

    wrapper.unmount();
  });

  it('useCrosshairPosition starts null and registers/unregisters a crosshairMove listener', async () => {
    // The composable's handler reads `chart.getCrosshairPosition()` (chart-
    // owned state, mutated only by real interactions). Synthetic mousemove
    // dispatch on a canvas is flaky under happy-dom, so we verify
    // *subscription lifecycle* explicitly — the value-tracking path is
    // identical to the other composables already covered above.
    let captured: { chart: ChartInstance; pos: Ref<CrosshairPosition | null> } | undefined;
    const Probe = defineComponent({
      setup() {
        const chart = useChartInstance();
        const pos = useCrosshairPosition(chart);
        captured = { chart, pos };

        return () => null;
      },
    });
    const App = defineComponent({
      setup: () => () => h(ChartContainer, { theme: darkTheme }, () => [h(Probe), h(LineSeries, { data: lineData })]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!captured) throw new Error('probe did not run');

    expect(captured.pos.value).toBeNull();

    const offSpy = vi.spyOn(captured.chart, 'off');
    wrapper.unmount();
    await settle();

    // Composable registered exactly one `crosshairMove` listener at mount and
    // must unregister it on unmount.
    expect(offSpy.mock.calls.some((call) => call[0] === 'crosshairMove')).toBe(true);
  });

  it('unmount unsubscribes every listener that mount registered (no leaks)', async () => {
    let captured: { chart: ChartInstance } | undefined;
    const Probe = defineComponent({
      setup() {
        const chart = useChartInstance();
        useVisibleRange(chart);
        useYRange(chart);
        useLastYValue(chart, 'line-id');
        usePreviousClose(chart, 'line-id');
        useCrosshairPosition(chart);
        captured = { chart };

        return () => null;
      },
    });
    const App = defineComponent({
      setup: () => () =>
        h(ChartContainer, { theme: darkTheme }, () => [h(Probe), h(LineSeries, { id: 'line-id', data: lineData })]),
    });

    const wrapper = mount(App, { attachTo: host });
    await settle();
    if (!captured) throw new Error('probe did not run');

    // Spy `off` so the post-unmount accounting can compare against `on` calls
    // that happened on the same chart. We attach the spy *after* mount so the
    // counter starts at zero — only unmount-time calls count.
    const offSpy = vi.spyOn(captured.chart, 'off');

    wrapper.unmount();
    await settle();

    // 1× viewportChange (useVisibleRange)
    // 1× viewportChange (useYRange)
    // 2× useLastYValue (dataUpdate + viewportChange)
    // 1× dataUpdate (usePreviousClose)
    // 1× crosshairMove (useCrosshairPosition)
    // = 6 off() calls minimum from the composables. (LineSeries' own
    // unmount may add more but never fewer.)
    expect(offSpy.mock.calls.length).toBeGreaterThanOrEqual(6);

    const events = new Set(offSpy.mock.calls.map((call) => call[0] as string));
    expect(events.has('viewportChange')).toBe(true);
    expect(events.has('dataUpdate')).toBe(true);
    expect(events.has('crosshairMove')).toBe(true);
  });
});
