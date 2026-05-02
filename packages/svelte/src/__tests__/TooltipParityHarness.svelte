<script lang="ts">
import type { OHLCInput, TimePoint } from '@wick-charts/core';
import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  InfoBar,
  LineSeries,
  Tooltip,
  catppuccin,
} from '@wick-charts/svelte';

/**
 * Variants exercise the tooltip / info-bar parity fixes:
 *   - `ordered-legend` : InfoBar mounted *before* the series in the
 *     slot, to prove seriesChange catch-up works.
 *   - `layered-legend` : InfoBar over a multi-layer BarSeries to prove
 *     getLayerSnapshots expansion fires.
 *   - `ordered-tooltip`: Tooltip before series, sanity check it doesn't crash
 *     on initial empty series list.
 *   - `precision-legend`: InfoBar over sub-cent OHLC — regression guard
 *     for the old hardcoded `.toFixed(2)`.
 *   - `custom-format-legend`: InfoBar with a custom `format` prop.
 */
export let variant:
  | 'ordered-legend'
  | 'layered-legend'
  | 'ordered-tooltip'
  | 'precision-legend'
  | 'custom-format-legend' = 'ordered-legend';
export let candlestickData: OHLCInput[] = [];
export let barData: TimePoint[][] = [[]];
export let lineData: TimePoint[][] = [[]];
</script>

<ChartContainer theme={catppuccin.theme}>
  {#if variant === 'ordered-legend'}
    <InfoBar />
    <CandlestickSeries data={candlestickData} />
  {:else if variant === 'layered-legend'}
    <InfoBar />
    <BarSeries data={barData} />
  {:else if variant === 'ordered-tooltip'}
    <Tooltip />
    <CandlestickSeries data={candlestickData} />
  {:else if variant === 'precision-legend'}
    <InfoBar />
    <CandlestickSeries data={candlestickData} />
  {:else if variant === 'custom-format-legend'}
    <InfoBar format={(v, field) => `<${field}:${v}>`} />
    <LineSeries data={lineData} />
  {/if}
</ChartContainer>
