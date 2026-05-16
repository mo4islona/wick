import { useMemo } from 'react';

import { BarSeries, CandlestickSeries, ChartContainer, LineSeries, TimeAxis, Title, YAxis } from '@wick-charts/react';

import { DEMO_INTERVAL, generateBarData, generateLineData, generateOHLCData } from '../../data';
import { useOHLCStream } from '../../hooks';
import type { PanelCtx, StressPanel } from './panel';

function Volume10k({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(10_000, 42_000), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="static">10k candles</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Volume100k({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(100_000, 42_000), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="decimation path">100k candles</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Line100k({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateLineData(100_000, 100), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="single series, no area">100k line points</Title>
      <LineSeries data={[data]} options={{ area: { visible: false }, pulse: false }} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function BarsStacked({ theme, perfHud }: PanelCtx) {
  const layers = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) =>
        generateBarData(50_000, DEMO_INTERVAL).map((p) => ({ ...p, value: p.value * (0.5 + i * 0.25) })),
      ),
    [],
  );
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="4 layers, stacked">50k bars × 4</Title>
      <BarSeries data={layers} options={{ stacking: 'normal' }} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Streaming({ theme, perfHud }: PanelCtx) {
  const seed = useMemo(() => generateOHLCData(300, 42_000), []);
  const { data } = useOHLCStream(seed, { interval: DEMO_INTERVAL, speed: 5 });
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="live appends">Streaming 5×</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

export const volumePanels: readonly StressPanel[] = [
  {
    id: 'vol-10k',
    title: '10k candles',
    hint: 'Baseline big-dataset render. Expect sub-16ms frame time.',
    render: (ctx) => <Volume10k {...ctx} />,
  },
  {
    id: 'vol-100k',
    title: '100k candles',
    hint: 'Exercises decimation (decimateOHLCData). Pan + zoom to trigger re-decimation.',
    render: (ctx) => <Volume100k {...ctx} />,
  },
  {
    id: 'vol-line-100k',
    title: '100k line points',
    hint: 'No area fill, no pulse — pure stroke.',
    render: (ctx) => <Line100k {...ctx} />,
  },
  {
    id: 'vol-bars-stacked',
    title: '50k bars × 4 stacked',
    hint: '200k samples across 4 layers.',
    render: (ctx) => <BarsStacked {...ctx} />,
  },
  {
    id: 'vol-streaming',
    title: 'Streaming (speed=5)',
    hint: 'Rolling window; checks entry animation under load.',
    render: (ctx) => <Streaming {...ctx} />,
  },
];
