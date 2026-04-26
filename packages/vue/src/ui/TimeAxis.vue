<script setup lang="ts">
import { formatTime, resolveAxisFontSize, resolveAxisTextColor } from '@wick-charts/core';
import { computed, onUnmounted, watch } from 'vue';

import { useVisibleRange } from '../composables';
import { useChartInstance } from '../context';

const props = defineProps<{
  /** Desired number of labels (≥ 2). Overrides chart-level `axis.x.labelCount`. */
  labelCount?: number;
  /** Minimum pixel gap between adjacent labels (hard floor). Overrides chart-level. */
  minLabelSpacing?: number;
}>();

interface TrackedTick {
  opacity: number;
  addedAt: number;
}

const chart = useChartInstance();
const visibleRange = useVisibleRange(chart);

const applyDensity = () => {
  chart.setTimeAxisLabelDensity({
    labelCount: props.labelCount ?? null,
    minLabelSpacing: props.minLabelSpacing ?? null,
  });
};
applyDensity();
watch(() => [props.labelCount, props.minLabelSpacing], applyDensity);
onUnmounted(() => {
  chart.setTimeAxisLabelDensity({ labelCount: null, minLabelSpacing: null });
});

const tickMap = new Map<number, TrackedTick>();

const theme = computed(() => chart.getTheme());

const tickData = computed(() => {
  // Access visibleRange.value to track dependency
  void visibleRange.value;

  const dataInterval = chart.getDataInterval();
  const { ticks: currentTicks, tickInterval } = chart.timeScale.niceTickValues(dataInterval);
  const currentSet = new Set(currentTicks);
  const now = performance.now();

  // Mark current ticks as visible
  for (const t of currentTicks) {
    if (!tickMap.has(t)) {
      tickMap.set(t, { opacity: 1, addedAt: now });
    } else {
      tickMap.get(t)!.opacity = 1;
    }
  }

  // Mark missing ticks for fade-out
  for (const [t, entry] of tickMap) {
    if (!currentSet.has(t)) {
      entry.opacity = 0;
    }
  }

  // Clean up old faded-out ticks
  for (const [t, entry] of tickMap) {
    if (entry.opacity === 0 && now - entry.addedAt > 5000) {
      tickMap.delete(t);
    }
  }

  return {
    allTicks: Array.from(tickMap.entries()),
    tickInterval,
  };
});
</script>

<template>
  <div
    :style="{
      position: 'absolute',
      left: '0',
      bottom: '0',
      right: chart.yAxisWidth + 'px',
      height: chart.xAxisHeight + 'px',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
    }"
  >
    <span
      v-for="[time, entry] in tickData.allTicks"
      :key="time"
      :style="{
        position: 'absolute',
        left: chart.timeScale.timeToX(time) + 'px',
        transform: 'translateX(-50%)',
        color: resolveAxisTextColor(theme, 'x'),
        fontSize: resolveAxisFontSize(theme, 'x') + 'px',
        fontFamily: theme.typography.fontFamily,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        opacity: entry.opacity,
        transition: 'opacity 0.3s ease',
        willChange: 'opacity',
      }"
    >
      {{ formatTime(time, tickData.tickInterval) }}
    </span>
  </div>
</template>
