<script lang="ts">
import {
  type AnimationsConfig,
  type AxisConfig,
  ChartInstance,
  type ChartOptions,
  type ChartTheme,
  type EdgeReachedInfo,
  catppuccin,
} from '@wick-charts/core';
import { onDestroy, onMount, tick } from 'svelte';

import {
  initChartContext,
  initInfoBarAnchor,
  initLegendAnchor,
  initLegendRightAnchor,
  initNavigatorAnchor,
  initThemeContext,
  initTitleAnchor,
} from './context';

type PerfOption = NonNullable<ChartOptions['perf']>;

export let theme: ChartTheme = catppuccin.theme;
export let axis: AxisConfig | undefined = undefined;
/**
 * Viewport padding. `top`/`bottom` are in pixels. `left`/`right` accept either pixels (`50`)
 * or data intervals (`{ intervals: 3 }`). Set to 0 for edge-to-edge sparklines. Updates are
 * applied reactively when this prop or the measured header height changes.
 * Defaults: `{ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } }`.
 */
// biome-ignore format: keep the inline shape so the parity checker matches React's type string verbatim
export let padding: { top?: number; bottom?: number; right?: number | { intervals: number }; left?: number | { intervals: number }; } | undefined = undefined;
/** Show the chart background gradient. Defaults to true. */
export let gradient: boolean = true;
/** Enable zoom, pan, and crosshair interactions. Defaults to true. */
export let interactive: boolean | undefined = undefined;
/** Background grid configuration. Default: `{ visible: true }`. */
export let grid: { visible: boolean } | undefined = undefined;
/**
 * How `<Title>` and `<InfoBar>` are positioned relative to the canvas.
 * - `'overlay'` (default): absolute overlays on top of the canvas.
 * - `'inline'`: flex siblings above the canvas — the canvas (and grid) shift down.
 */
export let headerLayout: 'overlay' | 'inline' = 'overlay';
/**
 * Chart-level animation configuration. See `AnimationsConfig` for the full shape.
 *
 * Two layers — chart-level (this prop) sets defaults for every series; per-series
 * options on `<LineSeries>`/`<CandlestickSeries>`/`<BarSeries>` override that
 * default for that one series.
 *
 * Shorthands: `true` / omitted — built-in defaults; `false` — disables every
 * animation category; `{ points: false }` / `{ viewport: false }` disables a
 * category. Updating this prop calls `chart.setAnimations(...)` so the new
 * durations take effect on the next animation / render.
 */
export let animations: boolean | AnimationsConfig | undefined = undefined;
/**
 * Enable runtime performance instrumentation. Off by default. Read at mount only;
 * later changes are ignored.
 */
export let perf: PerfOption | undefined = undefined;
/**
 * Fired after the user releases a pan/zoom gesture that pulled the viewport
 * past a data edge by more than ~10% of the visible range. Hosts typically
 * respond by prefetching more history. Captured at mount only; changing
 * the prop identity later is ignored.
 */
export let onEdgeReached: ((info: EdgeReachedInfo) => void) | undefined = undefined;
export let style: string = '';

let containerEl: HTMLDivElement;
let topOverlayEl: HTMLDivElement | null = null;
let titleAnchorEl: HTMLDivElement;
let infoBarAnchorEl: HTMLDivElement;
let legendAnchorEl: HTMLDivElement;
let legendRightAnchorEl: HTMLDivElement;
let navigatorAnchorEl: HTMLDivElement;

const chartStore = initChartContext();
const themeStore = initThemeContext(theme);
const titleAnchorStore = initTitleAnchor();
const infoBarAnchorStore = initInfoBarAnchor();
const legendAnchorStore = initLegendAnchor();
const legendRightAnchorStore = initLegendRightAnchor();
const navigatorAnchorStore = initNavigatorAnchor();

let instance: ChartInstance | null = null;
let resizeObserver: ResizeObserver | null = null;
let topOverlayHeight = 0;

// Inline mode: browser flex already reserves header height, so folding it
// into padding.top would double-shift the data. Only overlay needs the fold.
$: headerExtra = headerLayout === 'overlay' ? topOverlayHeight : 0;

function applyPadding() {
  if (!instance) return;

  const userTop = padding?.top ?? 20;
  const merged: ChartOptions['padding'] = { top: userTop + headerExtra };
  if (padding?.bottom !== undefined) merged.bottom = padding.bottom;
  if (padding?.right !== undefined) merged.right = padding.right;
  if (padding?.left !== undefined) merged.left = padding.left;
  instance.setPadding(merged);
}

// Capture perf at mount only — mirror React's perfRef so a later change of
// object identity doesn't recreate the chart.
const perfAtMount = perf;
// Same mount-only capture for the edge callback — the chart binds it once.
const onEdgeReachedAtMount = onEdgeReached;

