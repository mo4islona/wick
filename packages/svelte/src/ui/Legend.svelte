<script context="module" lang="ts">
/**
 * Minimal visual shape the `items` override accepts — just what the built-in
 * swatch/label UI needs. The canonical `LegendItem` (re-exported from
 * `@wick-charts/core`) carries identity plus `toggle`/`isolate` closures;
 * those aren't meaningful for a pre-baked, non-interactive legend.
 */
export interface LegendItemOverride {
  label: string;
  color: string;
}
</script>

<script lang="ts">
  import type { ChartInstance, LegendItem } from '@wick-charts/core';
  import { onDestroy } from 'svelte';

  import { getChartContext, getLegendAnchor, getLegendRightAnchor, getThemeContext } from '../context';
  import { portal } from './portal';

  type LegendMode = 'toggle' | 'isolate' | 'solo';

  export let items: LegendItemOverride[] | undefined = undefined;
  export let position: 'bottom' | 'right' = 'bottom';
  /** `'isolate'` shows only the clicked item; `'solo'` is a @deprecated alias. */
  export let mode: LegendMode = 'toggle';

  const chartStore = getChartContext();
  const themeStore = getThemeContext();
  const bottomAnchorStore = getLegendAnchor();
  const rightAnchorStore = getLegendRightAnchor();

  let isolatedId: string | null = null;
  let bump = 0;
  let overlayUnsub: (() => void) | null = null;
  let seriesChangeUnsub: (() => void) | null = null;

  $: {
    const c = $chartStore;
    if (c && !overlayUnsub) {
      const onOverlay = () => {
        bump++;
      };
      const onSeries = () => {
        isolatedId = null;
      };
      c.on('overlayChange', onOverlay);
      c.on('seriesChange', onSeries);
      overlayUnsub = () => c.off('overlayChange', onOverlay);
      seriesChangeUnsub = () => c.off('seriesChange', onSeries);
      if (c.getSeriesIds().length > 0) bump++;
    }
  }

  onDestroy(() => {
    overlayUnsub?.();
    seriesChangeUnsub?.();
  });

  $: chart = $chartStore;
  $: theme = $themeStore;
  $: anchor = position === 'right' ? $rightAnchorStore : $bottomAnchorStore;

  interface MakeItemArgs {
    id: string;
    seriesId: string;
    layerIndex: number | undefined;
    label: string;
    color: string;
    isDisabled: boolean;
  }

  function makeItem(c: ChartInstance, args: MakeItemArgs): LegendItem {
    const { id, seriesId, layerIndex, label, color, isDisabled } = args;

    const toggle = () => {
      if (layerIndex !== undefined) {
        c.setLayerVisible(seriesId, layerIndex, !c.isLayerVisible(seriesId, layerIndex));
      } else {
        c.setSeriesVisible(seriesId, !c.isSeriesVisible(seriesId));
      }
    };

    // Read `isolatedId` live — closing over the component-level `let`, not a
    // captured-at-build-time snapshot. Without this, back-to-back
    // `item.isolate()` calls from the slot (before Svelte flushes a
    // re-render) would see a stale null and keep re-isolating instead of
    // restoring all series on the second click.
    const isolate = () => {
      if (isolatedId === id) {
        c.batch(() => {
          for (const sid of c.getSeriesIds()) {
            c.setSeriesVisible(sid, true);
            const layers = c.getSeriesLayers(sid);
            if (layers) {
              for (let i = 0; i < layers.length; i++) c.setLayerVisible(sid, i, true);
            }
          }
        });
        isolatedId = null;

        return;
      }

      c.batch(() => {
        for (const sid of c.getSeriesIds()) {
          const layers = c.getSeriesLayers(sid);
          if (layers) {
            c.setSeriesVisible(sid, sid === seriesId);
            for (let i = 0; i < layers.length; i++) {
              c.setLayerVisible(sid, i, sid === seriesId && i === layerIndex);
            }
          } else {
            c.setSeriesVisible(sid, sid === id);
          }
        }
      });
      isolatedId = id;
    };

    return { id, seriesId, layerIndex, label, color, isDisabled, toggle, isolate };
  }

  function buildLegendItems(
    c: ChartInstance | undefined,
    _bumpDep: number,
    _isolatedDep: string | null,
  ): LegendItem[] {
    void _bumpDep;
    void _isolatedDep;
    if (!c) return [];

    const result: LegendItem[] = [];
    for (const seriesId of c.getSeriesIds()) {
      const layers = c.getSeriesLayers(seriesId);
      if (layers) {
        const baseLabel = c.getSeriesLabel(seriesId);
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
          const id = `${seriesId}_layer${layerIndex}`;
          const visible = c.isSeriesVisible(seriesId) && c.isLayerVisible(seriesId, layerIndex);
          result.push(
            makeItem(c, {
              id,
              seriesId,
              layerIndex,
              label: baseLabel ? `${baseLabel} ${layerIndex + 1}` : `Series ${layerIndex + 1}`,
              color: layers[layerIndex].color,
              isDisabled: !visible,
            }),
          );
        }
      } else {
        const color = c.getSeriesColor(seriesId);
        if (!color) continue;

        const label = c.getSeriesLabel(seriesId);
        const visible = c.isSeriesVisible(seriesId);
        result.push(
          makeItem(c, {
            id: seriesId,
            seriesId,
            layerIndex: undefined,
            label: label ?? 'Series',
            color,
            isDisabled: !visible,
          }),
        );
      }
    }

    return result;
  }

  // `isolatedId` is in the dep list so the list rebuilds when isolate state
  // changes (refreshes `isDisabled` via chart visibility reads).
  $: legendItems = buildLegendItems(chart, bump, isolatedId);

  function handleClick(item: LegendItem) {
    if (mode === 'isolate' || mode === 'solo') item.isolate();
    else item.toggle();
  }
