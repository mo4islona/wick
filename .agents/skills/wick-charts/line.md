# Line / Area Chart

Time-series line chart with area gradient fill, multi-layer support, stacking modes, and animated pulsing dot.

## Data format

```ts
interface TimePoint {
  time: number;   // timestamp in milliseconds (Date.now() style)
  value: number;
}

// Also accepts Date objects for time:
type TimePointInput = Omit<TimePoint, 'time'> & { time: number | Date };
```

**Data prop is always `TimePoint[][]`** — an array of layers.

```ts
// Single line — wrap in array
data={[myData]}

// Multi-layer
data={[layer1, layer2, layer3]}
```

## Series options

```ts
interface LineSeriesOptions {
  label?: string;                          // tooltip display name
  colors: string[];                        // one color per layer — default: ['#2962FF']
  strokeWidth: number;                     // stroke width in px — default: 1
  area: { visible: boolean };              // gradient area under line — default: { visible: true }
  pulse: boolean;                          // animated dot at last point — default: true
  pulseMs?: number | false;                // pulse period; false disables — default: 600
  stacking: 'off' | 'normal' | 'percent';  // layer stacking — default: 'off'
  entryAnimation?: 'none' | 'grow' | 'fade'; // entrance style for new points — default: 'grow'
  entryMs?: number | false;                // entrance duration; false disables — default: 250
  smoothMs?: number | false;               // live-tracking smoothing for updateLastPoint — default: 250
}
```

All options are optional — pass `Partial<LineSeriesOptions>`.

> Prefer the chart-level animations API (`<ChartContainer animations={{ series: { line: { entry, smooth, pulse } } }}>`) for new code — it's the canonical surface and groups durations alongside axis / toggle timings. The per-series `entryMs` / `smoothMs` / `pulseMs` options still work and are the only place to set them per-series-instance. See [SKILL.md → Animations](SKILL.md).

## Options explained

### `colors`

One hex color per layer. If fewer colors than layers, layers cycle through the palette.

```ts
// Single line
options={{ colors: ['#00d4aa'] }}

// Three layers
options={{ colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'] }}
```

### `strokeWidth`

Stroke width in CSS pixels (scaled by device pixel ratio internally, min 1). Defaults to `1`. Same value applied to every layer.

```ts
options={{ strokeWidth: 2 }}
```

### `area`

When `area.visible` is `true`, a vertical gradient fills the area below each line:
- Top: line color at 12% opacity
- Bottom: line color at 1% opacity

Works with stacking — each layer fills down to the layer below it.

### `pulse`

Animated pulsing dot at the last data point. Useful for live data. Set `false` for historical/static charts.

### `stacking`

| Mode | Behavior |
|------|----------|
| `'off'` | Each layer rendered independently, overlapping |
| `'normal'` | Layers stack cumulatively — each layer's Y = sum of all layers below |
| `'percent'` | Like `'normal'` but normalized to 0–100% of total |

## Performance

Automatic decimation kicks in when visible data points exceed 2x pixel width. Data is reduced to 1.5x pixels while preserving min/max extremes.

## React

### Single line with area fill

```tsx
import { ChartContainer, LineSeries, Tooltip, Crosshair, YAxis, TimeAxis, dracula } from '@wick-charts/react';
import type { TimePoint } from '@wick-charts/react';

function LineChart({ data }: { data: TimePoint[] }) {
  return (
    <ChartContainer theme={dracula} style={{ width: '100%', height: 400 }}>
      <LineSeries
        data={[data]}
        options={{ colors: ['#00d4aa'], strokeWidth: 1, area: { visible: true }, pulse: true }}
      />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}
```

### Multi-layer with stacking

```tsx
import { ChartContainer, LineSeries, Tooltip, Legend } from '@wick-charts/react';

<ChartContainer style={{ width: '100%', height: 400 }}>
  <LineSeries
    data={[revenue, costs, profit]}
    options={{
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
      strokeWidth: 1,
      area: { visible: true },
      stacking: 'normal',
      label: 'Revenue',
    }}
  />
  <Tooltip sort="desc" />
  <Legend position="bottom" mode="toggle" />
</ChartContainer>
```

### Props

```ts
interface LineSeriesProps {
  data: TimePoint[][];                       // array of layers
  options?: Partial<LineSeriesOptions>;
  /** Stable series ID — reuse across overlays that target this series. */
  id?: string;
}
```

## Vue

### Single line

