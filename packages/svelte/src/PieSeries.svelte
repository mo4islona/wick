<script lang="ts">
import type { PieSeriesOptions, PieSliceData } from '@wick-charts/core';
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';

import { getChartContext } from './context';

export let data: PieSliceData[];
export let options: Partial<PieSeriesOptions> | undefined = undefined;
/** Stable series ID — same value across remounts. */
export let id: string | undefined = undefined;

const chartStore = getChartContext();
let seriesId: string | null = null;

onMount(() => {
  const chart = get(chartStore);
  if (!chart) return;
  seriesId = chart.addPieSeries({ ...options, id });
});

onDestroy(() => {
  const chart = get(chartStore);
  if (seriesId && chart) chart.removeSeries(seriesId);
  seriesId = null;
});

$: {
  const chart = $chartStore;
  if (seriesId && chart && data.length > 0) {
    chart.setSeriesData(seriesId, data);
  }
}

$: {
  const chart = $chartStore;
  if (seriesId && chart && options) {
    chart.updateSeriesOptions(seriesId, options);
  }
}
</script>
