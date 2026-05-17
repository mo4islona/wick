<script lang="ts">
import { type ChartInstance, mountAxisLabels } from '@wick-charts/core';
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';

import { getChartContext } from '../context';

/** Desired number of labels (≥ 2). Overrides chart-level `axis.x.labelCount`. */
export let labelCount: number | undefined = undefined;
/** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
export let minLabelSpacing: number | undefined = undefined;

const chart = get(getChartContext());

let container: HTMLDivElement | null = null;
let cleanup: (() => void) | null = null;

$: if (chart !== null) {
  chart.setTimeAxisLabelDensity({
    labelCount: labelCount ?? null,
    minLabelSpacing: minLabelSpacing ?? null,
  });
}

onMount(() => {
  if (chart === null || container === null) return;
  cleanup = mountAxisLabels({ chart: chart as ChartInstance, container, axis: 'x' });
});

onDestroy(() => {
  cleanup?.();
  cleanup = null;
  if (chart !== null) chart.setTimeAxisLabelDensity({ labelCount: null, minLabelSpacing: null });
});
</script>

{#if chart !== null}
  <div
    bind:this={container}
    style="position:absolute;left:0;bottom:0;right:{chart.yAxisWidth}px;height:{chart.xAxisHeight}px;pointer-events:none;display:flex;align-items:center;"
  />
{/if}
