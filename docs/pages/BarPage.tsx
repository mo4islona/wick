import { useMemo } from 'react';

import {
  type AxisConfig,
  BarSeries,
  type BarStacking,
  ChartContainer,
  type ChartTheme,
  Crosshair,
  InfoBar,
  Legend,
  Navigator,
  Title,
  Tooltip,
  XAxis,
  YAxis,
  resolveCandlestickBodyColor,
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
import { Toggle, ToggleGroup } from '../components/playground/primitives';
import type { RowSpec, SectionSpec } from '../components/playground/sections';
import { generateBarData, generateLayerData } from '../data';
import { DEMO_INTERVAL } from '../data/demo';
import { useLineStreams } from '../hooks';

type BarWidth = 'thin' | 'normal' | 'wide';
const BAR_WIDTH_MAP: Record<BarWidth, number> = { thin: 0.3, normal: 0.6, wide: 0.85 };
const LAYER_COUNT = 4;

interface BarSettings {
  stacking: BarStacking;
  barWidth: BarWidth;
  infoBarVisible: boolean;
  tooltipVisible: boolean;
  crosshairVisible: boolean;
}

const singleData = generateBarData(80, DEMO_INTERVAL);
const layers = Array.from({ length: LAYER_COUNT }, (_, i) => generateLayerData(80, [60, 40, 25, 15][i], DEMO_INTERVAL));

function SingleBarChart(props: PlaygroundChartProps & BarSettings) {
  // speed=5 matches the other playground pages (see CandlestickPage) so new
  // bars append about once per second and the entry animations stay visible.
  const { datasets } = useLineStreams([singleData], {
    startDelay: 300,
    interval: DEMO_INTERVAL,
    speed: 5,
    kind: 'bar',
  });
  const display = props.streaming ? datasets[0] : singleData;

  return (
    <ChartContainer
      theme={props.theme}
      axis={props.axis}
      gradient={props.gradient}
      headerLayout={props.headerLayout}
      perf={props.perfHudVisible}
      animations={buildAnimationsProp(props)}
    >
      <Title sub="Up/Down">Single</Title>
      {props.infoBarVisible && <InfoBar />}
      <BarSeries
        data={[display]}
        options={{
          colors: [
            resolveCandlestickBodyColor(props.theme.candlestick.up.body),
            resolveCandlestickBodyColor(props.theme.candlestick.down.body),
          ],
          barWidthRatio: BAR_WIDTH_MAP[props.barWidth],
          stacking: 'off',
          entryAnimation: props.barEntryAnimation,
        }}
      />
      {props.tooltipVisible && <Tooltip />}
      {props.crosshairVisible && <Crosshair />}
      {props.axis?.y?.visible !== false && <YAxis />}
      {props.axis?.x?.visible !== false && <XAxis />}
      {props.navigatorVisible && <Navigator data={{ type: 'bar', points: display }} height={props.navigatorHeight} />}
    </ChartContainer>
  );
}

function MultiBarChart(props: PlaygroundChartProps & BarSettings & { title: string }) {
  const { datasets } = useLineStreams(layers, {
    startDelay: 500,
    interval: DEMO_INTERVAL,
    speed: 5,
    kind: 'layer',
  });
  const display = props.streaming ? datasets : layers;
  const chartAxis = useMemo<AxisConfig>(() => {
    if (props.stacking === 'off') return { ...props.axis, y: { min: 0, ...props.axis?.y } };

    return props.axis ?? {};
  }, [props.axis, props.stacking]);

  return (
    <ChartContainer
      theme={props.theme}
      axis={chartAxis}
      gradient={props.gradient}
      headerLayout={props.headerLayout}
      perf={props.perfHudVisible}
      animations={buildAnimationsProp(props)}
    >
      <Title sub={`${LAYER_COUNT} layers`}>{props.title}</Title>
      {props.infoBarVisible && <InfoBar />}
      <BarSeries
        data={display}
        options={{
          colors: props.theme.seriesColors.slice(0, display.length),
          barWidthRatio: BAR_WIDTH_MAP[props.barWidth],
          stacking: props.stacking,
          entryAnimation: props.barEntryAnimation,
        }}
      />
      {props.tooltipVisible && <Tooltip />}
      {props.crosshairVisible && <Crosshair />}
      {props.axis?.y?.visible !== false && <YAxis />}
      {props.axis?.x?.visible !== false && <XAxis />}
      <Legend />
      {props.navigatorVisible && <Navigator data={{ type: 'bar', series: display }} height={props.navigatorHeight} />}
    </ChartContainer>
  );
}

const SERIES_SECTION: SectionSpec = {
  id: 'series',
  title: 'Series',
  icon: ICONS.series,
  rows: [
    {
      key: 'barWidth',
      label: 'Width',
      render: (v, onChange) => (
        <ToggleGroup<BarWidth>
          value={v as BarWidth}
          options={[
            { value: 'thin', label: 'Thin' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
          ]}
          onChange={onChange as (v: BarWidth) => void}
        />
      ),
    },
    {
      key: 'stacking',
      label: 'Stack',
      render: (v, onChange) => (
        <ToggleGroup<BarStacking>
          value={v as BarStacking}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'normal', label: 'Normal' },
            { value: 'percent', label: '100%' },
          ]}
          onChange={onChange as (v: BarStacking) => void}
        />
      ),
    },
  ] as RowSpec[],
};

