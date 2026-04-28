import {
  CandlestickSeries,
  ChartContainer,
  type ChartTheme,
  Crosshair,
  InfoBar,
  Navigator,
  type OHLCData,
  Title,
  Tooltip,
  XAxis,
  YAxis,
  YLabel,
} from '@wick-charts/react';

import { Cell } from '../components/Cell';
import type { PropValue } from '../components/CodePreview';
import {
  buildAnimationsProp,
  buildCartesianContainerProps,
  buildCommonSeriesOptions,
  buildNavigatorComponent,
} from '../components/playground/codeMappings';
import { ICONS } from '../components/playground/icons';
import { Playground, type PlaygroundChartProps } from '../components/playground/Playground';
import { Toggle } from '../components/playground/primitives';
import type { RowSpec, SectionSpec } from '../components/playground/sections';
import { useMemo } from 'react';

import { generateOHLCData } from '../data';
import { DEMO_INTERVAL } from '../data/demo';
import { useIsMobile, useOHLCStream } from '../hooks';

interface CandleSettings {
  yLabelVisible: boolean;
  tooltipVisible: boolean;
  infoBarVisible: boolean;
  crosshairVisible: boolean;
}

// Different zoom across charts — close-up on the first, mid-range on the
// second, full history on the third, so the user sees three levels of
// detail at once. Generate the full buffers once at module level and slice
// per-viewport inside the page component.
const steadyDataFull = generateOHLCData(300, 42000, DEMO_INTERVAL);
const volatileDataFull = generateOHLCData(300, 100, DEMO_INTERVAL);
const trendingDataFull = generateOHLCData(300, 1500, DEMO_INTERVAL);

function CandleChart({
  theme,
  axis,
  streaming,
  gradient,
  data,
  yLabelVisible,
  tooltipVisible,
  infoBarVisible,
  crosshairVisible,
  navigatorVisible,
  navigatorHeight,
  perfHudVisible,
  candleEntryAnimation,
  headerLayout,
  startDelay,
  title,
  sub,
  ...rest
}: PlaygroundChartProps & CandleSettings & { data: OHLCData[]; startDelay: number; title: string; sub: string }) {
  // speed=5: virtual interval is 5s so each candle forms with visible intra
  // wobble, but wall-clock gives us one new bar per second — dense enough
  // for entrance animations to feel continuous, like the dashboard.
  const { data: d } = useOHLCStream(data, { startDelay, interval: DEMO_INTERVAL, speed: 5 });
  const display = streaming ? d : data;
  const sid = 'candle';
  const animations = buildAnimationsProp({
    ...rest,
    candleEntryAnimation,
    headerLayout,
    streaming,
    gradient,
    perfHudVisible,
    navigatorVisible,
    navigatorHeight,
    theme,
    axis,
  } as PlaygroundChartProps);

  return (
    <ChartContainer
      theme={theme}
      axis={axis}
      gradient={gradient}
      headerLayout={headerLayout}
      perf={perfHudVisible}
      animations={animations}
    >
      <Title sub={sub}>{title}</Title>
      {infoBarVisible && <InfoBar />}
      <CandlestickSeries id={sid} data={display} options={{ entryAnimation: candleEntryAnimation }} />
      {yLabelVisible && <YLabel seriesId={sid} />}
      {tooltipVisible && <Tooltip />}
      {crosshairVisible && <Crosshair />}
      {axis?.y?.visible !== false && <YAxis />}
      {axis?.x?.visible !== false && <XAxis />}
      {navigatorVisible && (
        <Navigator
          data={{
            type: 'line',
            points: display.map((p) => ({ time: p.time, value: p.close })),
          }}
          height={navigatorHeight}
        />
      )}
    </ChartContainer>
  );
}

const DISPLAY_EXTRA: SectionSpec = {
  id: 'display-candle',
  title: 'Display',
  extend: 'display',
  rows: [
    {
      key: 'yLabelVisible',
      label: 'Value label',
      hint: 'Last value pill on y-axis',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'tooltipVisible',
      label: 'Tooltip',
      hint: 'On hover',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'infoBarVisible',
      label: 'Info bar',
      hint: 'OHLC values above the chart',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'crosshairVisible',
      label: 'Crosshair',
      hint: 'Vertical + horizontal cursor lines',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
  ] as RowSpec[],
};

export function CandlestickPage({ theme }: { theme: ChartTheme }) {
  const mobile = useIsMobile();
  const { steadyData, volatileData, trendingData } = useMemo(() => {
    const steady = mobile ? 20 : 50;
    const volatile = mobile ? 60 : 120;
    const trending = mobile ? 150 : 300;

    return {
      steadyData: steadyDataFull.slice(-steady),
      volatileData: volatileDataFull.slice(-volatile),
      trendingData: trendingDataFull.slice(-trending),
    };
  }, [mobile]);

  return (
    <Playground<CandleSettings>
      id="candlestick"
      theme={theme}
      extraDefaults={(m) => ({
        yLabelVisible: true,
        tooltipVisible: true,
        infoBarVisible: !m,
        crosshairVisible: true,
      })}
      gridTemplate="1fr 1fr 1fr"
      animationKinds={['candle']}
      sections={[{ ...DISPLAY_EXTRA, icon: ICONS.display }]}
      charts={(props) => (
        <>
          <Cell theme={props.theme}>
            <CandleChart
              key={`s-${props.streaming}-${props.perfHudVisible}-${mobile}`}
              {...props}
              data={steadyData}
              startDelay={300}
              title="BTC/USD"
              sub="Standard · 1m"
            />
          </Cell>
          <Cell theme={props.theme}>
            <CandleChart
              key={`v-${props.streaming}-${props.perfHudVisible}-${mobile}`}
              {...props}
              data={volatileData}
              startDelay={400}
              title="DOGE/USD"
              sub="High volatility · 1m"
            />
          </Cell>
          <Cell theme={props.theme}>
            <CandleChart
              key={`t-${props.streaming}-${props.perfHudVisible}-${mobile}`}
              {...props}
              data={trendingData}
              startDelay={500}
              title="ETH/USD"
              sub="Trending · 1m"
            />
          </Cell>
        </>
      )}
      codeConfig={(s) => {
        const options: Record<string, PropValue> = {
          ...buildCommonSeriesOptions(s, 'candle'),
        };

        const containerProps = buildCartesianContainerProps(s) ?? {};
        if (s.perfHudVisible) containerProps.perf = true;

        const yVisible = s.axis.y?.visible !== false;
        const xVisible = s.axis.x?.visible !== false;

        return {
          theme: 'darkTheme',
          containerProps: Object.keys(containerProps).length > 0 ? containerProps : undefined,
          components: [
            {
              component: 'CandlestickSeries',
              props: {
                id: 'sid',
                data: 'ohlcData',
                ...(Object.keys(options).length > 0 ? { options } : {}),
              },
            },
            ...(s.infoBarVisible ? [{ component: 'InfoBar' }] : []),
            ...(s.yLabelVisible ? [{ component: 'YLabel', props: { seriesId: 'sid' } }] : []),
            ...(s.tooltipVisible ? [{ component: 'Tooltip' }] : []),
            ...(s.crosshairVisible ? [{ component: 'Crosshair' }] : []),
            ...(yVisible ? [{ component: 'YAxis' }] : []),
            ...(xVisible ? [{ component: 'XAxis' }] : []),
            ...buildNavigatorComponent(s, 'closePoints'),
          ],
        };
      }}
    />
  );
}
