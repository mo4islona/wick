---
name: wick-charts
description: Build charts with Wick Charts library. Use when creating candlestick, line, bar, or pie charts in React, Vue, or Svelte.
---

# Wick Charts

Canvas-based charting library for React, Vue 3, and Svelte.

## Packages

- `@wick-charts/react` — components + hooks + `ThemeProvider`
- `@wick-charts/vue` — components + composables
- `@wick-charts/svelte` — components + stores

Core components (`ChartContainer`, all `*Series`, `Tooltip`, `InfoBar`, `Title`, `Crosshair`, axes, `YLabel`, `Legend`, `PieTooltip`, `PieLegend`) exist in every framework with matching semantics — syntax differs only where the host framework forces it (`:prop` / `{prop}`).

Framework-specific gaps to know about:

- **React** has the richest surface: `ThemeProvider`, `Sparkline`, and several hooks (`useChartInstance`, `useVisibleRange`, `useYRange`, `useLastYValue`, `usePreviousClose`, `useCrosshairPosition`, `useTheme`). `ChartContainer` accepts `padding`, `gradient`, `grid`, `interactive`, `style`, `className`.
- **Vue** and **Svelte** `ChartContainer` currently accept only `theme` + `axis` (+ `style` in Svelte); `padding`/`gradient`/`grid`/`interactive` props are React-only for now.

## Chart types (reference pages)

- [Candlestick](candlestick.md) — OHLCV with volume bars
- [Line / Area](line.md) — multi-layer, stacking, area, pulse
- [Bar / Histogram](bar.md) — multi-layer, stacking
- [Pie / Donut](pie.md) — `innerRadiusRatio`, hover animation
- [Sparkline](sparkline.md) — inline mini-chart + value label (React only)

## ChartContainer

Root component. Requires a defined width + height.

```tsx
<ChartContainer
  theme={catppuccin.theme}
  axis={{ y: { min: 0, max: 'auto' }, x: { visible: true } }}
  padding={{ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } }}
  gradient grid={{ visible: true }} interactive
  headerLayout="overlay"
  style={{ width: '100%', height: 400 }}
>
  {/* series + overlays */}
</ChartContainer>
```

React props: `theme`, `axis`, `padding`, `gradient`, `grid`, `interactive`, `headerLayout`, `style`, `className` (all optional, safe defaults). `padding.top|bottom` are pixels; `padding.left|right` accept pixels **or** `{ intervals: N }` for N empty data slots. `grid` is `{ visible: boolean }` — pass `grid={{ visible: false }}` to hide. `axis.y` / `axis.x` accept `width` / `height` respectively for axis gutter sizing. `headerLayout` is `'overlay' | 'inline'` — defaults to `'overlay'` (Title / InfoBar float above the canvas with their height folded into `padding.top`); `'inline'` pushes them into the vertical flow instead.

Vue / Svelte props (current subset): `theme`, `axis` (+ `style` in Svelte). `padding`/`gradient`/`grid`/`interactive` are React-only at the moment — use the sensible defaults on Vue and Svelte, or size via the wrapping element.

`AxisBound` = `'auto' | number | "+10%" | ((values: number[]) => number)`.

## UI overlay components

Placed as children of `ChartContainer`.

| Component | Props | Slot ctx | Notes |
|---|---|---|---|
| `Title` | `children`, `sub?` | — | Title bar, hoisted above canvas |
| `InfoBar` | `sort?`, `format?` | `{ snapshots, time, isHover }` | OHLC / values info bar, hoisted above canvas |
| `Tooltip` | `sort?`, `format?` | `{ snapshots, time }` | Floating glass tooltip near cursor (hover only) |
| `Legend` | `items?`, `position?: 'bottom'\|'right'`, `mode?: 'toggle'\|'isolate'` | `{ items: LegendItem[] }` | Series legend, hoisted below / beside canvas |
| `Crosshair` | — | — | Axis labels at cursor |
| `YAxis` | `format?` | — | Vertical tick axis |
| `TimeAxis` (alias `XAxis`) | — | — | Horizontal time axis |
| `YLabel` | `seriesId?`, `color?`, `format?` | `{ value, y, bgColor, isLive, direction, format }` | Floating price badge + dashed line |
| `PieTooltip` | `seriesId?`, `format?` | `{ info, format }` | Pie hover tooltip |
| `PieLegend` | `seriesId?`, `mode?: 'value'\|'percent'`, `format?: (v) => string` | `{ slices, mode, format }` | Pie slice list (function formatter only) |
| `NumberFlow` | `value`, `format?`, `spinDuration?` | — | Standalone animated number |