const DISPLAY_EXTRA: SectionSpec = {
  id: 'display-bar',
  title: 'Display',
  extend: 'display',
  icon: ICONS.display,
  rows: [
    {
      key: 'tooltipVisible',
      label: 'Tooltip',
      hint: 'On hover',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'infoBarVisible',
      label: 'Info bar',
      hint: 'Series values above the chart',
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

export function BarPage({ theme }: { theme: ChartTheme }) {
  return (
    <Playground<BarSettings>
      id="bar"
      theme={theme}
      extraDefaults={(mobile) => ({
        stacking: 'normal',
        barWidth: 'normal',
        infoBarVisible: !mobile,
        tooltipVisible: true,
        crosshairVisible: true,
      })}
      animationKinds={['bar']}
      sections={[DISPLAY_EXTRA, SERIES_SECTION]}
      charts={(props) => {
        const label = props.stacking === 'off' ? 'Overlapping' : props.stacking === 'normal' ? 'Stacked' : '100%';

        return (
          <>
            <Cell theme={props.theme}>
              <SingleBarChart key={`s-${props.streaming}-${props.perfHudVisible}`} {...props} />
            </Cell>
            <Cell theme={props.theme}>
              <MultiBarChart
                key={`m-${props.streaming}-${props.stacking}-${props.perfHudVisible}`}
                {...props}
                title={label}
              />
            </Cell>
          </>
        );
      }}
      codeConfig={(s) => {
        const containerProps = buildCartesianContainerProps(s) ?? {};
        if (s.perfHudVisible) containerProps.perf = true;

        const options: Record<string, PropValue> = {
          ...buildCommonSeriesOptions(s, 'bar'),
          barWidthRatio: BAR_WIDTH_MAP[s.barWidth],
          stacking: s.stacking,
        };

        const yVisible = s.axis?.y?.visible !== false;
        const xVisible = s.axis?.x?.visible !== false;

        return {
          theme: 'catppuccin.theme',
          containerProps: Object.keys(containerProps).length > 0 ? containerProps : undefined,
          components: [
            {
              component: 'BarSeries',
              props: { data: 'layers', options },
            },
            ...(s.infoBarVisible ? [{ component: 'InfoBar' }] : []),
            ...(s.tooltipVisible ? [{ component: 'Tooltip' }] : []),
            ...(s.crosshairVisible ? [{ component: 'Crosshair' }] : []),
            ...(yVisible ? [{ component: 'YAxis' }] : []),
            ...(xVisible ? [{ component: 'XAxis' }] : []),
            ...buildNavigatorComponent(s, 'layers[0]', 'bar'),
          ],
        };
      }}
    />
  );
}