</script>

{#if anchor && theme}
  {#if $$slots.default && legendItems.length > 0}
    <div
      use:portal={anchor}
      data-legend={position}
      style="display:flex;flex-direction:{position === 'right'
        ? 'column'
        : 'row'};flex-wrap:wrap;gap:{position === 'right'
        ? '6px'
        : '14px'};padding:{position === 'right'
        ? '8px 6px'
        : '6px 8px'};align-items:{position === 'right'
        ? 'flex-start'
        : 'center'};justify-content:{position === 'right'
        ? 'flex-start'
        : 'center'};font-family:{theme.typography.fontFamily};font-size:{theme.axis.fontSize}px;color:{theme.axis.textColor};pointer-events:auto;flex-shrink:0;"
    >
      <slot items={legendItems} />
    </div>
  {:else if items && items.length > 0}
    <div
      use:portal={anchor}
      data-legend={position}
      style="display:flex;flex-direction:{position === 'right'
        ? 'column'
        : 'row'};flex-wrap:wrap;gap:{position === 'right'
        ? '6px'
        : '14px'};padding:{position === 'right'
        ? '8px 6px'
        : '6px 8px'};align-items:{position === 'right'
        ? 'flex-start'
        : 'center'};justify-content:{position === 'right'
        ? 'flex-start'
        : 'center'};font-family:{theme.typography.fontFamily};font-size:{theme.axis.fontSize}px;color:{theme.axis.textColor};pointer-events:auto;flex-shrink:0;"
    >
      {#each items as item, i (i)}
        <div style="display:flex;align-items:center;gap:4px;user-select:none;">
          <span style="width:8px;height:8px;border-radius:2px;background:{item.color};flex-shrink:0;" />
          <span style="white-space:nowrap;">{item.label}</span>
        </div>
      {/each}
    </div>
  {:else if legendItems.length > 0}
    <div
      use:portal={anchor}
      data-legend={position}
      style="display:flex;flex-direction:{position === 'right'
        ? 'column'
        : 'row'};flex-wrap:wrap;gap:{position === 'right'
        ? '6px'
        : '14px'};padding:{position === 'right'
        ? '8px 6px'
        : '6px 8px'};align-items:{position === 'right'
        ? 'flex-start'
        : 'center'};justify-content:{position === 'right'
        ? 'flex-start'
        : 'center'};font-family:{theme.typography.fontFamily};font-size:{theme.axis.fontSize}px;color:{theme.axis.textColor};pointer-events:auto;flex-shrink:0;"
    >
      {#each legendItems as item (item.id)}
        <button
          type="button"
          on:click={() => handleClick(item)}
          style="display:flex;align-items:center;gap:4px;cursor:pointer;opacity:{item.isDisabled
            ? 0.35
            : 1};transition:opacity 0.15s ease;user-select:none;border:none;background:transparent;padding:0;margin:0;font:inherit;color:inherit;text-align:left;"
        >
          <span style="width:8px;height:8px;border-radius:2px;background:{item.color};flex-shrink:0;" />
          <span style="white-space:nowrap;">{item.label}</span>
        </button>
      {/each}
    </div>
  {/if}
{/if}
