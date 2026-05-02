# Wick Charts testing — templates, spy API, gotchas

## CanvasRecorder

Defined in `packages/core/src/__tests__/helpers/recording-context.ts`. Attached to every test canvas automatically:

- Core tests: `const { ctx, spy } = createRecordingContext()` — hand `ctx` to a renderer's `render(ctx)`.
- React/Vue/Svelte tests: each `HTMLCanvasElement` carries a `__spy: CanvasRecorder` after the first `getContext('2d')` call. `mountChart` grabs `mainSpy` / `overlaySpy` for you.

```ts
interface RecordedCall {
  method: string;               // 'fillRect', 'lineTo', 'stroke', 'arc', 'beginPath', ...
  args: readonly unknown[];     // raw positional args
  fillStyle: string;            // style snapshot at call time
  strokeStyle: string;
  lineWidth: number;
  font: string;
  globalAlpha: number;
}

interface CanvasRecorder {
  readonly calls: readonly RecordedCall[];
  callsOf(method: string): RecordedCall[];          // all calls to one method
  countOf(method: string): number;                  // just the count
  reset(): void;                                    // clear between "before" and "after" in one test
  matchesSequence(methods: string[]): boolean;      // ordered subsequence, gaps OK
  fillStyleAt(x: number, y: number): string | null; // reverse-scan fillRects for a point
}
```

Typical queries:

```ts
// "renderer drew one body per candle"
expect(spy.countOf('fillRect')).toBeGreaterThanOrEqual(data.length);

// "line color matches theme"
const strokes = spy.callsOf('stroke');
expect(strokes.some((c) => c.strokeStyle === theme.line.color)).toBe(true);

// "clear preceded the first draw"
expect(spy.matchesSequence(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke'])).toBe(true);

// "bottom-left pixel is painted with the up candle color"
// `body` can be a tuple for a gradient, so flatten to a single color first.
expect(spy.fillStyleAt(10, 380)).toBe(resolveCandlestickBodyColor(theme.candlestick.up.body));
```

**Reset between phases:** for "before/after" assertions inside a single test, call `spy.reset()` right before the action. Not between separate tests — `mountChart` rotates spies automatically.

---

## Template: renderer unit test

```ts
// packages/core/src/__tests__/renderers/<series>.test.ts
import { describe, expect, it } from 'vitest';

import { createFakeCanvas } from '../helpers/fake-canvas';
import { createRecordingContext } from '../helpers/recording-context';
import { <SeriesName>Renderer } from '../../series/<series>';
import { catppuccin } from '../../theme/dark';

describe('<SeriesName>Renderer', () => {
  it('draws one body per candle', () => {
    const { ctx, spy } = createRecordingContext();
    const r = new <SeriesName>Renderer(/* options */);
    r.setData([/* fixture */]);
    r.render(ctx, { /* viewport + theme */ });

    expect(spy.countOf('fillRect')).toBe(N);
  });
});
```