`seriesId` is optional on `YLabel` / `PieTooltip` / `PieLegend` — omit it on single-series charts and the first compatible visible series is picked automatically (time-series for `YLabel`, pie for `PieTooltip` / `PieLegend`). `InfoBar` and `Tooltip` are **always multi-series**; there is no `seriesId` prop. Filter inside the slot if you need a subset.

**Number formatting**: every overlay that displays a number accepts a `format` prop. On `Tooltip` / `InfoBar` the signature is `(value, field) => string` with `field ∈ {'open','high','low','close','volume','value'}`; elsewhere it's `(value) => string`. Two shared helpers — `formatCompact` (K/M/B/T) and `formatPriceAdaptive` (full precision, keeps sub-cent decimals) — are exported from every framework package and used as defaults.

**Hoisting**: `Title` + `InfoBar` render as absolute overlays stacked at the top of the canvas block — the canvas (and the background grid) spans the full container height behind them, while their measured height is folded into `padding.top` so series data stays below. Floating `Tooltip` stacks *above* Title / InfoBar so it reads clearly when the cursor hovers near the header. `Legend` sits as a flex sibling below (or beside, with `position="right"`). Clicking an item toggles its series/layer visibility (`mode="toggle"` adds to a hidden set; `mode="isolate"` isolates that item and a second click restores all).

`Tooltip` is **floating-only**. For the top info bar, use `<InfoBar>` — the two are complementary and usually composed together.

## Themes

Dark: `catppuccin` (default), `dracula`, `oneDarkPro`, `monokaiPro`, `nightOwl`, `materialPalenight`, `gruvbox`, `ayuMirage`, `panda`, `andromeda`, `highContrast`, `handwritten`.

Light: `githubLight`, `solarizedLight`, `rosePineDawn`, `quietLight`, `lavenderMist`, `mintBreeze`, `sandDune`, `peachCream`, `minimalLight`, `lightPink`.

Each theme is a named export (tree-shakable). Custom:

```ts
import { createTheme, dracula } from '@wick-charts/react';

const custom = createTheme({
  background: '#0f172a', // only required field; rest auto-derived
  candlestick: {
    up: { body: '#10b981' }, // or `body: autoGradient('#10b981')` for a subtle vertical lift
    down: { body: '#ef4444' },
  },
  seriesColors: ['#3b82f6', '#8b5cf6', '#ec4899'],
});
const preset = dracula; // { name, theme, dark, fontUrl: string | null, backgroundImage?, backgroundSize? }
```

React also has `<ThemeProvider value={theme}>` for global theming.

## Reactive accessors

Same concepts across frameworks (React hooks → Vue composables → Svelte stores):

- `useChartInstance()` / `getChartContext()` — the `ChartInstance`
- `useVisibleRange(chart)` — `{ from, to }`
- `useYRange(chart)` — `{ min, max }`
- `useLastYValue(chart, seriesId)` — `{ value, isLive } | null`
- `usePreviousClose(chart, seriesId)` — `number | null`
- `useCrosshairPosition(chart)` — `{ mediaX, mediaY, time, y } | null`
- `useTheme()` / `getThemeContext()` — `ChartTheme`

React/Vue return plain values / refs; Svelte returns `Readable<T>` — read with `$store`.

## Multi-series overlay

Pass a stable `id` prop to the series. Reuse it on overlays that target a *specific* series (`YLabel`, `PieTooltip`, `PieLegend`) when you have multiple. `InfoBar` and `Tooltip` render every visible series automatically — no prop.

```tsx
const candleId = 'btc-ohlc';

<ChartContainer theme={catppuccin.theme}>
  <Title sub="BTC · 1h">BTC/USD</Title>
  <InfoBar />
  <CandlestickSeries id={candleId} data={ohlc} />
  <LineSeries data={[sma]} options={{ colors: ['#ffd700'], strokeWidth: 1, label: 'SMA 20' }} />
  <Tooltip />
  <Crosshair />
  <YAxis />
  <TimeAxis />
  <YLabel seriesId={candleId} />
</ChartContainer>
```

## Custom render (slots / render-props)

Every overlay accepts a slot that replaces its *contents* with your own DOM. Positioning, crosshair wiring, and data computation stay in the library — you get the already-computed snapshots / items / info.

React uses a function-child render-prop; Vue uses a default scoped slot; Svelte uses a slot with `let:` destructuring. The context object is identical across frameworks (see the "Slot ctx" column in the overlay table above).

