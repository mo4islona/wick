<script setup lang="ts">
import { type ValueFormatter, mountAxisLabels } from '@wick-charts/core';
import { onMounted, onUnmounted, ref, watch } from 'vue';

import { useChartInstance } from '../context';

const props = defineProps<{
  /** Custom tick-label formatter. Overrides the built-in range-adaptive default. */
  format?: ValueFormatter;
  /**
   * Desired number of labels (≥ 2). Overrides any chart-level `axis.y.labelCount`.
   * Realized count may differ ±1 after the 1-2-5 snap.
   */
  labelCount?: number;
  /** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
  minLabelSpacing?: number;
}>();

const chart = useChartInstance();
const containerRef = ref<HTMLDivElement | null>(null);

// Route the formatter through yScale so Crosshair / YLabel fallback use
// the same function as the axis labels.
const syncFormat = () => chart.yScale.setFormat(props.format ?? null);
onMounted(syncFormat);
watch(() => props.format, syncFormat);
onUnmounted(() => chart.yScale.setFormat(null));

const applyDensity = () => {
  chart.setYAxisLabelDensity({
    labelCount: props.labelCount ?? null,
    minLabelSpacing: props.minLabelSpacing ?? null,
  });
};
applyDensity();
watch(() => [props.labelCount, props.minLabelSpacing], applyDensity);
onUnmounted(() => chart.setYAxisLabelDensity({ labelCount: null, minLabelSpacing: null }));

let cleanup: (() => void) | null = null;
onMounted(() => {
  if (containerRef.value === null) return;
  cleanup = mountAxisLabels({ chart, container: containerRef.value, axis: 'y' });
});
onUnmounted(() => {
  cleanup?.();
  cleanup = null;
});
</script>

<template>
  <div
    ref="containerRef"
    :style="{
      position: 'absolute',
      right: '0',
      top: '0',
      bottom: chart.xAxisHeight + 'px',
      width: chart.yAxisWidth + 'px',
      pointerEvents: 'none',
    }"
  />
</template>
