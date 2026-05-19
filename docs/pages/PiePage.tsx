import {
  ChartContainer,
  type ChartTheme,
  PieLegend,
  type PieLegendPosition,
  PieSeries,
  type PieSliceData,
  PieTooltip,
  Title,
} from '@wick-charts/react';

import { Cell } from '../components/Cell';
import { ICONS } from '../components/playground/icons';
import { Playground, type PlaygroundChartProps } from '../components/playground/Playground';
import { Select, Slider, Toggle, ToggleGroup } from '../components/playground/primitives';
import type { RowSpec, SectionSpec } from '../components/playground/sections';

type PieLabelMode = 'outside' | 'inside' | 'none';
type PieLabelContent = 'percent' | 'label' | 'both';
type PieLegendMode = 'value' | 'percent' | 'both';

interface PieSettings {
  donut: boolean;
  tooltipVisible: boolean;
  legendVisible: boolean;
  animate: boolean;
  shadow: boolean;
  shadowAlpha: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  innerShadow: boolean;
  innerShadowAlpha: number;
  innerShadowDepthPct: number;
  innerRatioPct: number;
  padAngle: number;
  labelMode: PieLabelMode;
  labelContent: PieLabelContent;
  labelFontSize: number;
  labelGap: number;
  labelDistance: number;
  labelRailWidth: number;
  cardinality: number;
  legendPosition: PieLegendPosition;
  legendMode: PieLegendMode;
}

const PORTFOLIO: PieSliceData[] = [
  { label: 'BTC', value: 42 },
  { label: 'ETH', value: 28 },
  { label: 'SOL', value: 12 },
  { label: 'AVAX', value: 8 },
  { label: 'DOT', value: 6 },
  { label: 'Other', value: 4 },
];

const REVENUE: PieSliceData[] = [
  { label: 'Subscriptions', value: 55 },
  { label: 'Trading fees', value: 25 },
  { label: 'Staking', value: 12 },
  { label: 'Other', value: 8 },
];

const CHAINS: PieSliceData[] = [
  { label: 'Ethereum', value: 58 },
  { label: 'Solana', value: 18 },
  { label: 'BSC', value: 10 },
  { label: 'Avalanche', value: 7 },
  { label: 'Polygon', value: 5 },
  { label: 'Other', value: 2 },
];

// Synthetic "Stress" dataset driven by the cardinality slider. Values decay
// exponentially so the top slice dominates and the tail produces many small
// slices — the pattern that most visibly stresses outside-label layout.
function synthStress(n: number): PieSliceData[] {
  const data: PieSliceData[] = [];
  for (let i = 0; i < n; i++) {
    data.push({ label: `S${i + 1}`, value: 100 * 0.8 ** i });
  }

  return data;
}

function PieChart({
  theme,
  gradient,
  data,
  donut,
  tooltipVisible,
  legendVisible,
  animate,
  shadow,
  shadowAlpha,
  shadowBlur,
  shadowOffsetX,
  shadowOffsetY,
  innerShadow,
  innerShadowAlpha,
  innerShadowDepthPct,
  innerRatioPct,
  padAngle,
  labelMode,
  labelContent,
  labelFontSize,
  labelGap,
  labelDistance,
  labelRailWidth,
  legendPosition,
  legendMode,
  perfHudVisible,
  title,
}: PlaygroundChartProps & PieSettings & { data: PieSliceData[]; title: string }) {
  const sid = 'pie';

  return (
    <ChartContainer
      theme={theme}
      axis={{ y: { visible: false, width: 0 }, x: { visible: false, height: 0 } }}
      gradient={gradient}
      grid={{ visible: false }}
      perf={perfHudVisible}
    >
      <Title sub={donut ? 'donut' : 'pie'}>{title}</Title>
      <PieSeries
        id={sid}
        data={data}
        options={{
          innerRadiusRatio: donut ? innerRatioPct / 100 : 0,
          padAngle,
          animate,
          shadow: shadow
            ? {
                color: `rgba(0, 0, 0, ${shadowAlpha})`,
                blur: shadowBlur,
                offsetX: shadowOffsetX,
                offsetY: shadowOffsetY,
              }
            : false,
          innerShadow: innerShadow
            ? { color: `rgba(0, 0, 0, ${innerShadowAlpha})`, depth: innerShadowDepthPct / 100 }
            : false,
          sliceLabels: {
            mode: labelMode,
            content: labelContent,
            fontSize: labelFontSize,
            labelGap,
            distance: labelDistance,
            railWidth: labelRailWidth,
          },
        }}
      />
      {tooltipVisible && <PieTooltip seriesId={sid} />}
      {legendVisible && <PieLegend seriesId={sid} position={legendPosition} mode={legendMode} />}
    </ChartContainer>
  );
}

