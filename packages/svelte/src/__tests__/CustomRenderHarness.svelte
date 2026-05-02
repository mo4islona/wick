<script lang="ts">
import type { OHLCInput, SeriesSnapshot, TimePoint } from '@wick-charts/core';
import { CandlestickSeries, ChartContainer, InfoBar, LineSeries, Tooltip, catppuccin } from '@wick-charts/svelte';

export let variant: 'infobar-slot' | 'infobar-default' | 'tooltip-slot' = 'infobar-slot';
export let candlestickData: OHLCInput[] = [];
export let lineData: TimePoint[][] = [[]];
export let onBarSlot: ((ctx: { snapshots: readonly SeriesSnapshot[]; isHover: boolean }) => void) | undefined =
  undefined;
export let tooltipSlotInvocations = { count: 0 };
</script>

<ChartContainer theme={catppuccin.theme}>
  {#if variant === 'infobar-slot'}
    <InfoBar let:snapshots let:isHover>
      {(onBarSlot?.({ snapshots, isHover }), '')}
      <div data-testid="custom-bar">{snapshots.length}</div>
    </InfoBar>
    <LineSeries data={lineData} />
  {:else if variant === 'infobar-default'}
    <InfoBar />
    <CandlestickSeries data={candlestickData} />
  {:else if variant === 'tooltip-slot'}
    <Tooltip let:snapshots>
      {(tooltipSlotInvocations.count++, '')}
      <div data-testid="custom-tooltip">{snapshots.length}</div>
    </Tooltip>
    <LineSeries data={lineData} />
  {/if}
</ChartContainer>
