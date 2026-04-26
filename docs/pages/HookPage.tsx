// Hook documentation. Hooks aren't in the auto-generated manifest (the
// extractor walks prop interfaces, not function signatures) — they're
// hand-authored here. Each hook has a single shared description but
// per-framework name / signature / example so a Vue or Svelte reader sees
// the right import and call shape.
//
// Routes stay React-named (`hooks/use-chart-instance`) so deep links remain
// stable when a user switches the framework selector — only the visible
// label, signature, and example change.

import type { ChartTheme } from '@wick-charts/react';

import { Markdown } from '../components/Markdown';
import { HighlightedCode } from '../components/playground/CodeView';
import { useFramework } from '../context/framework';

interface FrameworkHook {
  name: string;
  signature: string;
  example?: string;
}

interface HookEntry {
  /** Shared across frameworks; only names + signatures + examples differ. */
  description: string;
  react: FrameworkHook;
  vue: FrameworkHook;
  svelte: FrameworkHook;
}

const HOOKS: Record<string, HookEntry> = {
  useChartInstance: {
    description:
      'Returns the underlying `ChartInstance` for the surrounding `<ChartContainer>`. Use this to call imperative methods (e.g. `addLineSeries`, `setSeriesData`, `resetZoom`) from inside child components. Must be called from a component rendered inside a `<ChartContainer>` — calling it outside throws.',
    react: {
      name: 'useChartInstance',
      signature: '() => ChartInstance',
      example: `import { useChartInstance } from '@wick-charts/react';

function ResetButton() {
  const chart = useChartInstance();

  return <button onClick={() => chart.resetZoom()}>Reset</button>;
}`,
    },
    vue: {
      name: 'useChartInstance',
      signature: '() => ChartInstance',
      example: `<script setup lang="ts">
import { useChartInstance } from '@wick-charts/vue';

const chart = useChartInstance();
</script>

<template>
  <button @click="chart.resetZoom()">Reset</button>
</template>`,
    },
    svelte: {
      name: 'getChartContext',
      signature: '() => Readable<ChartInstance>',
      example: `<script lang="ts">
  import { getChartContext } from '@wick-charts/svelte';

  const chart = getChartContext();
</script>

<button on:click={() => $chart.resetZoom()}>Reset</button>`,
    },
  },

  useTheme: {
    description:
      'Reads the current `ChartTheme` from the surrounding theme context. Use this when authoring custom render-props / slots (Tooltip, InfoBar, Legend) so your overlay matches the active theme.',
    react: {
      name: 'useTheme',
      signature: '() => ChartTheme',
      example: `import { useTheme } from '@wick-charts/react';

function MyOverlay() {
  const theme = useTheme();

  return <div style={{ background: theme.tooltip.background }}>…</div>;
}`,
    },
    vue: {
      name: 'useTheme',
      signature: '() => ChartTheme',
      example: `<script setup lang="ts">
import { useTheme } from '@wick-charts/vue';

const theme = useTheme();
</script>

<template>
  <div :style="{ background: theme.tooltip.background }">…</div>
</template>`,
    },
    svelte: {
      name: 'getThemeContext',
      signature: '() => Readable<ChartTheme>',
      example: `<script lang="ts">
  import { getThemeContext } from '@wick-charts/svelte';

  const theme = getThemeContext();
</script>

<div style="background: {$theme.tooltip.background}">…</div>`,
    },
  },

  useCrosshairPosition: {
    description:
      'Subscribes to crosshair updates. Returns `{ time, x, y, distance }` while the user is hovering the chart, or `null` when no hover is active. Re-renders only when the crosshair changes — safe to use in heavy custom overlays.',
    react: {
      name: 'useCrosshairPosition',
      signature: '(chart: ChartInstance) => CrosshairPosition | null',
      example: `import { useChartInstance, useCrosshairPosition } from '@wick-charts/react';

function HoverReadout() {
  const chart = useChartInstance();
  const pos = useCrosshairPosition(chart);
  if (!pos) return null;

  return <span>t = {new Date(pos.time).toISOString()}, y = {pos.y.toFixed(2)}</span>;
}`,
    },
    vue: {
      name: 'useCrosshairPosition',
      signature: '(chart: ChartInstance) => Ref<CrosshairPosition | null>',
      example: `<script setup lang="ts">
import { useChartInstance, useCrosshairPosition } from '@wick-charts/vue';

const chart = useChartInstance();
const pos = useCrosshairPosition(chart);
</script>

<template>
  <span v-if="pos">
    t = {{ new Date(pos.time).toISOString() }}, y = {{ pos.y.toFixed(2) }}
  </span>
</template>`,
    },
    svelte: {
      name: 'createCrosshairPosition',
      signature: '(chart: ChartInstance) => Readable<CrosshairPosition | null>',
      example: `<script lang="ts">
  import { createCrosshairPosition, getChartContext } from '@wick-charts/svelte';
  import { get } from 'svelte/store';

  const chart = get(getChartContext());
  const pos = createCrosshairPosition(chart);
</script>

{#if $pos}
  <span>t = {new Date($pos.time).toISOString()}, y = {$pos.y.toFixed(2)}</span>
{/if}`,
    },
  },

  useLastYValue: {
    description:
      'Reactive snapshot of the most-recent Y value for a series. Tracks the smoothed value used by `<YLabel>`, so values animate consistently with the price badge.',
    react: {
      name: 'useLastYValue',
      signature: '(chart: ChartInstance, seriesId: string) => number | null',
      example: `import { useChartInstance, useLastYValue } from '@wick-charts/react';

function PriceBadge({ seriesId }: { seriesId: string }) {
  const chart = useChartInstance();
  const last = useLastYValue(chart, seriesId);
  if (last === null) return null;

  return <span className="badge">\${last.toFixed(2)}</span>;
}`,
    },
    vue: {
      name: 'useLastYValue',
      signature: '(chart: ChartInstance, seriesId: string) => Ref<number | null>',
      example: `<script setup lang="ts">
import { useChartInstance, useLastYValue } from '@wick-charts/vue';

const props = defineProps<{ seriesId: string }>();
const chart = useChartInstance();
const last = useLastYValue(chart, props.seriesId);
</script>

<template>
  <span v-if="last !== null" class="badge">\${{ last.toFixed(2) }}</span>
</template>`,
    },
    svelte: {
      name: 'createLastYValue',
      signature: '(chart: ChartInstance, seriesId: string) => Readable<number | null>',
      example: `<script lang="ts">
  import { createLastYValue, getChartContext } from '@wick-charts/svelte';
  import { get } from 'svelte/store';

  export let seriesId: string;
  const chart = get(getChartContext());
  const last = createLastYValue(chart, seriesId);
</script>

{#if $last !== null}
  <span class="badge">\${$last.toFixed(2)}</span>
{/if}`,
    },
  },

  usePreviousClose: {
    description:
      'Returns the previous-session close for a series, when one is set on the chart. Useful for building custom "% change" overlays that match the built-in `<InfoBar>`.',
    react: {
      name: 'usePreviousClose',
      signature: '(chart: ChartInstance, seriesId: string) => number | null',
      example: `import { useChartInstance, useLastYValue, usePreviousClose } from '@wick-charts/react';

function ChangePill({ seriesId }: { seriesId: string }) {
  const chart = useChartInstance();
  const last = useLastYValue(chart, seriesId);
  const prev = usePreviousClose(chart, seriesId);
  if (last === null || prev === null) return null;

  const pct = ((last - prev) / prev) * 100;

  return <span style={{ color: pct >= 0 ? 'limegreen' : 'tomato' }}>{pct.toFixed(2)}%</span>;
}`,
    },
    vue: {
      name: 'usePreviousClose',
      signature: '(chart: ChartInstance, seriesId: string) => Ref<number | null>',
      example: `<script setup lang="ts">
import { computed } from 'vue';
import { useChartInstance, useLastYValue, usePreviousClose } from '@wick-charts/vue';

const props = defineProps<{ seriesId: string }>();
const chart = useChartInstance();
const last = useLastYValue(chart, props.seriesId);
const prev = usePreviousClose(chart, props.seriesId);

const pct = computed(() => {
  if (last.value === null || prev.value === null) return null;

  return ((last.value - prev.value) / prev.value) * 100;
});
</script>

<template>
  <span v-if="pct !== null" :style="{ color: pct >= 0 ? 'limegreen' : 'tomato' }">
    {{ pct.toFixed(2) }}%
  </span>
</template>`,
    },
    svelte: {
      name: 'createPreviousClose',
      signature: '(chart: ChartInstance, seriesId: string) => Readable<number | null>',
      example: `<script lang="ts">
  import { createLastYValue, createPreviousClose, getChartContext } from '@wick-charts/svelte';
  import { derived, get } from 'svelte/store';

  export let seriesId: string;
  const chart = get(getChartContext());
  const last = createLastYValue(chart, seriesId);
  const prev = createPreviousClose(chart, seriesId);
  const pct = derived([last, prev], ([$l, $p]) =>
    $l === null || $p === null ? null : (($l - $p) / $p) * 100,
  );
</script>

{#if $pct !== null}
  <span style="color: {$pct >= 0 ? 'limegreen' : 'tomato'}">
    {$pct.toFixed(2)}%
  </span>
{/if}`,
    },
  },

  useVisibleRange: {
    description:
      "Subscribes to viewport changes. Returns the visible time range `{ start, end }` of the chart. Use this to drive secondary visualisations (mini-maps, range-aware fetchers) that should track the user's pan/zoom.",
    react: {
      name: 'useVisibleRange',
      signature: '(chart: ChartInstance) => VisibleRange',
      example: `import { useEffect } from 'react';
import { useChartInstance, useVisibleRange } from '@wick-charts/react';

function RangeFetcher({ onRangeChange }: { onRangeChange: (start: number, end: number) => void }) {
  const chart = useChartInstance();
  const { start, end } = useVisibleRange(chart);

  useEffect(() => {
    onRangeChange(start, end);
  }, [start, end, onRangeChange]);

  return null;
}`,
    },
    vue: {
      name: 'useVisibleRange',
      signature: '(chart: ChartInstance) => Ref<VisibleRange>',
      example: `<script setup lang="ts">
import { watch } from 'vue';
import { useChartInstance, useVisibleRange } from '@wick-charts/vue';

const emit = defineEmits<{ rangeChange: [start: number, end: number] }>();
const chart = useChartInstance();
const range = useVisibleRange(chart);

watch(range, ({ start, end }) => emit('rangeChange', start, end), { immediate: true });
</script>`,
    },
    svelte: {
      name: 'createVisibleRange',
      signature: '(chart: ChartInstance) => Readable<VisibleRange>',
      example: `<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { createVisibleRange, getChartContext } from '@wick-charts/svelte';
  import { get } from 'svelte/store';

  const dispatch = createEventDispatcher<{ rangeChange: { start: number; end: number } }>();
  const chart = get(getChartContext());
  const range = createVisibleRange(chart);

  $: dispatch('rangeChange', $range);
</script>`,
    },
  },

  useYRange: {
    description:
      'Subscribes to Y-axis range changes. Returns the current `{ min, max }` derived from visible data plus padding. Re-renders on every viewport recompute.',
    react: {
      name: 'useYRange',
      signature: '(chart: ChartInstance) => YRange',
      example: `import { useChartInstance, useYRange } from '@wick-charts/react';

function YRangeReadout() {
  const chart = useChartInstance();
  const { min, max } = useYRange(chart);

  return <span>{min.toFixed(2)} – {max.toFixed(2)}</span>;
}`,
    },
    vue: {
      name: 'useYRange',
      signature: '(chart: ChartInstance) => Ref<YRange>',
      example: `<script setup lang="ts">
import { useChartInstance, useYRange } from '@wick-charts/vue';

const chart = useChartInstance();
const range = useYRange(chart);
</script>

<template>
  <span>{{ range.min.toFixed(2) }} – {{ range.max.toFixed(2) }}</span>
</template>`,
    },
    svelte: {
      name: 'createYRange',
      signature: '(chart: ChartInstance) => Readable<YRange>',
      example: `<script lang="ts">
  import { createYRange, getChartContext } from '@wick-charts/svelte';
  import { get } from 'svelte/store';

  const chart = get(getChartContext());
  const range = createYRange(chart);
</script>

<span>{$range.min.toFixed(2)} – {$range.max.toFixed(2)}</span>`,
    },
  },
};