const DISPLAY_EXTRA: SectionSpec = {
  id: 'display-pie',
  title: 'Display',
  extend: 'display',
  icon: ICONS.display,
  rows: [
    {
      key: 'donut',
      label: 'Donut',
      hint: 'Cut a hole in the middle of the pie.',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'tooltipVisible',
      label: 'Tooltip',
      hint: 'Show a tooltip for the hovered slice.',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'legendVisible',
      label: 'Legend',
      hint: 'Render the PieLegend alongside the chart.',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'animate',
      label: 'Animate',
      hint: 'Entrance draw-in and hover-explode motion.',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
  ] as RowSpec[],
};

const SHADOW_SECTION: SectionSpec = {
  id: 'shadow-pie',
  title: 'Shadow',
  icon: ICONS.display,
  rows: [
    {
      key: 'shadow',
      label: 'Drop shadow',
      hint: 'Soft outer shadow cast behind each slice.',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'shadowAlpha',
      label: 'Drop opacity',
      hint: 'Alpha of the drop-shadow color.',
      visible: (s) => s.shadow === true,
      render: (v, onChange) => (
        <Slider value={v as number} min={0.05} max={0.6} step={0.05} onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'shadowBlur',
      label: 'Drop blur',
      hint: 'Shadow blur radius in pixels.',
      visible: (s) => s.shadow === true,
      render: (v, onChange) => (
        <Slider value={v as number} min={0} max={60} step={2} suffix="px" onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'shadowOffsetX',
      label: 'Drop offset X',
      hint: 'Horizontal displacement of the shadow.',
      visible: (s) => s.shadow === true,
      render: (v, onChange) => (
        <Slider
          value={v as number}
          min={-20}
          max={20}
          step={1}
          suffix="px"
          onChange={onChange as (v: number) => void}
        />
      ),
    },
    {
      key: 'shadowOffsetY',
      label: 'Drop offset Y',
      hint: 'Vertical displacement of the shadow.',
      visible: (s) => s.shadow === true,
      render: (v, onChange) => (
        <Slider
          value={v as number}
          min={-20}
          max={40}
          step={1}
          suffix="px"
          onChange={onChange as (v: number) => void}
        />
      ),
    },
    {
      key: 'innerShadow',
      label: 'Inner shadow',
      hint: 'Rim darkening inside each slice edge.',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    },
    {
      key: 'innerShadowAlpha',
      label: 'Inner opacity',
      hint: 'Alpha of the inner rim color.',
      visible: (s) => s.innerShadow === true,
      render: (v, onChange) => (
        <Slider value={v as number} min={0.05} max={0.7} step={0.05} onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'innerShadowDepthPct',
      label: 'Inner depth',
      hint: 'How far the rim darkening reaches inward.',
      visible: (s) => s.innerShadow === true,
      render: (v, onChange) => (
        <Slider value={v as number} min={5} max={60} step={5} suffix="%" onChange={onChange as (v: number) => void} />
      ),
    },
  ] as RowSpec[],
};

const LABEL_MODE_OPTIONS = [
  { value: 'outside' as const, label: 'Outside' },
  { value: 'inside' as const, label: 'Inside' },
  { value: 'none' as const, label: 'None' },
];

const LABEL_CONTENT_OPTIONS = [
  { value: 'both' as const, label: 'Both' },
  { value: 'percent' as const, label: '%' },
  { value: 'label' as const, label: 'Name' },
];

const LEGEND_POSITION_OPTIONS = [
  { value: 'bottom' as const, label: 'Bottom' },
  { value: 'right' as const, label: 'Right' },
];

const LEGEND_MODE_OPTIONS = [
  { value: 'both' as const, label: 'Both' },
  { value: 'value' as const, label: 'Value' },
  { value: 'percent' as const, label: '%' },
];

const GEOMETRY_SECTION: SectionSpec = {
  id: 'geometry-pie',
  title: 'Geometry',
  icon: ICONS.display,
  rows: [
    {
      key: 'innerRatioPct',
      label: 'Donut hole',
      hint: 'Inner radius as a fraction of the outer one.',
      visible: (s) => s.donut === true,
      render: (v, onChange) => (
        <Slider value={v as number} min={0} max={85} step={5} suffix="%" onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'padAngle',
      label: 'Slice gap',
      hint: 'Angular gap carved out between adjacent slices.',
      render: (v, onChange) => (
        <Slider value={v as number} min={0} max={8} step={0.5} suffix="°" onChange={onChange as (v: number) => void} />
      ),
    },
  ] as RowSpec[],
};

const LABELS_SECTION: SectionSpec = {
  id: 'labels-pie',
  title: 'Labels',
  icon: ICONS.display,
  rows: [
    {
      key: 'labelMode',
      label: 'Mode',
      hint: 'Where per-slice labels live.',
      render: (v, onChange) => (
        <ToggleGroup<PieLabelMode>
          value={v as PieLabelMode}
          options={LABEL_MODE_OPTIONS}
          onChange={onChange as (v: PieLabelMode) => void}
        />
      ),
    },
    {
      key: 'labelContent',
      label: 'Content',
      hint: 'Label text: name, percent, or both.',
      render: (v, onChange) => (
        <Select<PieLabelContent>
          value={v as PieLabelContent}
          options={LABEL_CONTENT_OPTIONS}
          onChange={onChange as (v: PieLabelContent) => void}
        />
      ),
    },
    {
      key: 'labelFontSize',
      label: 'Font size',
      hint: 'Label text size in pixels.',
      render: (v, onChange) => (
        <Slider value={v as number} min={8} max={18} step={1} suffix="px" onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'labelGap',
      label: 'Label gap',
      hint: 'Min vertical gap between same-side labels (× fontSize).',
      render: (v, onChange) => (
        <Slider value={v as number} min={0.8} max={3} step={0.1} onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'labelDistance',
      label: 'Distance',
      hint: 'Radial gap between pie edge and label anchor.',
      render: (v, onChange) => (
        <Slider value={v as number} min={8} max={60} step={2} suffix="px" onChange={onChange as (v: number) => void} />
      ),
    },
    {
      key: 'labelRailWidth',
      label: 'Rail width',
      hint: 'Length of the horizontal tail before the text.',
      render: (v, onChange) => (
        <Slider value={v as number} min={0} max={60} step={2} suffix="px" onChange={onChange as (v: number) => void} />
      ),
    },
  ] as RowSpec[],
};

const STRESS_SECTION: SectionSpec = {
  id: 'stress-pie',
  title: 'Stress',
  // Merge into the built-in Demo section — the cardinality slider changes
  // what the live preview shows (one cell swaps to a synthetic dataset), so
  // it belongs with the other preview-control rows rather than alongside
  // real chart options that'd appear in the copied code snippet.
  extend: 'demo',
  icon: ICONS.display,
  rows: [
    {
      key: 'cardinality',
      label: 'Slices',
      // Drives the number of slices in the synthetic "Stress" cell only;
      // the other three cells keep fixed presets for baseline comparison.
      render: (v, onChange) => (
        <Slider value={v as number} min={3} max={30} step={1} onChange={onChange as (v: number) => void} />
      ),
    },
  ] as RowSpec[],
};

const LEGEND_SECTION: SectionSpec = {
  id: 'legend-pie',
  title: 'Legend',
  icon: ICONS.display,
  rows: [
    {
      key: 'legendPosition',
      label: 'Position',
      render: (v, onChange) => (
        <ToggleGroup<PieLegendPosition>
          value={v as PieLegendPosition}
          options={LEGEND_POSITION_OPTIONS}
          onChange={onChange as (v: PieLegendPosition) => void}
        />
      ),
    },
    {
      key: 'legendMode',
      label: 'Content',
      render: (v, onChange) => (
        <ToggleGroup<PieLegendMode>
          value={v as PieLegendMode}
          options={LEGEND_MODE_OPTIONS}
          onChange={onChange as (v: PieLegendMode) => void}
        />
      ),
    },
  ] as RowSpec[],
};

export function PiePage({ theme }: { theme: ChartTheme }) {
  return (
    <Playground<PieSettings>
      id="pie"
      theme={theme}
      extraDefaults={{
        donut: true,
        tooltipVisible: false,
        legendVisible: true,
        animate: false,
        shadow: false,
        shadowAlpha: 0.22,
        shadowBlur: 24,
        shadowOffsetX: 0,
        shadowOffsetY: 10,
        innerShadow: false,
        innerShadowAlpha: 0.1,
        innerShadowDepthPct: 30,
        innerRatioPct: 55,
        padAngle: 1.7,
        labelMode: 'outside',
        labelContent: 'both',
        labelFontSize: 11,
        labelGap: 1.8,
        labelDistance: 14,
        labelRailWidth: 16,
        cardinality: 5,
        legendPosition: 'bottom',
        legendMode: 'both',
      }}
      gridTemplate="1fr 1fr"
      gridColumns="1fr 1fr"
      hideCartesian
      animationKinds={['pie']}
      sections={[DISPLAY_EXTRA, GEOMETRY_SECTION, SHADOW_SECTION, LABELS_SECTION, STRESS_SECTION, LEGEND_SECTION]}
      charts={(props) => (
        <>
          <Cell theme={props.theme}>
            <PieChart key={`portfolio-${props.perfHudVisible}`} {...props} data={PORTFOLIO} title="Portfolio" />
          </Cell>
          <Cell theme={props.theme}>
            <PieChart key={`revenue-${props.perfHudVisible}`} {...props} data={REVENUE} title="Revenue" />
          </Cell>
          <Cell theme={props.theme}>
            <PieChart key={`chains-${props.perfHudVisible}`} {...props} data={CHAINS} title="Chains" />
          </Cell>
          <Cell theme={props.theme}>
            <PieChart
              key={`stress-${props.perfHudVisible}`}
              {...props}
              data={synthStress(props.cardinality)}
              title="Stress"
            />
          </Cell>
        </>
      )}
      codeConfig={(s) => ({
        theme: 'catppuccin.theme',
        components: [
          {
            component: 'PieSeries',
            props: {
              id: 'sid',
              data: 'data',
              options: {
                innerRadiusRatio: s.donut ? s.innerRatioPct / 100 : 0,
                padAngle: s.padAngle,
                animate: s.animate,
                shadow: s.shadow
                  ? {
                      color: `rgba(0, 0, 0, ${s.shadowAlpha})`,
                      blur: s.shadowBlur,
                      offsetX: s.shadowOffsetX,
                      offsetY: s.shadowOffsetY,
                    }
                  : false,
                innerShadow: s.innerShadow
                  ? { color: `rgba(0, 0, 0, ${s.innerShadowAlpha})`, depth: s.innerShadowDepthPct / 100 }
                  : false,
                sliceLabels: {
                  mode: s.labelMode,
                  content: s.labelContent,
                  fontSize: s.labelFontSize,
                  labelGap: s.labelGap,
                  distance: s.labelDistance,
                  railWidth: s.labelRailWidth,
                },
              },
            },
          },
          // PieTooltip / PieLegend auto-pick the first visible pie series
          // when seriesId is omitted — there's only one in the playground,
          // so emitting it would just be noise in the copied snippet.
          ...(s.tooltipVisible ? [{ component: 'PieTooltip', props: {} }] : []),
          ...(s.legendVisible
            ? [
                {
                  component: 'PieLegend',
                  props: { position: s.legendPosition, mode: s.legendMode },
                },
              ]
            : []),
        ],
      })}
    />
  );
}
