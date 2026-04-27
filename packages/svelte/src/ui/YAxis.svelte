<script lang="ts">
import { type ChartInstance, resolveAxisFontSize, resolveAxisTextColor, type ValueFormatter } from '@wick-charts/core';
import { onDestroy } from 'svelte';

import { getChartContext } from '../context';
import { createYRange } from '../stores';

/** Custom tick-label formatter. Overrides the built-in range-adaptive default. */
export let format: ValueFormatter | undefined = undefined;
/**
 * Desired number of labels (≥ 2). Overrides any chart-level `axis.y.labelCount`.
 * Realized count may differ ±1 after the 1-2-5 snap.
 */
export let labelCount: number | undefined = undefined;
/** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
export let minLabelSpacing: number | undefined = undefined;

interface TrackedTick {
  opacity: number;
  addedAt: number;
}

const chartStore = getChartContext();
const tickMap = new Map<number, TrackedTick>();

let yRangeUnsub: (() => void) | null = null;
let allTicks: [number, TrackedTick][] = [];

$: {
  const chart = $chartStore;
  if (chart && !yRangeUnsub) {
    const yRangeStore = createYRange(chart);
    yRangeUnsub = yRangeStore.subscribe(() => {
      updateTicks(chart);
    });
  }
}

function updateTicks(chart: ChartInstance) {
  const currentTicks = chart.yScale.niceTickValues();
  const currentSet = new Set(currentTicks);
  const now = performance.now();

  for (const p of currentTicks) {
    if (!tickMap.has(p)) {
      tickMap.set(p, { opacity: 1, addedAt: now });
    } else {
      tickMap.get(p)!.opacity = 1;
    }
  }

  for (const [p, entry] of tickMap) {
    if (!currentSet.has(p)) {
      entry.opacity = 0;
    }
  }

  for (const [p, entry] of tickMap) {
    if (entry.opacity === 0 && now - entry.addedAt > 5000) {
      tickMap.delete(p);
    }
  }

  allTicks = Array.from(tickMap.entries());
}

onDestroy(() => {
  yRangeUnsub?.();
});

$: chart = $chartStore;
$: theme = chart?.getTheme();

// Route the formatter through yScale so Crosshair / YLabel fallback use
// the same function as the axis labels.
$: if (chart) {
  chart.yScale.setFormat(format ?? null);
}
onDestroy(() => {
  $chartStore?.yScale.setFormat(null);
});

// Hold a stable reference to the chart so onDestroy still has it when the
// parent ChartContainer's onDestroy has already cleared the store.
let densityChart: typeof chart = null;
$: if (chart) {
  densityChart = chart;
  chart.setYAxisLabelDensity({
    labelCount: labelCount ?? null,
    minLabelSpacing: minLabelSpacing ?? null,
  });
}
onDestroy(() => {
  densityChart?.setYAxisLabelDensity({ labelCount: null, minLabelSpacing: null });
});
</script>

{#if chart && theme}
  <div
    style="position:absolute;right:0;top:0;bottom:{chart.xAxisHeight}px;width:{chart.yAxisWidth}px;pointer-events:none;"
  >
    {#each allTicks as [price, entry] (price)}
      <span
        style="position:absolute;right:8px;top:{chart.yScale.valueToY(price)}px;transform:translateY(-50%);color:{resolveAxisTextColor(theme, 'y')};font-size:{resolveAxisFontSize(theme, 'y')}px;font-family:{theme.typography.fontFamily};font-variant-numeric:tabular-nums;user-select:none;opacity:{entry.opacity};transition:opacity 0.25s ease;will-change:opacity;"
      >
        {chart.yScale.formatY(price)}
      </span>
    {/each}
  </div>
{/if}