```tsx
// React — filter two of five series and pick your own layout
<Tooltip>
  {({ snapshots, time }) => (
    <div>
      <small>{new Date(time).toLocaleTimeString()}</small>
      {snapshots
        .filter((s) => s.seriesId === 'btc' || s.seriesId === 'eth')
        .map((s) => (
          <div key={s.id} style={{ color: s.color }}>
            {s.label}: {s.data.close ?? s.data.value}
          </div>
        ))}
    </div>
  )}
</Tooltip>
```

```vue
<!-- Vue — same context, different syntax -->
<Tooltip v-slot="{ snapshots, time }">
  <div>
    <small>{{ new Date(time).toLocaleTimeString() }}</small>
    <div v-for="s in snapshots.filter((x) => x.seriesId === 'btc' || x.seriesId === 'eth')" :key="s.id" :style="{ color: s.color }">
      {{ s.label }}: {{ s.data.close ?? s.data.value }}
    </div>
  </div>
</Tooltip>
```

```svelte
<!-- Svelte — let:-bindings expose slot props -->
<Tooltip let:snapshots let:time>
  <small>{new Date(time).toLocaleTimeString()}</small>
  {#each snapshots.filter((s) => s.seriesId === 'btc' || s.seriesId === 'eth') as s (s.id)}
    <div style="color: {s.color}">{s.label}: {s.data.close ?? s.data.value}</div>
  {/each}
</Tooltip>
```

### Snapshot shape (`InfoBar` / `Tooltip` slot)

```ts
interface SeriesSnapshot {
  readonly id: string;          // unique row key (safe for React key / v-for / #each key)
  readonly seriesId: string;    // owning series id (NOT unique when layered)
  readonly layerIndex?: number; // only set on multi-layer rows
  readonly label?: string;
  readonly color: string;
  readonly data: OHLCData | TimePoint; // deep-frozen clone — safe to read, mutation throws
}
```

`InfoBar` additionally exposes `isHover` — `true` while the cursor is on the chart, `false` in last-mode. `Tooltip` is hover-only and renders `null` when no crosshair is active.

### `Legend` slot items

`{ items: LegendItem[] }` — each item carries `{ id, seriesId, layerIndex?, label, color, isDisabled, toggle(), isolate() }`. The `toggle` / `isolate` closures are bound to that specific item, so you can sort / filter / reorder the array in your renderer without breaking visibility wiring.

### `YLabel` / `PieLegend` / `PieTooltip` slots

- `YLabel` — `{ value, y, bgColor, isLive, direction: 'up' | 'down' | 'neutral', format }`. Position yourself using `y` (pixel Y of the badge anchor).
- `PieLegend` — `{ slices: readonly SliceInfo[], mode: 'value' | 'percent', format }`.
- `PieTooltip` — `{ info: HoverInfo, format }`. Positioning (flip / clamp) stays in the library.

### Performance

- `buildHoverSnapshots` / `buildLastSnapshots` return the **same reference** while `chart.getOverlayVersion()` is unchanged. `React.memo((a, b) => a.snapshots === b.snapshots)` / Vue `computed` / Svelte `$:` skip renders on crosshair moves that stay within one data point.
- Slot context does **not** include `crosshair.mediaX/Y` (those change every mousemove). Call `useCrosshairPosition(chart)` / `createCrosshairPosition(chart)` yourself if you need pixel coordinates.
- When you render your own floating container instead of using `Tooltip` / `PieTooltip`, use `computeTooltipPosition({ x, y, chartWidth, chartHeight, tooltipWidth, tooltipHeight, offsetX?, offsetY? })` from `@wick-charts/react | vue | svelte` for flip + clamp behavior.

## Migration

Per-version breaking-change notes and code snippets live in the root [MIGRATION.md](../../../MIGRATION.md). Headline for 0.1 → 0.2: `seriesId` removed from `InfoBar` / `Tooltip` (filter in the slot instead); optional on `YLabel` / `PieTooltip` / `PieLegend` (auto-picks first visible compatible series).

## Realtime updates

Pass a new `data` array reference when data changes (e.g. via immutable state updates in React — the series components compare references in hook deps, so mutating in place won't re-render). The library diffs internally: same-length → updates last, +1..5 → incremental append, otherwise → full replace.

## Critical rules

- `time` is milliseconds (`Date.now()`-style). `TimePointInput` / `OHLCInput` also accept `Date`.
- `TimePoint` is canonical; `LineData` is a deprecated alias.
- `LineSeries` / `BarSeries` `data` is always `TimePoint[][]` — wrap single datasets as `[myData]`.
- `PieSeries` `data` is flat `PieSliceData[]`.
