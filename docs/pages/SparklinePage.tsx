import { useMemo } from 'react';

import {
  type ChartTheme,
  type LineData,
  Sparkline,
  type SparklineValuePosition,
  type SparklineVariant,
} from '@wick-charts/react';

import { ICONS } from '../components/playground/icons';
import { Playground, type PlaygroundChartProps } from '../components/playground/Playground';
import { Select, ToggleGroup } from '../components/playground/primitives';
import type { RowSpec, SectionSpec } from '../components/playground/sections';
import { generateBarData, generateLineData, generateWaveData } from '../data';
import { DEMO_INTERVAL } from '../data/demo';
import { useIsMobile } from '../hooks';

// ── Sample data generators ──────────────────────────────────

function makeSparkData(seed: number, count = 60): LineData[] {
  return generateLineData(count, 40 + seed * 20, DEMO_INTERVAL);
}

function makeWaveSparkData(seed: number, count = 60): LineData[] {
  return generateWaveData(count, {
    base: 10 + seed * 5,
    amplitude: 50 + seed * 30,
    period: 20 + seed * 8,
    phase: seed * 0.3,
    interval: DEMO_INTERVAL,
  });
}

function makeBarSparkData(count = 60): LineData[] {
  return generateBarData(count, DEMO_INTERVAL);
}

// ── Metric card rows ────────────────────────────────────────

interface MetricRow {
  label: string;
  sublabel?: string;
  data: LineData[];
  color?: string;
  variant?: SparklineVariant;
}

const CRYPTO_LABELS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'DOT/USD', 'LINK/USD'];
const SERVER_LABELS = ['api-prod-1', 'api-prod-2', 'worker-01', 'worker-02', 'cache-redis', 'db-primary'];
const METRIC_LABELS = ['Revenue', 'Users', 'Conversion', 'Latency', 'Throughput', 'Errors'];

// ── Settings ────────────────────────────────────────────────

type Preset = 'crypto' | 'servers' | 'metrics';

interface SparklineSettings {
  variant: SparklineVariant;
  valuePos: SparklineValuePosition;
  areaVisible: boolean;
  preset: Preset;
}

// ── Page ────────────────────────────────────────────────────

function SparklineGrid(
  props: PlaygroundChartProps &
    SparklineSettings & {
      rows: MetricRow[];
      mobile: boolean;
    },
) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: props.mobile ? '1fr' : 'repeat(auto-fill, minmax(310, 1fr))',
        gap: 8,
        padding: 4,
      }}
    >
      {props.rows.map((row) => (
        <Sparkline
          key={row.label}
          data={row.data}
          theme={props.theme}
          variant={row.variant ?? props.variant}
          valuePosition={props.valuePos}
          label={row.label}
          sublabel={row.sublabel}
          color={row.color}
          area={{ visible: props.areaVisible }}
          gradient={props.gradient}
          width={props.mobile ? 120 : 150}
          height={props.mobile ? 40 : 48}
          style={{ width: '100%' }}
        />
      ))}
    </div>
  );
}

const SERIES_SECTION: SectionSpec = {
  id: 'series',
  title: 'Sparkline',
  icon: ICONS.series,
  rows: [
    {
      key: 'variant',
      label: 'Type',
      render: (v, onChange) => (
        <ToggleGroup<SparklineVariant>
          value={v as SparklineVariant}
          options={[
            { value: 'line', label: 'Line' },
            { value: 'bar', label: 'Bar' },
          ]}
          onChange={onChange as (v: SparklineVariant) => void}
        />
      ),
    },
    {
      key: 'areaVisible',
      label: 'Fill',
      render: (v, onChange) => (
        <ToggleGroup<'on' | 'off'>
          value={(v as boolean) ? 'on' : 'off'}
          options={[
            { value: 'on', label: 'Area' },
            { value: 'off', label: 'Line only' },
          ]}
          onChange={(next) => (onChange as (v: boolean) => void)(next === 'on')}
        />
      ),
    },
  ] as RowSpec[],
};

const VALUE_SECTION: SectionSpec = {
  id: 'value',
  title: 'Value',
  icon: ICONS.display,
  rows: [
    {
      key: 'valuePos',
      label: 'Position',
      render: (v, onChange) => (
        <ToggleGroup<SparklineValuePosition>
          value={v as SparklineValuePosition}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
            { value: 'none', label: 'None' },
          ]}
          onChange={onChange as (v: SparklineValuePosition) => void}
        />
      ),
    },
  ] as RowSpec[],
};

const DATASET_SECTION: SectionSpec = {
  id: 'dataset',
  title: 'Dataset',
  icon: ICONS.data,
  rows: [
    {
      key: 'preset',
      label: 'Preset',
      render: (v, onChange) => (
        <Select<Preset>
          value={v as Preset}
          options={[
            { value: 'crypto', label: 'Crypto prices' },
            { value: 'servers', label: 'Server health' },
            { value: 'metrics', label: 'KPI metrics' },
          ]}
          onChange={onChange as (v: Preset) => void}
        />
      ),
    },
  ] as RowSpec[],
};

export function SparklinePage({ theme }: { theme: ChartTheme }) {
  const mobile = useIsMobile();

  // Pre-generate datasets to avoid re-creation on every render
  const datasets = useMemo(() => {
    const crypto = CRYPTO_LABELS.map((label, i) => ({
      label,
      data: makeSparkData(i, 80),
    }));
    const servers = SERVER_LABELS.map((label, i) => ({
      label,
      sublabel: `${(95 + Math.random() * 5).toFixed(1)}% uptime`,
      data: makeWaveSparkData(i, 80),
    }));
    const metrics = METRIC_LABELS.map((label, i) => ({
      label,
      data: i === 5 ? makeBarSparkData(80) : makeSparkData(i + 3, 80),
      variant: (i === 5 ? 'bar' : 'line') as SparklineVariant,
    }));

    return { crypto, servers, metrics };
  }, []);

  return (
    <Playground<SparklineSettings>
      id="sparkline"
      theme={theme}
      hideCartesian
      showPerfHud={false}
      extraDefaults={{
        variant: 'line',
        valuePos: 'right',
        areaVisible: true,
        preset: 'crypto',
      }}
      sections={[SERIES_SECTION, VALUE_SECTION, DATASET_SECTION]}
      charts={(props) => {
        const presetData = datasets[props.preset];
        const rows: MetricRow[] = presetData.map((d, i) => ({
          ...d,
          color: 'variant' in d && d.variant === 'bar' ? undefined : theme.seriesColors[i % theme.seriesColors.length],
        }));

        return <SparklineGrid {...props} rows={rows} mobile={mobile} />;
      }}
      codeConfig={(s) => ({
        theme: 'catppuccin.theme',
        components: [
          {
            component: 'Sparkline',
            props: {
              data: 'data',
              variant: s.variant,
              valuePosition: s.valuePos,
              ...(s.areaVisible ? { area: { visible: true } } : {}),
            },
          },
        ],
      })}
    />
  );
}
