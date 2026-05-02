# Context & custom children

`<ChartContainer>` sets up two contexts on mount:

- **Chart context** — holds the `ChartInstance` (imperative API).
- **Theme context** — holds the current `ChartTheme`.

Any descendant component can read from these. That's how built-in overlays (`Tooltip`, `Crosshair`, `YAxis`, `Legend`, `YLabel`) work — and how you build your own.

## React

`useChartInstance()` returns `ChartInstance`, throws if used outside `<ChartContainer>`.
`useTheme()` returns `ChartTheme`, throws outside a `<ThemeProvider>` (which `ChartContainer` sets up internally).
`useThemeOptional()` returns `ChartTheme | null` — use when a component may render outside any provider.

```tsx
import { ChartContainer, CandlestickSeries, useChartInstance, useTheme, catppuccin } from '@wick-charts/react';

function FitButton() {
  const chart = useChartInstance();
  const theme = useTheme();
  return (
    <button onClick={() => chart.fitContent()} style={{ background: theme.background }}>
      Fit
    </button>
  );
}

<ChartContainer theme={catppuccin.theme}>
  <CandlestickSeries data={ohlc} />
  <FitButton />
</ChartContainer>
```

### Sharing a theme across charts

`<ThemeProvider>` can wrap multiple containers:

```tsx
import { ThemeProvider, ChartContainer, catppuccin } from '@wick-charts/react';

<ThemeProvider value={catppuccin}>
  <ChartContainer>...</ChartContainer>
  <ChartContainer>...</ChartContainer>  {/* inherits catppuccin */}
</ThemeProvider>
```

A `ChartContainer` with its own `theme` prop overrides the provider.

## Vue

`useChartInstance()` returns the instance directly. `useTheme()` returns `ShallowRef<ChartTheme>` (reactive — unwrap with `.value` in script, auto-unwrap in template). Both throw outside `<ChartContainer>`.

```vue
<script setup lang="ts">
import { useChartInstance, useTheme } from '@wick-charts/vue';
const chart = useChartInstance();
const theme = useTheme();
</script>
<template>
  <button @click="chart.fitContent()" :style="{ background: theme.background }">Fit</button>
</template>
```

## Svelte

`getChartContext()` returns `Readable<ChartInstance | null>` — nullable because the instance is created on mount. `getThemeContext()` returns `Readable<ChartTheme>`. Access via `$store`.

```svelte
<script lang="ts">
  import { getChartContext, getThemeContext } from '@wick-charts/svelte';
  const chart = getChartContext();
  const theme = getThemeContext();
</script>
<button on:click={() => $chart?.fitContent()} style="background: {$theme.background}">Fit</button>
```

## Imperative `ChartInstance` methods

Useful from custom children:

- `fitContent()` — auto-fit viewport to all data across every series.
- `getVisibleRange()`, `getYRange()`, `getCrosshairPosition()` — one-shot reads.
- `getLastValue(id)` → `{ value, isLive } | null`, `getPreviousClose(id)` → `number | null`, `getLastData(id)`, `getDataAtTime(id, time)` — data queries.
- `getStackedLastValue(id)` → `{ value, isLive } | null` — cumulative top of a stacked series. Falls back to `getLastValue` for non-stacked series. Use this to anchor `<YLabel />` on the rendered stack head.
- `getLayerLastSnapshots(id)` → `{ layerIndex, time, value, color }[] | null` — per-layer last points, each at its own `time`. Returns `null` for single-layer series. Use when rendering last-mode overlays on ragged multi-layer streams.
- `setSeriesVisible(id, visible)`, `setLayerVisible(id, layer, visible)` — series toggling.
- `setTheme(theme)`, `setAxis(config)`, `setPadding(padding)`, `setGrid(on)` — post-mount configuration.
- `getSeriesIds()`, `getSeriesIdsByType(type, { visibleOnly?, singleLayerOnly? })`, `getSeriesType(id)`, `getSeriesColor(id)`, `getSeriesLabel(id)`, `getSeriesLayers(id)` — introspection. `getSeriesIdsByType` partitions by `'pie'` / `'time'` and is visibility/layer-aware via opts.

For **reactive** reads of common state, prefer the built-in hooks/composables/stores (`useVisibleRange`, `useYRange`, `useLastYValue`, `usePreviousClose`, `useCrosshairPosition` / Svelte `create*` equivalents) — they subscribe to the right chart events and update automatically.

## Events

`ChartInstance` extends an `EventEmitter`. Subscribe with `chart.on(name, fn)` / `chart.off(name, fn)`.

- `crosshairMove(pos | null)` — cursor enters/moves/leaves the chart.
- `viewportChange()` — pan, zoom, resize; useful for overlays that position by pixel (Y-axis badges).
- `dataUpdate()` — data mutated.
- `seriesChange()` — series added or removed.
- `overlayChange()` — **superset of the above** plus visibility toggles, series-option changes, and `setTheme`. Fires whenever the output of an overlay component (`InfoBar`, `Tooltip`, `Legend`, `YLabel`, `PieLegend`, `PieTooltip`) might change. Overlay code should subscribe to this single event instead of stacking `dataUpdate` + `seriesChange`.

## Snapshot helpers for custom overlays

Exported from each framework package (`@wick-charts/react | vue | svelte`) alongside the types they return:

- `buildHoverSnapshots(chart, { time, sort?, cacheKey })` — snapshot every visible series (and every visible layer of multi-layer series) at a given time. Used by hover overlays (`Tooltip`, `InfoBar` in hover mode).
- `buildLastSnapshots(chart, { sort?, cacheKey })` — snapshot every visible series at its own last point. Ragged multi-layer streams get one snapshot per layer, each at its own `time`.

Both return a **deeply frozen** `readonly SeriesSnapshot[]`. Each row carries:

- `id` — row key (guaranteed unique in the array; for a multi-layer series it's `${seriesId}_layer${layerIndex}`).
- `seriesId` — owning series identity (never carries a layer suffix; use for filtering/grouping).
- `layerIndex?` — layer within a multi-layer series, `undefined` for single-layer rows.
- `label?`, `color`, `data` — visual/content payload. `data` is a frozen clone of the chart's internal point, so a consumer can't mutate the store.

Calls with the same `(time, sort, cacheKey)` return the **same reference** while `chart.getOverlayVersion()` is unchanged. That makes `React.memo((a, b) => a.snapshots === b.snapshots)` / Vue `computed` / Svelte `$:` skip renders on crosshair moves that stay within one data point.

Pass **distinct `cacheKey`** values when multiple overlays read simultaneously (e.g. `'tooltip'` and `'infobar-hover'`) so they don't invalidate each other.

## Tooltip positioning

`computeTooltipPosition({ x, y, chartWidth, chartHeight, tooltipWidth, tooltipHeight, offsetX?, offsetY? })` returns `{ left, top }` with flip-when-overflow + clamp behavior. Use this when you render a floating tooltip container yourself instead of extending the built-in one.