```vue
<script setup lang="ts">
import { ChartContainer, LineSeries, Tooltip, Crosshair, Legend, YAxis, TimeAxis, dracula } from '@wick-charts/vue';
import type { TimePoint } from '@wick-charts/vue';

const props = defineProps<{ data: TimePoint[] }>();
</script>

<template>
  <ChartContainer :theme="dracula" style="width: 100%; height: 400px">
    <LineSeries
      :data="[props.data]"
      :options="{ colors: ['#00d4aa'], strokeWidth: 1, area: { visible: true }, pulse: true }"
    />
    <Tooltip />
    <Crosshair />
    <YAxis />
    <TimeAxis />
  </ChartContainer>
</template>
```

### Multi-layer with stacking

```vue
<template>
  <ChartContainer style="width: 100%; height: 400px">
    <LineSeries
      :data="[revenue, costs, profit]"
      :options="{
        colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
        strokeWidth: 1,
        area: { visible: true },
        stacking: 'normal',
        label: 'Revenue',
      }"
    />
    <Tooltip sort="desc" />
    <Legend position="bottom" mode="toggle" />
  </ChartContainer>
</template>
```

### Props & Events

```ts
// Props
data: TimePoint[][]
options?: Partial<LineSeriesOptions>
/** Stable series ID — reuse across overlays that target this series. */
id?: string
```

## Svelte

### Single line

```svelte
<script>
  import { ChartContainer, LineSeries, Tooltip, Crosshair, Legend, YAxis, TimeAxis, dracula } from '@wick-charts/svelte';
  export let data = [];
</script>

<ChartContainer theme={dracula} style="width:100%;height:400px">
  <LineSeries
    data={[data]}
    options={{ colors: ['#00d4aa'], strokeWidth: 1, area: { visible: true }, pulse: true }}
  />
  <Tooltip />
  <Crosshair />
  <YAxis />
  <TimeAxis />
</ChartContainer>
```

### Multi-layer with stacking

```svelte
<ChartContainer style="width:100%;height:400px">
  <LineSeries
    data={[revenue, costs, profit]}
    options={{
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
      strokeWidth: 1,
      area: { visible: true },
      stacking: 'normal',
      label: 'Revenue',
    }}
  />
  <Tooltip sort="desc" />
  <Legend position="bottom" mode="toggle" />
</ChartContainer>
```

### Props

```ts
data: TimePoint[][]
options?: Partial<LineSeriesOptions>
/** Stable series ID — reuse across overlays that target this series. */
id?: string
```

## Typical overlay combinations

| Use case | Overlays |
|----------|----------|
| Simple line | `Tooltip`, `Crosshair`, `YAxis`, `TimeAxis` |
| Multi-layer | Add `Legend` with `position="bottom" mode="toggle"` |
| Dashboard sparkline-style | No overlays, `interactive={false}`, `grid={{ visible: false }}` |

## Custom tooltip: filter a subset of series

Wrap `Tooltip` with a render-prop to show only the series you care about — handy when the chart has five lines but the tooltip should read two:

```tsx
import { Tooltip } from '@wick-charts/react';

const FOCUS = new Set(['btc', 'eth']);

<Tooltip>
  {({ snapshots, time }) => (
    <div style={{ display: 'grid', gap: 4 }}>
      <small style={{ opacity: 0.6 }}>{new Date(time).toLocaleTimeString()}</small>
      {snapshots
        .filter((s) => FOCUS.has(s.seriesId))
        .map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: s.color }}>{s.label ?? s.seriesId}</span>
            <span>{('value' in s.data ? s.data.value : 0).toFixed(2)}</span>
          </div>
        ))}
    </div>
  )}
</Tooltip>
```

Same pattern in Vue (`<Tooltip v-slot="{ snapshots, time }">`) and Svelte (`<Tooltip let:snapshots let:time>`). For a multi-layer series, filter by `seriesId` (shared identity) and use `id` as the row key.

## Common patterns

### Line without area (pure line chart)

```ts
options={{ area: { visible: false }, pulse: false }}
```

### Percentage stacked area

```ts
options={{
  colors: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
  area: { visible: true },
  stacking: 'percent',
}}
```

### Thin overlay indicator on a candlestick chart

```ts
<LineSeries
  data={[smaData]}
  options={{ colors: ['#ffd700'], strokeWidth: 1, area: { visible: false }, pulse: false, label: 'SMA 20' }}
/>
```
