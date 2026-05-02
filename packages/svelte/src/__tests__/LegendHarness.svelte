<script lang="ts">
import type { LegendItem, TimePoint } from '@wick-charts/core';
import { BarSeries, ChartContainer, Legend, LineSeries, catppuccin } from '@wick-charts/svelte';

/**
 * Variants exercise the Legend parity behaviors:
 *   - `ordered-line`   : Legend before LineSeries, to prove seriesChange
 *     catch-up kicks in when Legend mounts before the series registers.
 *   - `toggle-line`    : Series then Legend, default `toggle` mode.
 *   - `solo-bars`      : Three-layer BarSeries with `mode="solo"` Legend.
 *   - `right-position` : Legend with `position="right"` — teleports into the
 *     right-side anchor instead of the bottom one.
 *   - `custom-slot`    : Render-prop slot; writes received items into a
 *     `window.__legendCapture__` slot so the test can inspect them.
 */
export let variant: 'ordered-line' | 'toggle-line' | 'solo-bars' | 'right-position' | 'custom-slot' = 'ordered-line';
export let lineData: TimePoint[][] = [[]];
export let barData: TimePoint[][] = [[]];

function capture(items: readonly LegendItem[]) {
  (window as unknown as { __legendCapture__?: readonly LegendItem[] }).__legendCapture__ = items;
}
</script>

<ChartContainer theme={catppuccin.theme}>
  {#if variant === 'ordered-line'}
    <Legend />
    <LineSeries data={lineData} />
  {:else if variant === 'toggle-line'}
    <LineSeries data={lineData} />
    <Legend />
  {:else if variant === 'solo-bars'}
    <BarSeries data={barData} />
    <Legend mode="solo" />
  {:else if variant === 'right-position'}
    <LineSeries data={lineData} />
    <Legend position="right" />
  {:else if variant === 'custom-slot'}
    <LineSeries data={lineData} />
    <Legend let:items>
      {@const _ = capture(items)}
      <div data-testid="custom">
        {#each items as item (item.id)}
          <span data-id={item.id}>{item.label}</span>
        {/each}
      </div>
    </Legend>
  {/if}
</ChartContainer>