// Wires up (or tears down) the header-height observer for the current
// `headerLayout`. Called on mount AND whenever `headerLayout` flips at
// runtime — overlay needs a live measurement; inline lets browser flex
// layout reserve the height directly.
function syncHeaderObserver() {
  resizeObserver?.disconnect();
  resizeObserver = null;

  const headerEl = headerLayout === 'overlay' ? topOverlayEl : null;
  if (!headerEl) {
    // Reset stale measurement so the next applyPadding call drops back to
    // the user's configured `padding.top` instead of carrying inline-mode
    // height.
    topOverlayHeight = 0;
    applyPadding();

    return;
  }

  const measure = () => {
    topOverlayHeight = headerEl.getBoundingClientRect().height;
    applyPadding();
  };
  measure();
  resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(headerEl);
}

onMount(() => {
  const options: ChartOptions = {};
  if (axis) options.axis = axis;
  if (theme) options.theme = theme;
  if (padding) options.padding = padding;
  if (interactive !== undefined) options.interactive = interactive;
  if (grid !== undefined) options.grid = grid;
  if (perfAtMount !== undefined) options.perf = perfAtMount;
  if (onEdgeReachedAtMount) options.onEdgeReached = onEdgeReachedAtMount;
  if (animations !== undefined) options.animations = animations;
  instance = new ChartInstance(containerEl, options);
  chartStore.set(instance);

  void tick().then(() => {
    titleAnchorStore.set(titleAnchorEl);
    infoBarAnchorStore.set(infoBarAnchorEl);
    legendAnchorStore.set(legendAnchorEl);
    legendRightAnchorStore.set(legendRightAnchorEl);
    navigatorAnchorStore.set(navigatorAnchorEl);
    syncHeaderObserver();
  });
});

// Re-attach the observer when `headerLayout` toggles after mount, so an
// overlay → inline → overlay round-trip keeps measuring the new header.
let lastHeaderLayout = headerLayout;
$: if (instance && headerLayout !== lastHeaderLayout) {
  lastHeaderLayout = headerLayout;
  void tick().then(syncHeaderObserver);
}

onDestroy(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  instance?.destroy();
  instance = null;
  chartStore.set(null);
  titleAnchorStore.set(null);
  infoBarAnchorStore.set(null);
  legendAnchorStore.set(null);
  legendRightAnchorStore.set(null);
  navigatorAnchorStore.set(null);
});

$: if (instance && theme) {
  instance.setTheme(theme);
  themeStore.set(theme);
}

$: if (instance && axis) {
  instance.setAxis(axis);
}

$: if (instance && grid !== undefined) {
  instance.setGrid(grid);
}

// Stringify the animations config so consumers can pass a fresh object identity
// without thrashing animator state when nothing has actually changed.
$: animationsKey = JSON.stringify(animations);
$: if (instance && animations !== undefined) {
  void animationsKey;
  instance.setAnimations(animations);
}

// Re-apply padding on any input that affects it — including `headerExtra`,
// so a runtime `headerLayout` toggle re-folds the measured header height
// even when the consumer never passes an explicit `padding` prop.
$: if (instance) {
  void padding;
  void headerExtra;
  applyPadding();
}

$: gradientBg = (() => {
  const t = theme;
  const [gtop, gbot] = t?.chartGradient ?? ['transparent', 'transparent'];
  const bg = t?.background ?? 'transparent';

  return gradient ? `linear-gradient(to bottom, ${gtop} 0%, ${bg} 70%, ${gbot} 100%)` : bg;
})();
</script>

<div
  {style}
  style:position="relative"
  style:display="flex"
  style:flex-direction="column"
  style:width="100%"
  style:height="100%"
  style:overflow="hidden"
  style:background={gradientBg}
>
  <div style="display:flex;flex-direction:row;flex:1;min-height:0">
    <div style="display:flex;flex-direction:column;flex:1;min-width:0;min-height:0">
      {#if headerLayout === 'inline'}
        <div
          data-chart-header=""
          style="flex-shrink:0;display:flex;flex-direction:column;pointer-events:none"
        >
          <div bind:this={titleAnchorEl} data-chart-title-anchor=""></div>
          <div bind:this={infoBarAnchorEl} data-tooltip-legend-anchor=""></div>
        </div>
      {/if}
      <div
        bind:this={containerEl}
        style="position:relative;flex:1;min-width:0;min-height:0;overflow:hidden"
      >
        {#if headerLayout === 'overlay'}
          <div
            bind:this={topOverlayEl}
            data-chart-top-overlay=""
            style="position:absolute;top:0;left:0;right:0;z-index:2;pointer-events:none;display:flex;flex-direction:column"
          >
            <div bind:this={titleAnchorEl} data-chart-title-anchor=""></div>
            <div bind:this={infoBarAnchorEl} data-tooltip-legend-anchor=""></div>
          </div>
        {/if}
        {#if $chartStore}
          <div
            data-chart-series-overlay=""
            style="position:absolute;inset:0;pointer-events:none;z-index:3"
          >
            <slot />
          </div>
        {/if}
      </div>
    </div>
    <div bind:this={legendRightAnchorEl} data-legend-right-anchor="" style="flex:0 0 auto"></div>
  </div>
  <div bind:this={legendAnchorEl} data-legend-anchor="" style="flex:0 0 auto"></div>
  <div bind:this={navigatorAnchorEl} data-navigator-anchor="" style="flex:0 0 auto"></div>
</div>