**Rules:**
- No `mountChart`, no DOM. Pure renderer + ctx.
- Feed data directly via `r.setData(...)` / `r.store.setData(...)` (check the renderer's surface).
- Assert on *primitives and their styles*, not on the resulting bitmap.

---

## Template: interaction handler unit test

```ts
// packages/core/src/__tests__/zoom-handler.test.ts
import { describe, expect, it, vi } from 'vitest';

import { ZoomHandler } from '../../interactions/zoom';

describe('ZoomHandler', () => {
  it('normalizes DOM_DELTA_LINE to pixel units', () => {
    const viewport = { zoomAt: vi.fn() } as any;
    const timeScale = { getMediaWidth: () => 800, xToTime: (x: number) => x } as any;
    const handler = new ZoomHandler(viewport, timeScale);

    const event = new WheelEvent('wheel', {
      deltaY: -10,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      cancelable: true,
    });
    Object.defineProperty(event, 'offsetX', { value: 400 });

    handler.handleWheel(event);

    // cursor time = 400, factor = exp(-10 * 8 * 0.005) ≈ 0.67
    expect(viewport.zoomAt).toHaveBeenCalledWith(400, expect.closeTo(0.67, 0.02));
  });
});
```

**Rules:**
- Mock the viewport / timeScale surface — real instances not needed.
- `WheelEvent` in jsdom/happy-dom needs `offsetX`/`offsetY` set via `Object.defineProperty` (the constructor ignores them).
- Set `cancelable: true` or `preventDefault()` throws under some jsdom versions.

---

## Template: React integration / regression test

```tsx
// packages/react/src/__tests__/integration/<regression>.test.tsx
import { LineSeries } from '@wick-charts/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mountChart } from '../helpers/mount-chart';

describe('<regression name>', () => {
  let mounted: ReturnType<typeof mountChart> | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('<user-visible behavior>', () => {
    mounted = mountChart(<LineSeries data={fixture} />, { width: 800, height: 400 });
    mounted.mainSpy.reset();

    // user action
    mounted.dispatchWheel({ deltaY: -200, clientX: 400 });
    mounted.flushScheduler();

    // assert
    expect(mounted.chart.getVisibleRange().to - mounted.chart.getVisibleRange().from).toBeLessThan(...);
  });
});
```

**Rules:**
- Always `unmount()` in `afterEach`. Otherwise canvases accumulate across tests and spy counts leak.
- Call `flushScheduler()` after any action that schedules a frame (data swap, wheel, rerender). Without it the spy is empty.
- For data swaps, use `mounted.rerender(<NewChildren />)` — not `mounted.chart.setSeriesData` — because you want to exercise the React → core path.

---

## Template: React component test

```tsx
// packages/react/src/__tests__/components/<name>.test.tsx
import { fireEvent } from '@testing-library/react';
import { Legend, LineSeries } from '@wick-charts/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mountChart } from '../helpers/mount-chart';

describe('<Component>', () => {
  let mounted: ReturnType<typeof mountChart> | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('responds to user click', () => {
    mounted = mountChart(
      <>
        <LineSeries data={[[{ time: 1, value: 1 }]]} />
        <Legend />
      </>,
    );
    const item = mounted.container.querySelector('[data-legend] > div') as HTMLElement;
    fireEvent.click(item);
    mounted.flushScheduler();

    // assert on mounted.chart state, not DOM — legend re-renders only after React commit.
    expect(mounted.chart.isLayerVisible(mounted.chart.getSeriesIds()[0], 0)).toBe(false);
  });
});
```

**Rules:**
- Prefer RTL `fireEvent.click(el)` over `el.click()` — the former `act()`-wraps automatically.
- For CSS/style assertions, use `style.background` / `style.cursor` — computed style is unreliable in jsdom.
- Don't query ephemeral DOM with brittle CSS paths; prefer `data-*` markers already in production code (e.g. `[data-legend]`).

---

## Template: wrapper smoke (Vue)

```ts
import { mount } from '@vue/test-utils';
import { ChartContainer, CandlestickSeries, catppuccin } from '@wick-charts/vue';
import { defineComponent, h, nextTick, ref } from 'vue';

import { flushAllRaf, installRaf, uninstallRaf } from '../../../react/src/__tests__/helpers/raf';

// In Vue wrappers the data watcher is lazy (no `immediate: true`) — start with
// an empty ref, mutate after mount so the first watch callback fires with data.
it('mounts and draws after data update', async () => {
  installRaf();
  const host = document.createElement('div');
  document.body.appendChild(host);
  // ...patch getBoundingClientRect on host + descendants (see vue smoke.test.ts)...

  const data = ref<OHLCInput[]>([]);
  const App = defineComponent({
    setup: () => () => h(ChartContainer, { theme: catppuccin.theme }, () => [h(CandlestickSeries, { data: data.value })]),
  });
  const wrapper = mount(App, { attachTo: host });
  await settle(); // alternates nextTick() + flushAllRaf()
  data.value = fixture;
  await settle();

  expect(host.querySelector('canvas').__spy!.countOf('fillRect')).toBeGreaterThan(0);
  wrapper.unmount();
  uninstallRaf();
});
```

## Template: wrapper smoke (Svelte)

```ts
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

import SmokeHarness from './SmokeHarness.svelte';

it('mounts Svelte wrapper', async () => {
  const result = render(SmokeHarness, { variant: 'candlestick', candlestickData });
  for (let i = 0; i < 6; i++) {
    await tick();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  }
  expect(result.container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2);
  result.unmount();
});
```

**Svelte-specific rules:**
- Tests run under `jsdom` (not happy-dom) — see `vitest.config.ts`. Svelte 4's flush is sensitive to DOM quirks.
- The config sets `resolve.conditions: ['browser', ...]` + `ssr.noExternal: ['svelte']` so the plugin emits DOM output; without this `onMount` is a no-op.
- Don't install the fake RAF — real `requestAnimationFrame` from jsdom is needed for Svelte's render callbacks.
- `$:` reactive blocks fire on mount, so initial data *does* land (unlike Vue watchers).

---

## 7-regression class map

Each production regression has a dedicated guard test. Grep for the commit hash to find it.

| # | Symptom | Commit | Guard test |
|---|---|---|---|
| 1 | Layout jump on mount (late Legend registration) | `be01d6b` | `packages/react/src/__tests__/integration/mount-layout.test.tsx` |
| 2 | yScale stale after setSeriesData | `7ac1a6b` | `integration/data-update-sync.test.tsx` |
| 3 | Streaming gap on catch-up after tab throttle | `1c1aff1` | `integration/streaming-gap.test.tsx` |
| 4 | Mixed Date/number normalization | `2dbd2f4` | `integration/mixed-input-types.test.tsx` + `renderers/normalization.test.ts` |
| 5 | Y-range stacking (off/normal/percent) | — | Covered in `core/__tests__/bar-range.test.ts` + `line-range.test.ts` |
| 6 | Resize/DPI black flash | — | `integration/resize-dpi.test.tsx` |
| 7 | Visibility toggle in batch (hidden layers still in Y-range) | — | `integration/visibility-batch.test.tsx` |

When adding a regression-class test: copy the nearest file in the table, adapt the fixture, keep the `describe` title referencing the symptom (not a phase number).

---

## Gotchas

### RAF + scheduler

- `installRaf()` replaces `requestAnimationFrame` + zero-delay `setTimeout` with queue-controllable fakes. `flushAllRaf()` drains them.
- React tests install RAF through `mountChart`. Other tests must call `installRaf()` in `beforeEach` and `uninstallRaf()` in `afterEach`.
- **Don't** call `installRaf()` in Svelte tests. Svelte's scheduler fires on real microtasks + `requestAnimationFrame` in jsdom, and the fake RAF doesn't cover its needs.

### ResizeObserver

- `packages/react/test-setup.ts` installs a `MockResizeObserver` whose callbacks are inspectable via `(globalThis as any).__mockResizeObserver.callbacks`.
- To simulate a resize in React tests, call `mounted.triggerResize(width, height)` — the helper patches the inner chart container's dimensions and fires all live observer callbacks.

### WheelEvent

- `new WheelEvent('wheel', { deltaY, deltaMode })` **does not** carry `offsetX/Y` in jsdom/happy-dom. Production zoom math reads `e.offsetX`.
- For interaction-handler tests, attach `offsetX` via `Object.defineProperty(event, 'offsetX', { value: 400 })`.
- For React integration tests, pass `clientX`/`clientY` to `mounted.dispatchWheel(...)` — the handler fallback reads those when offsetX is missing.

### Cleanup between tests

- Always `mounted?.unmount()` in `afterEach`. Mount-chart's unmount drains deferred `setTimeout(0)` used by ChartContainer's destroy path; without it, `ChartInstance.destroy()` is skipped and subsequent tests inherit live listeners.
- The recording context is per-canvas. A fresh `mountChart` produces fresh canvases + fresh spies — no cross-test leakage.

### `mountChart` dimensions

- Default 800×400. Pass `{ width, height }` only when the behavior depends on size (e.g. viewport calculations).
- `mountChart` patches `HTMLDivElement.prototype.getBoundingClientRect` while the chart is mounted. A mid-test throw unrolls this patch — but if you bypass the helper and write your own setup, you *must* unroll it yourself or downstream tests will report stale dimensions.

### React act() warnings

- If the console shows `act()` warnings, an event wasn't wrapped. Use `fireEvent` from `@testing-library/react` for user events, or `mounted.dispatchMouse/Wheel/Touch` for chart canvas events — both handle `act` internally.
