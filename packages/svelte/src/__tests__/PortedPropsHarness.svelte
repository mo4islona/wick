<script lang="ts">
import type { OHLCInput, PieSliceData } from '@wick-charts/core';
import {
  CandlestickSeries,
  ChartContainer,
  InfoBar,
  NumberFlow,
  PieLegend,
  PieSeries,
  TimeAxis,
  Title,
  YAxis,
  catppuccin,
} from '@wick-charts/svelte';

/**
 * Harness for tests covering Vue-equivalent ported props in the Svelte
 * package: ChartContainer (gradient/interactive/headerLayout/padding),
 * TimeAxis/YAxis density, PieLegend.position, Title sub slot, NumberFlow
 * format with NumberFormatOptions.
 */
export let variant:
  | 'gradient-off'
  | 'header-overlay'
  | 'header-inline'
  | 'padded'
  | 'time-axis-density'
  | 'time-axis-default'
  | 'y-axis-density'
  | 'pie-legend-bottom'
  | 'pie-legend-right'
  | 'pie-legend-overlay'
  | 'title-sub-slot'
  | 'title-sub-prop'
  | 'title-sub-both'
  | 'title-no-sub'
  | 'numberflow-options'
  | 'numberflow-fn' = 'gradient-off';

export let candlestickData: OHLCInput[] = [];
export let pieData: PieSliceData[] = [];
export let labelCount: number | undefined = undefined;
export let minLabelSpacing: number | undefined = undefined;
export let yLabelCount: number | undefined = undefined;
</script>

{#if variant === 'gradient-off'}
  <ChartContainer theme={catppuccin.theme} gradient={false}>
    <CandlestickSeries data={candlestickData} />
  </ChartContainer>
{:else if variant === 'header-overlay'}
  <ChartContainer theme={catppuccin.theme} headerLayout="overlay">
    <Title>BTC<svelte:fragment slot="sub">Live</svelte:fragment></Title>
    <InfoBar />
    <CandlestickSeries data={candlestickData} />
  </ChartContainer>
{:else if variant === 'header-inline'}
  <ChartContainer theme={catppuccin.theme} headerLayout="inline">
    <Title>BTC<svelte:fragment slot="sub">Live</svelte:fragment></Title>
    <InfoBar />
    <CandlestickSeries data={candlestickData} />
  </ChartContainer>
{:else if variant === 'padded'}
  <ChartContainer theme={catppuccin.theme} padding={{ top: 20 }} headerLayout="inline">
    <Title>BTC</Title>
    <InfoBar />
    <CandlestickSeries data={candlestickData} />
  </ChartContainer>
{:else if variant === 'time-axis-density'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <TimeAxis {labelCount} {minLabelSpacing} />
  </ChartContainer>
{:else if variant === 'time-axis-default'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <TimeAxis />
  </ChartContainer>
{:else if variant === 'y-axis-density'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <YAxis labelCount={yLabelCount} />
  </ChartContainer>
{:else if variant === 'pie-legend-bottom'}
  <ChartContainer theme={catppuccin.theme}>
    <PieSeries id="pie" data={pieData} />
    <PieLegend seriesId="pie" position="bottom" />
  </ChartContainer>
{:else if variant === 'pie-legend-right'}
  <ChartContainer theme={catppuccin.theme}>
    <PieSeries id="pie" data={pieData} />
    <PieLegend seriesId="pie" position="right" />
  </ChartContainer>
{:else if variant === 'pie-legend-overlay'}
  <ChartContainer theme={catppuccin.theme}>
    <PieSeries id="pie" data={pieData} />
    <PieLegend seriesId="pie" position="overlay" />
  </ChartContainer>
{:else if variant === 'title-sub-slot'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <Title>
      BTC/USD
      <svelte:fragment slot="sub">
        <span class="sub-marker">Live</span>
      </svelte:fragment>
    </Title>
  </ChartContainer>
{:else if variant === 'title-sub-prop'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <Title sub="Live">BTC</Title>
  </ChartContainer>
{:else if variant === 'title-sub-both'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <Title sub="PROP-VALUE">
      BTC
      <svelte:fragment slot="sub">
        <span class="slot-marker">SLOT-VALUE</span>
      </svelte:fragment>
    </Title>
  </ChartContainer>
{:else if variant === 'title-no-sub'}
  <ChartContainer theme={catppuccin.theme}>
    <CandlestickSeries data={candlestickData} />
    <Title>BTC</Title>
  </ChartContainer>
{:else if variant === 'numberflow-options'}
  <NumberFlow value={1234.5} format={{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }} locale="en-US" />
{:else if variant === 'numberflow-fn'}
  <NumberFlow value={42} format={(v) => `~${v}~`} />
{/if}

<svelte:options accessors={true} />
