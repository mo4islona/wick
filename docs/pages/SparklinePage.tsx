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
import {
  type LineStrategy,
  barStrategy,
  generateBarData,
  generateLineData,
  generateWaveData,
  lineDriftStrategy,
  waveStrategy,
} from '../data';
import { DEMO_INTERVAL } from '../data/demo';
import { useIsMobile, useLineStreams } from '../hooks';

// ── Sample data generators ──────────────────────────────────

const SPARK_HISTORY = 80;

// Streaming cadence — sparklines look better moving at a brisk pace than the
// canonical 5s bar interval. Faster speed = fresh bars every ~500ms.
const SPARK_SPEED = 10;

interface RowMeta {
  label: string;
  sublabel?: string;
  color?: string;
  variant?: SparklineVariant;
}

interface RowSeed extends RowMeta {
  data: LineData[];
  strategy: LineStrategy;
}

function makeLineRow(seed: number, label: string, sublabel?: string): RowSeed {
  const startValue = 40 + seed * 20;
  const data = generateLineData(SPARK_HISTORY, startValue, DEMO_INTERVAL);

  return { label, sublabel, data, strategy: lineDriftStrategy(data[data.length - 1]?.value ?? startValue) };
}

function makeWaveRow(seed: number, label: string, sublabel?: string): RowSeed {
  const opts = {
    base: 10 + seed * 5,
    amplitude: 50 + seed * 30,
    period: 20 + seed * 8,
    phase: seed * 0.3,
    interval: DEMO_INTERVAL,
  };
  const data = generateWaveData(SPARK_HISTORY, opts);

  return {
    label,
    sublabel,
    data,
    strategy: waveStrategy({ ...opts, totalHint: SPARK_HISTORY }),
  };
}

function makeBarRow(label: string): RowSeed {
  return {
    label,
    variant: 'bar',
    data: generateBarData(SPARK_HISTORY, DEMO_INTERVAL),
    strategy: barStrategy(100),
  };
}

// ── Metric card rows ────────────────────────────────────────

interface MetricRow extends RowMeta {
  data: LineData[];
}

const CRYPTO_LABELS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'DOT/USD', 'LINK/USD'];
const SERVER_LABELS = ['api-prod-1', 'api-prod-2', 'worker-01', 'worker-02', 'cache-redis', 'db-primary'];
const METRIC_LABELS = ['Revenue', 'Users', 'Conversion', 'Latency', 'Throughput', 'Errors'];

// ── Settings ────────────────────────────────────────────────

type Preset = 'crypto' | 'servers' | 'metrics';
type SparklineMode = 'static' | 'live';

interface SparklineSettings {
  variant: SparklineVariant;
  valuePos: SparklineValuePosition;
  areaVisible: boolean;
  preset: Preset;
  mode: SparklineMode;
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

// Mirrors the built-in Demo section that cartesian pages render via Playground.
// `hideCartesian` suppresses the built-in version here, so the page owns it.
const DEMO_SECTION: SectionSpec = {
  id: 'demo',
  title: 'Demo',
  icon: ICONS.data,
  defaultOpen: true,
  rows: [
    {
      key: 'mode',
      label: 'Mode',
      hint: 'Stream mock data vs. static snapshot',
      render: (v, onChange) => (
        <ToggleGroup<SparklineMode>
          value={v as SparklineMode}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'static', label: 'Static' },
          ]}
          onChange={onChange as (v: SparklineMode) => void}
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

// ── Live sparkline grid ─────────────────────────────────────

interface AnimatedGridProps extends PlaygroundChartProps, SparklineSettings {
  seeds: RowSeed[];
  mobile: boolean;
}

// Sits inside a key={preset} boundary so switching dataset remounts the
// streaming hook with fresh seeds rather than tearing through the live tail.
function AnimatedSparklineGrid({ seeds, ...props }: AnimatedGridProps) {
  const seriesHistory = useMemo(() => seeds.map((s) => s.data), [seeds]);
  const strategies = useMemo(() => seeds.map((s) => s.strategy), [seeds]);

  const { datasets } = useLineStreams(seriesHistory, {
    interval: DEMO_INTERVAL,
    speed: SPARK_SPEED,
    maxPoints: SPARK_HISTORY,
    strategy: (_series, i) => strategies[i],
  });

  const rows: MetricRow[] = seeds.map((seed, i) => ({
    label: seed.label,
    sublabel: seed.sublabel,
    color: seed.color,
    variant: seed.variant,
    data: datasets[i]?.length ? datasets[i] : seed.data,
  }));

  return <SparklineGrid {...props} rows={rows} />;
}

export function SparklinePage({ theme }: { theme: ChartTheme }) {
  const mobile = useIsMobile();

  // Pre-generate seeds with bundled streaming strategies — keeps history and
  // live samplers statistically aligned per row.
  const seedsByPreset = useMemo(() => {
    const crypto = CRYPTO_LABELS.map((label, i) => makeLineRow(i, label));
    const servers = SERVER_LABELS.map((label, i) =>
      makeWaveRow(i, label, `${(95 + Math.random() * 5).toFixed(1)}% uptime`),
    );
    const metrics = METRIC_LABELS.map((label, i) => (i === 5 ? makeBarRow(label) : makeLineRow(i + 3, label)));

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
        mode: 'live',
      }}
      sections={[DEMO_SECTION, SERIES_SECTION, VALUE_SECTION, DATASET_SECTION]}
      charts={(props) => {
        const presetSeeds = seedsByPreset[props.preset];
        const seeds: RowSeed[] = presetSeeds.map((seed, i) => ({
          ...seed,
          color: seed.variant === 'bar' ? undefined : theme.seriesColors[i % theme.seriesColors.length],
        }));

        if (props.mode === 'static') {
          const rows: MetricRow[] = seeds.map((s) => ({
            label: s.label,
            sublabel: s.sublabel,
            color: s.color,
            variant: s.variant,
            data: s.data,
          }));

          return <SparklineGrid {...props} rows={rows} mobile={mobile} />;
        }

        return <AnimatedSparklineGrid key={props.preset} {...props} seeds={seeds} mobile={mobile} />;
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
