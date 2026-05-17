import { useMemo } from 'react';

import { CandlestickSeries, ChartContainer, LineSeries, TimeAxis, Title, YAxis } from '@wick-charts/react';

import { generateLineData, generateOHLCData } from '../../data';
import type { PanelCtx, StressPanel } from './panel';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = Math.round(30.44 * DAY);
const YEAR = Math.round(365.25 * DAY);

function SubSecond({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(200, 100, 50), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="50 ms buckets">Sub-second</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Minutes({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(120, 100, MINUTE), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="1 m buckets · 2 h total">Minute scale</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Hourly({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(72, 100, HOUR), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="1 h buckets · 3 days">Hourly</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Daily({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(365, 100, DAY), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="1 d buckets · 1 year">Daily</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Weekly({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(260, 100, WEEK), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="1 w buckets · 5 years">Weekly</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Monthly({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(120, 100, MONTH), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="1 mo buckets · 10 years">Monthly</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Yearly({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(50, 100, YEAR), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="1 y buckets · 50 years">Yearly</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function Decades({ theme, perfHud }: PanelCtx) {
  const data = useMemo(() => generateOHLCData(30, 100, 5 * YEAR), []);
  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="5 y buckets · 150 years">Decades</Title>
      <CandlestickSeries data={data} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function MixedSparseLongRange({ theme, perfHud }: PanelCtx) {
  // Data points spread unevenly across a multi-decade span: yearly points
  // sparsely covering 40 years, with a couple of clusters spaced years apart.
  const data = useMemo(() => {
    const all = generateLineData(40, 100, YEAR);
    // Drop every-other point to introduce irregularity.
    return all.filter((_, i) => i % 3 !== 0);
  }, []);

  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="irregular, 40-year span">Sparse long-range</Title>
      <LineSeries data={[data]} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function UnixEpochStart({ theme, perfHud }: PanelCtx) {
  // Timestamps starting at t=0 — historical Unix-epoch dates. Exercises
  // axis label formatting near the 1970 boundary.
  const data = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({ time: i * DAY, value: 50 + Math.sin(i * 0.2) * 20 })),
    [],
  );

  return (
    <ChartContainer theme={theme} perf={perfHud} interactive={false}>
      <Title sub="starts at Unix epoch (t=0)">Historical (1970)</Title>
      <LineSeries data={[data]} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

export const timeAxisPanels: readonly StressPanel[] = [
  {
    id: 'ta-subsecond',
    title: 'Sub-second (50 ms)',
    hint: 'Tick formatter should fall back to seconds/milliseconds.',
    render: (ctx) => <SubSecond {...ctx} />,
  },
  {
    id: 'ta-minute',
    title: 'Minute scale (2 h)',
    hint: 'HH:mm tick labels; minor grid at the expected density.',
    render: (ctx) => <Minutes {...ctx} />,
  },
  {
    id: 'ta-hourly',
    title: 'Hourly (3 days)',
    hint: 'Label format should switch to HH:mm with day dividers where appropriate.',
    render: (ctx) => <Hourly {...ctx} />,
  },
  {
    id: 'ta-daily',
    title: 'Daily (1 year)',
    hint: 'Tick formatter picks month-level labels across the year.',
    render: (ctx) => <Daily {...ctx} />,
  },
  {
    id: 'ta-weekly',
    title: 'Weekly (5 years)',
    hint: 'Wide spans — labels should roll up to quarters or months.',
    render: (ctx) => <Weekly {...ctx} />,
  },
  {
    id: 'ta-monthly',
    title: 'Monthly (10 years)',
    hint: 'Labels should be years with month granularity on zoom in.',
    render: (ctx) => <Monthly {...ctx} />,
  },
  {
    id: 'ta-yearly',
    title: 'Yearly (50 years)',
    hint: 'Decade-level formatting on the axis; no clipping.',
    render: (ctx) => <Yearly {...ctx} />,
  },
  {
    id: 'ta-decades',
    title: 'Multi-century (150 years)',
    hint: '5-year candles spanning 150 years. Label formatter must handle centuries.',
    render: (ctx) => <Decades {...ctx} />,
  },
  {
    id: 'ta-mixed-sparse',
    title: 'Irregular, 40-year span',
    hint: 'Unevenly spaced yearly points — renderer should still draw a connected line.',
    render: (ctx) => <MixedSparseLongRange {...ctx} />,
  },
  {
    id: 'ta-epoch',
    title: 'Historical (1970 epoch)',
    hint: 'Axis labels near `time=0` — must not crash on pre-historic timestamps.',
    render: (ctx) => <UnixEpochStart {...ctx} />,
  },
];