export function HookPage({ hookKey, theme }: { hookKey: string; theme: ChartTheme }) {
  const entry = HOOKS[hookKey];
  const [fw] = useFramework();

  if (!entry) {
    return (
      <div style={{ padding: 24, color: theme.tooltip.textColor }}>
        Hook <code>{hookKey}</code> not documented yet.
      </div>
    );
  }

  const variant = entry[fw];

  return (
    <div style={{ padding: '8px 20px 40px', maxWidth: 1080 }}>
      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{variant.name}</h2>

      <pre
        className="pg-code"
        style={{
          padding: '8px 12px',
          margin: '12px 0 12px',
          fontSize: 12,
          background: 'var(--code-bg, rgba(0,0,0,0.04))',
          border: `1px solid ${theme.tooltip.borderColor}`,
          borderRadius: 6,
          color: theme.tooltip.textColor,
        }}
      >
        <code>{`${variant.name}: ${variant.signature}`}</code>
      </pre>

      <Markdown source={entry.description} theme={theme} />

      {variant.example && (
        <>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '24px 0 8px', letterSpacing: '-0.01em' }}>Example</h3>
          <div style={{ marginTop: 8 }}>
            <HighlightedCode code={variant.example} theme={theme} />
          </div>
        </>
      )}
    </div>
  );
}
