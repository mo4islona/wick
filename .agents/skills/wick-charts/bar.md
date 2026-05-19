# Bar / Histogram Chart

Time-series bar chart with multi-layer support, stacking modes, positive/negative color handling, and automatic zero-line.

## Data format

```ts
interface TimePoint {
  time: number;   // timestamp in milliseconds (Date.now() style)
  value: number;  // can be negative
}
```

**Data prop is always `TimePoint[][]`** — an array of layers.

```ts
// Single layer — wrap in array
data={[myData]}

// Multi-layer
data={[layer1, layer2, layer3]}
```

## Series options

```ts
interface BarSeriesOptions {
  label?: string;                          // tooltip display name
  colors: string[];                        // color palette — default: ['#26a69a', '#ef5350']
  barWidthRatio: number;                   // 0–1, bar width relative to interval — default: 0.6
  stacking: 'off' | 'normal' | 'percent';  // layer stacking — default: 'off'
  entryAnimation?: 'none' | 'fade' | 'grow' | 'slide' | 'fade-grow'; // default: 'fade-grow'
  entryMs?: number | false;                // entrance duration; false disables — default: 250
  smoothMs?: number | false;               // live-tracking smoothing for updateLastPoint — default: 250
}
```

All options are optional — pass `Partial<BarSeriesOptions>`.

> Prefer the chart-level animations API (`<ChartContainer animations={{ series: { bar: { entry, smooth } } }}>`) for new code — it's the canonical surface and groups durations alongside axis / toggle timings. The per-series `entryMs` / `smoothMs` options still work and are the only place to set them per-series-instance. See [SKILL.md → Animations](SKILL.md).

## Options explained

### `colors`

Color behavior depends on the number of layers:

**Single layer:** `colors[0]` = positive bars, `colors[1]` = negative bars.

```ts
// Green for positive, red for negative
options={{ colors: ['#26a69a', '#ef5350'] }}
```

**Multi-layer:** each layer gets its own color from the palette.

```ts
// Three layers, three colors
options={{ colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'] }}
```

### `barWidthRatio`

Fraction of the available interval width (0–1). At `0.6` (default), each bar takes 60% of the interval with 40% gap.

### `stacking`

| Mode | Behavior |
|------|----------|
| `'off'` | Tallest bar drawn first (behind), layers overlap. Supports negative values |
| `'normal'` | Layers stack cumulatively on top of each other |
| `'percent'` | Like `'normal'` but normalized to 0–100% of total |

### Zero line

A horizontal line at y=0 is automatically rendered when the dataset contains negative values. No configuration needed.

## React

### Single layer (histogram)

```tsx
import { ChartContainer, BarSeries, Tooltip, Crosshair, YAxis, TimeAxis } from '@wick-charts/react';
import type { TimePoint } from '@wick-charts/react';

function Histogram({ data }: { data: TimePoint[] }) {
  return (
    <ChartContainer style={{ width: '100%', height: 400 }}>
      <BarSeries
        data={[data]}
        options={{ colors: ['#26a69a', '#ef5350'], barWidthRatio: 0.6 }}
      />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}
```

### Multi-layer stacked

```tsx
import { ChartContainer, BarSeries, Tooltip, Legend, YAxis, TimeAxis } from '@wick-charts/react';

<ChartContainer style={{ width: '100%', height: 400 }}>
  <BarSeries
    data={[revenue, costs, profit]}
    options={{
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
      barWidthRatio: 0.6,
      stacking: 'normal',
    }}
  />
  <Tooltip />
  <YAxis />
  <TimeAxis />
  <Legend position="bottom" mode="toggle" />
</ChartContainer>
```

### Props

```ts
interface BarSeriesProps {
  data: TimePoint[][];
  options?: Partial<BarSeriesOptions>;
  /** Stable series ID — reuse across overlays that target this series. */
  id?: string;
}
```

## Vue

### Single layer

```vue
<script setup lang="ts">
import { ChartContainer, BarSeries, Tooltip, Crosshair, Legend, YAxis, TimeAxis } from '@wick-charts/vue';
import type { TimePoint } from '@wick-charts/vue';

const props = defineProps<{ data: TimePoint[] }>();
</script>

<template>
  <ChartContainer style="width: 100%; height: 400px">
    <BarSeries
      :data="[props.data]"
      :options="{ colors: ['#26a69a', '#ef5350'], barWidthRatio: 0.6 }"
    />
    <Tooltip />
    <Crosshair />
    <YAxis />
    <TimeAxis />
  </ChartContainer>
</template>
```

### Multi-layer stacked

```vue
<template>
  <ChartContainer style="width: 100%; height: 400px">
    <BarSeries
      :data="[revenue, costs, profit]"
      :options="{
        colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
        barWidthRatio: 0.6,
        stacking: 'normal',
      }"
    />
    <Tooltip />
    <YAxis />
    <TimeAxis />
    <Legend position="bottom" mode="toggle" />
  </ChartContainer>
</template>
```

### Props & Events

```ts
// Props
data: TimePoint[][]
options?: Partial<BarSeriesOptions>
/** Stable series ID — reuse across overlays that target this series. */
id?: string
```

## Svelte

### Single layer

```svelte
<script>
  import { ChartContainer, BarSeries, Tooltip, Crosshair, Legend, YAxis, TimeAxis } from '@wick-charts/svelte';
  export let data = [];
</script>

<ChartContainer style="width:100%;height:400px">
  <BarSeries
    data={[data]}
    options={{ colors: ['#26a69a', '#ef5350'], barWidthRatio: 0.6 }}
  />
  <Tooltip />
  <Crosshair />
  <YAxis />
  <TimeAxis />
</ChartContainer>
```

### Multi-layer stacked

```svelte
<ChartContainer style="width:100%;height:400px">
  <BarSeries
    data={[revenue, costs, profit]}
    options={{
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
      barWidthRatio: 0.6,
      stacking: 'normal',
    }}
  />
  <Tooltip />
  <YAxis />
  <TimeAxis />
  <Legend position="bottom" mode="toggle" />
</ChartContainer>
```

### Props

```ts
data: TimePoint[][]
options?: Partial<BarSeriesOptions>
/** Stable series ID — reuse across overlays that target this series. */
id?: string
```

## Custom tooltip

`Tooltip` accepts a slot / render-prop that hands you the computed snapshots — replace the default layout with your own:

```tsx
<Tooltip>
  {({ snapshots, time }) => (
    <div>
      <small>{new Date(time).toLocaleTimeString()}</small>
      {snapshots.map((s) => (
        <div key={s.id} style={{ color: s.color }}>
          {s.label ?? s.seriesId}: {('value' in s.data ? s.data.value : 0).toFixed(2)}
        </div>
      ))}
    </div>
  )}
</Tooltip>
```

Multi-layer stacked bars produce one snapshot per visible layer (each carrying `layerIndex`). Group by `seriesId` if you want stack totals in the tooltip.

## Common patterns

### Volume histogram (standalone)

```ts
// Convert OHLC volume to bar data
const volumeData: TimePoint[] = ohlcData.map(d => ({
  time: d.time,
  value: d.volume ?? 0,
}));

<BarSeries
  data={[volumeData]}
  options={{ colors: ['#26a69a', '#ef5350'], barWidthRatio: 0.8 }}
/>
```

### Percentage stacked bar

```ts
options={{
  colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
  stacking: 'percent',
}}
```

### MACD-style histogram with positive/negative

```ts
// Single layer — colors[0] for positive, colors[1] for negative
options={{
  colors: ['#26a69a', '#ef5350'],
  barWidthRatio: 0.4,
}}
```
