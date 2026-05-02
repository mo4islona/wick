<script lang="ts">
import type { NavigatorData, OHLCInput } from '@wick-charts/core';
import { CandlestickSeries, ChartContainer, Navigator, catppuccin } from '@wick-charts/svelte';

export let candlestickData: OHLCInput[] = [];
export let navigatorData: NavigatorData = { type: 'line', points: [] };
export let height: number | undefined = undefined;
</script>

<ChartContainer theme={catppuccin.theme}>
  <CandlestickSeries data={candlestickData} />
  <Navigator data={navigatorData} {height} />
</ChartContainer>
