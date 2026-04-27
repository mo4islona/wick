# Wick Charts

[![codecov](https://codecov.io/gh/mo4islona/wick-charts/branch/main/graph/badge.svg)](https://codecov.io/gh/mo4islona/wick-charts) [![license](https://img.shields.io/github/license/mo4islona/wick-charts.svg)](./LICENSE)
<!-- @only:react -->
[![npm @wick-charts/react](https://img.shields.io/npm/v/@wick-charts/react.svg?label=%40wick-charts%2Freact)](https://www.npmjs.com/package/@wick-charts/react)
<!-- @/only -->
<!-- @only:vue -->
[![npm @wick-charts/vue](https://img.shields.io/npm/v/@wick-charts/vue.svg?label=%40wick-charts%2Fvue)](https://www.npmjs.com/package/@wick-charts/vue)
<!-- @/only -->
<!-- @only:svelte -->
[![npm @wick-charts/svelte](https://img.shields.io/npm/v/@wick-charts/svelte.svg?label=%40wick-charts%2Fsvelte)](https://www.npmjs.com/package/@wick-charts/svelte)
<!-- @/only -->

High-performance timeseries charts for **React**, **Vue**, and **Svelte**. Canvas-rendered, tree-shakeable, zero runtime dependencies.

[Live Demo](https://mo4islona.github.io/wick-charts/) · [Docs](https://mo4islona.github.io/wick-charts/#/api/chart-container)

## Features

- **Candlestick, Line, Bar, Pie, Sparkline** — all from one package
- **Real-time streaming** — append/update at 60fps with coordinated animations
- **22 built-in themes** plus `createTheme()` for custom palettes
- **Interactive** — zoom, pan, crosshair, tooltips
- **Stacking** — normal and percent modes for line/bar
- **Custom-render slots** — keep the built-in positioning, replace the contents
- **Tree-shakeable** — import only what you use
- **Zero runtime dependencies** — just your framework

## Install

<!-- @install -->
```bash
npm install @wick-charts/react   # React
npm install @wick-charts/vue     # Vue
npm install @wick-charts/svelte  # Svelte
```
<!-- @/install -->

## Quick Start

<!-- @fw:react -->
```tsx
import {
  ChartContainer, CandlestickSeries, Tooltip,
  Crosshair, YAxis, TimeAxis
} from '@wick-charts/react';

function Chart({ data }) {
  return (
    <ChartContainer>
      <CandlestickSeries data={data} />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}
```
<!-- @/fw -->
<!-- @fw:vue -->
```vue
<script setup>
import {
  ChartContainer, CandlestickSeries, Tooltip,
  Crosshair, YAxis, TimeAxis
} from '@wick-charts/vue';

const props = defineProps(['data']);
</script>

<template>
  <ChartContainer>
    <CandlestickSeries :data="props.data" />
    <Tooltip />
    <Crosshair />
    <YAxis />
    <TimeAxis />
  </ChartContainer>
</template>
```
<!-- @/fw -->
<!-- @fw:svelte -->
```svelte
<script>
  import {
    ChartContainer, CandlestickSeries, Tooltip,
    Crosshair, YAxis, TimeAxis
  } from '@wick-charts/svelte';

  export let data = [];
</script>

<ChartContainer>
  <CandlestickSeries {data} />
  <Tooltip />
  <Crosshair />
  <YAxis />
  <TimeAxis />
</ChartContainer>
```
<!-- @/fw -->

## API

Every component, prop, type, and slot context lives in the docs site:

[mo4islona.github.io/wick-charts/#/api/chart-container](https://mo4islona.github.io/wick-charts/#/api/chart-container)

Start there for [ChartContainer](https://mo4islona.github.io/wick-charts/#/api/chart-container), then drill into the series ([Candlestick](https://mo4islona.github.io/wick-charts/#/api/candlestick-series), [Line](https://mo4islona.github.io/wick-charts/#/api/line-series), [Bar](https://mo4islona.github.io/wick-charts/#/api/bar-series), [Pie](https://mo4islona.github.io/wick-charts/#/api/pie-series), [Sparkline](https://mo4islona.github.io/wick-charts/#/api/sparkline)) and overlays ([Tooltip](https://mo4islona.github.io/wick-charts/#/api/tooltip), [InfoBar](https://mo4islona.github.io/wick-charts/#/api/info-bar), [Crosshair](https://mo4islona.github.io/wick-charts/#/api/crosshair), [Legend](https://mo4islona.github.io/wick-charts/#/api/legend), [YAxis](https://mo4islona.github.io/wick-charts/#/api/y-axis), [XAxis](https://mo4islona.github.io/wick-charts/#/api/x-axis), [Navigator](https://mo4islona.github.io/wick-charts/#/api/navigator), …).

## Bundle size

Tree-shaken React scenarios via `pnpm size` (esbuild, minified, browser target, React/ReactDOM external):

| Scenario | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| Candlestick only | 147 KB | 44 KB | 38 KB |
| Line only        | 147 KB | 44 KB | 38 KB |
| Full React       | 164 KB | 49 KB | 41 KB |

## Migration

Upgrading across versions? See [MIGRATION.md](./MIGRATION.md) for per-version breaking-change notes and code snippets.

## License

MIT
