<script setup lang="ts">
import {
  type AnimationsConfig,
  type AxisConfig,
  ChartInstance,
  type ChartOptions,
  type ChartTheme,
  type EdgeReachedInfo,
  type VisibleRangeSpec,
  catppuccin,
} from '@wick-charts/core';
import { computed, nextTick, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue';

import {
  ChartKey,
  InfoBarAnchorKey,
  LegendAnchorKey,
  LegendRightAnchorKey,
  NavigatorAnchorKey,
  ThemeKey,
  TitleAnchorKey,
} from './context';

type PerfOption = NonNullable<ChartOptions['perf']>;

const props = withDefaults(
  defineProps<{
    theme?: ChartTheme;
    axis?: AxisConfig;
    /**
     * Viewport padding. `top`/`bottom` are in pixels. `left`/`right` accept either pixels (`50`)
     * or data intervals (`{ intervals: 3 }`). Set to 0 for edge-to-edge sparklines. Updates are
     * applied reactively when this prop or the measured header height changes.
     * Defaults: `{ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } }`.
     */
    padding?: {
      top?: number;
      bottom?: number;
      right?: number | { intervals: number };
      left?: number | { intervals: number };
    };
    /**
     * Viewport-level streaming behavior. Captured at mount only — changing
     * this prop after the chart is created is ignored.
     */
    viewport?: {
      /**
       * Width of the visible window in data bars, set on the first data load
       * to `maxVisibleBars * dataInterval`. While the dataset is smaller than
       * this width, streaming ticks render into the empty right-side gap and
       * the viewport stays put; once the data reaches the right edge, the
       * viewport pans forward to keep the latest bar pinned (tail-scroll).
       * Default: 200.
       */
      maxVisibleBars?: number;
      /**
       * Initial visible range applied before the first paint with data. Same
       * shape as the imperative `chart.setVisibleRange` — pass a bar count
       * (e.g. `35`), an explicit `{from, to}` window, or `{from, bars}` for
       * a warm-up pair. Captured at mount.
       */
      initialRange?: VisibleRangeSpec;
    };
    /** Show the chart background gradient. Defaults to true. */
    gradient?: boolean;
    /** Enable zoom, pan, and crosshair interactions. Defaults to true. */
    interactive?: boolean;
    /** Background grid configuration. Default: `{ visible: true }`. */
    grid?: { visible: boolean };
    /**
     * How `<Title>` and `<InfoBar>` are positioned relative to the canvas.
     * - `'overlay'` (default): absolute overlays on top of the canvas.
     * - `'inline'`: flex siblings above the canvas — the canvas (and grid) shift down.
     */
    headerLayout?: 'overlay' | 'inline';
    /**
     * Animation control. `true` / omitted uses built-in defaults; `false`
     * disables every category. Per-series options on `<LineSeries>` /
     * `<CandlestickSeries>` / `<BarSeries>` override these chart-level
     * defaults unless the category here is explicitly `false`.
     *
     * **Init-only by reference identity.** A new `animations` reference
     * recreates the underlying `ChartInstance`. Hoist the object outside
     * the render scope — an inline literal tears the chart down on every
     * re-render.
     */
    animations?: boolean | AnimationsConfig;
    /**
     * Enable runtime performance instrumentation. Off by default. Read at mount only;
     * later changes are ignored.
     */
    perf?: PerfOption;
    /**
     * Fired after the user releases a pan/zoom gesture that pulled the viewport
     * past a data edge by more than ~10% of the visible range. Hosts typically
     * respond by prefetching more history. Captured at mount only; changing
     * the prop identity later is ignored.
     */
    onEdgeReached?: (info: EdgeReachedInfo) => void;
  }>(),
  {
    theme: () => catppuccin.theme,
    gradient: true,
    headerLayout: 'overlay',
  },
);

const containerRef = ref<HTMLDivElement>();
const chart = shallowRef<ChartInstance | null>(null);
const themeRef = shallowRef<ChartTheme>(props.theme);

// Capture perf at mount only — mirrors React's perfRef so a new object
// identity later doesn't recreate the chart.
const perfAtMount = props.perf;
// Same mount-only capture for the edge callback — the chart binds it once.
const onEdgeReachedAtMount = props.onEdgeReached;

const topOverlayRef = ref<HTMLElement | null>(null);
const titleAnchor = ref<HTMLElement | null>(null);
const infoBarAnchor = ref<HTMLElement | null>(null);
const legendAnchor = ref<HTMLElement | null>(null);
const legendRightAnchor = ref<HTMLElement | null>(null);
const navigatorAnchor = ref<HTMLElement | null>(null);

provide(ChartKey, chart);
provide(ThemeKey, themeRef);
provide(TitleAnchorKey, titleAnchor);
provide(InfoBarAnchorKey, infoBarAnchor);
provide(LegendAnchorKey, legendAnchor);
provide(LegendRightAnchorKey, legendRightAnchor);
provide(NavigatorAnchorKey, navigatorAnchor);

let resizeObserver: ResizeObserver | null = null;
const topOverlayHeight = ref(0);

// Inline mode: browser flex already reserves header height, so folding it
// into padding.top would double-shift the data. Only overlay needs the fold.
const headerExtra = computed(() => (props.headerLayout === 'overlay' ? topOverlayHeight.value : 0));

function applyPadding() {
  if (!chart.value) return;
  const userTop = props.padding?.top ?? 20;
  const merged: ChartOptions['padding'] = { top: userTop + headerExtra.value };
  if (props.padding?.bottom !== undefined) merged.bottom = props.padding.bottom;
  if (props.padding?.right !== undefined) merged.right = props.padding.right;
  if (props.padding?.left !== undefined) merged.left = props.padding.left;
  chart.value.setPadding(merged);
}

// Wires up (or tears down) the header-height observer for the current
// `headerLayout`. Called on mount AND whenever `headerLayout` flips at
// runtime — overlay needs a live measurement, inline lets browser flex
// layout reserve the height directly.
function syncHeaderObserver() {
  resizeObserver?.disconnect();
  resizeObserver = null;

  const headerEl = props.headerLayout === 'overlay' ? topOverlayRef.value : null;
  if (!headerEl) {
    // Reset stale measurement so the next applyPadding call drops back to the
    // user's configured `padding.top` instead of carrying inline-mode height.
    topOverlayHeight.value = 0;
    applyPadding();

    return;
  }

  const measure = () => {
    topOverlayHeight.value = headerEl.getBoundingClientRect().height;
    applyPadding();
  };
  measure();
  resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(headerEl);
}

onMounted(async () => {
  if (!containerRef.value) return;

  const options: ChartOptions = {};
  if (props.axis) options.axis = props.axis;
  if (props.theme) options.theme = props.theme;
  if (props.padding) options.padding = props.padding;
  if (props.viewport) options.viewport = props.viewport;
  if (props.interactive !== undefined) options.interactive = props.interactive;
  if (props.grid !== undefined) options.grid = props.grid;
  if (perfAtMount !== undefined) options.perf = perfAtMount;
  if (onEdgeReachedAtMount) options.onEdgeReached = onEdgeReachedAtMount;
  if (props.animations !== undefined) options.animations = props.animations;
  chart.value = new ChartInstance(containerRef.value, options);

  await nextTick();
  syncHeaderObserver();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart.value?.destroy();
  chart.value = null;
});

// Re-attach the observer when `headerLayout` toggles after mount, so an
// overlay → inline → overlay round-trip keeps measuring the new header.
watch(
  () => props.headerLayout,
  async () => {
    if (!chart.value) return;
    await nextTick();
    syncHeaderObserver();
  },
);

watch(
  () => props.theme,
  (newTheme) => {
    if (chart.value && newTheme) {
      chart.value.setTheme(newTheme);
      themeRef.value = newTheme;
    }
  },
);

watch(
  () => props.axis,
  (newAxis) => {
    if (chart.value && newAxis) chart.value.setAxis(newAxis);
  },
  { deep: true },
);

watch(
  () => props.grid?.visible,
  () => {
    if (chart.value && props.grid !== undefined) chart.value.setGrid(props.grid);
  },
);

// Init-only: post-mount `animations` reference change tears down the
// instance and rebuilds with the new config. Reference equality matters
// — passing an inline literal recreates on every render.
//
// Children get the chart via `useChartInstance()` which snapshots
// `chartRef.value` once at setup time. To force them to re-setup against
// the new instance, we flip `chart.value` to `null` first — the `v-if`
// guard in the template unmounts the slot — then `await nextTick()` so
// Vue commits the unmount before the new ChartInstance is constructed.
// When `chart.value` becomes the new instance, the slot re-mounts and
// every child's `setup()` runs again against the fresh chart.
watch(
  () => props.animations,
  async (next) => {
    if (!chart.value || !containerRef.value) return;
    chart.value.destroy();
    chart.value = null;
    await nextTick();
    const opts: ChartOptions = {};
    if (props.axis) opts.axis = props.axis;
    if (props.theme) opts.theme = props.theme;
    if (props.padding) opts.padding = props.padding;
    if (props.viewport) opts.viewport = props.viewport;
    if (props.interactive !== undefined) opts.interactive = props.interactive;
    if (props.grid !== undefined) opts.grid = props.grid;
    if (perfAtMount !== undefined) opts.perf = perfAtMount;
    if (onEdgeReachedAtMount) opts.onEdgeReached = onEdgeReachedAtMount;
    if (next !== undefined) opts.animations = next;
    chart.value = new ChartInstance(containerRef.value, opts);
  },
);

// Re-apply padding on any input that affects it — including `headerExtra`,
// so a runtime `headerLayout` toggle re-runs even when `padding` is undefined
// (the default top=20 still needs the fold-in/out).
watch(
  () => [
    props.padding?.top,
    props.padding?.bottom,
    typeof props.padding?.right === 'object' ? props.padding.right.intervals : props.padding?.right,
    typeof props.padding?.left === 'object' ? props.padding.left.intervals : props.padding?.left,
    headerExtra.value,
  ],
  applyPadding,
);

const rootStyle = computed(() => {
  const t = themeRef.value;
  const [gtop, gbot] = t?.chartGradient ?? ['transparent', 'transparent'];
  const bg = t?.background ?? 'transparent';
  const background = props.gradient ? `linear-gradient(to bottom, ${gtop} 0%, ${bg} 70%, ${gbot} 100%)` : bg;

  return (
    'position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; ' +
    `background: ${background}`
  );
});
</script>

<template>
  <div :style="rootStyle">
    <div style="display: flex; flex-direction: row; flex: 1; min-height: 0">
      <!-- Canvas-block column. In inline mode the header is a flex sibling
           above the canvas inside this column; in overlay mode it's absolute
           over the canvas (rendered inside `containerRef`). -->
      <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0">
        <div
          v-if="headerLayout === 'inline'"
          data-chart-header=""
          style="flex-shrink: 0; display: flex; flex-direction: column; pointer-events: none"
        >
          <div ref="titleAnchor" data-chart-title-anchor="" />
          <div ref="infoBarAnchor" data-tooltip-legend-anchor="" />
        </div>
        <div
          ref="containerRef"
          style="position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden"
        >
          <div
            v-if="headerLayout === 'overlay'"
            ref="topOverlayRef"
            data-chart-top-overlay=""
            style="position: absolute; top: 0; left: 0; right: 0; z-index: 2; pointer-events: none; display: flex; flex-direction: column"
          >
            <div ref="titleAnchor" data-chart-title-anchor="" />
            <div ref="infoBarAnchor" data-tooltip-legend-anchor="" />
          </div>
          <div
            v-if="chart"
            data-chart-series-overlay=""
            style="position: absolute; inset: 0; pointer-events: none; z-index: 3"
          >
            <slot />
          </div>
        </div>
      </div>
      <div ref="legendRightAnchor" data-legend-right-anchor="" style="flex: 0 0 auto" />
    </div>
    <div ref="legendAnchor" data-legend-anchor="" style="flex: 0 0 auto" />
    <div ref="navigatorAnchor" data-navigator-anchor="" style="flex: 0 0 auto" />
  </div>
</template>
