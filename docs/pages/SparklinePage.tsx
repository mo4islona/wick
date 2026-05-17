import { useMemo } from 'react';

import {
  type ChartTheme,
  Sparkline,
  type SparklineValuePosition,
  type SparklineVariant,
  type TimePoint,
} from '@wick-charts/react';

import { ICONS } from '../components/playground/icons';
import { Playground, type PlaygroundChartProps } from '../components/playground/Playground';
import { Select, Slider, ToggleGroup } from '../components/playground/primitives';
import type { RowSpec, SectionSpec } from '../components/playground/sections';
import {
  type LineStrategy,
  barStrategy,
  generateBarData,
  generateLineData,
  generateMonotonicData,
  generateWaveData,
  lineDriftStrategy,
  monotonicStrategy,
  waveStrategy,
} from '../data';
import { DEMO_INTERVAL } from '../data/demo';
import { useIsMobile, useLineStreams } from '../hooks';

// ── Sample data generators ──────────────────────────────────

// Maximum dataset size we pre-generate per row. The "Points" slider in the
// Demo section caps both the static-mode slice and the live-mode flow window
// at this value.
const SPARK_HISTORY = 200;
// Live mode mounts with `SPARK_SEED` points so the stream has `last`/
// `startIndex` to resume from; new ticks flow into the empty right side
// until the window fills. After fill, LineSeries' rolling-window path goes
// through `chart.keepLast` (smooth Y, no per-tick snap).
const SPARK_SEED = 2;
const SPARK_POINTS_MIN = 10;
const SPARK_POINTS_MAX = SPARK_HISTORY;
const SPARK_POINTS_DEFAULT = 80;

// Streaming cadence — sparklines look better moving at a brisk pace than the
// canonical 5s bar interval. Faster speed = fresh bars every ~500ms.
const SPARK_SPEED = 10;

// Off-screen left buffer. The visible window holds `points` bars; the React
// state caps at `points + STREAM_BUFFER` so a few oldest points sit just
// outside the viewport. Rolling-window trim then drops points that have
// already scrolled off, instead of yanking a still-visible point.
const STREAM_BUFFER = 5;

interface RowMeta {
  label: string;
  sublabel?: string;
  color?: string;
  variant?: SparklineVariant;
}

interface RowSeed extends RowMeta {
  data: TimePoint[];
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

function makeMonotonicRow(seed: number, label: string): RowSeed {
  const startValue = 10 + seed * 30;
  const step = 1 + seed * 0.5;
  const data = generateMonotonicData(SPARK_HISTORY, startValue, step, DEMO_INTERVAL);

  return {
    label,
    data,
    strategy: monotonicStrategy(step),
  };
}

// ── Metric card rows ────────────────────────────────────────

interface MetricRow extends RowMeta {
  data: TimePoint[];
}

const CRYPTO_LABELS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'DOT/USD', 'LINK/USD'];
const SERVER_LABELS = ['api-prod-1', 'api-prod-2', 'worker-01', 'worker-02', 'cache-redis', 'db-primary'];
const METRIC_LABELS = ['Revenue', 'Users', 'Conversion', 'Latency', 'Throughput', 'Errors'];
const MONOTONIC_LABELS = ['Counter A', 'Counter B', 'Counter C', 'Counter D', 'Counter E', 'Counter F'];

// ── Settings ────────────────────────────────────────────────

type Preset = 'crypto' | 'servers' | 'metrics' | 'monotonic';
// - static: pre-rendered snapshot, no streaming.
// - flow:   seed is pinned near the right edge of an empty `points`-wide window;
//           new ticks add to the right and existing points slide LEFT until the
//           window fills. After fill, behaves like `live` (rolling).
// - live:   pre-filled `points`-wide window, streaming with rolling-window trim
//           from tick 1. Equivalent to the dashboard streaming pattern.
type SparklineMode = 'static' | 'flow' | 'live';

interface SparklineSettings {
  variant: SparklineVariant;
  valuePos: SparklineValuePosition;
  areaVisible: boolean;
  preset: Preset;
  mode: SparklineMode;
  points: number;
}

// ── Page ────────────────────────────────────────────────────

function SparklineGrid(
  props: PlaygroundChartProps &
    SparklineSettings & {
      rows: MetricRow[];
      mobile: boolean;
      flow?: { capacity: number };
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
          flow={props.flow}
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
      hint: 'Static snapshot, flow-in from empty, or pre-filled live stream',
      render: (v, onChange) => (
        <ToggleGroup<SparklineMode>
          value={v as SparklineMode}
          options={[
            { value: 'static', label: 'Static' },
            { value: 'flow', label: 'Flow' },
            { value: 'live', label: 'Live' },
          ]}
          onChange={onChange as (v: SparklineMode) => void}
        />
      ),
    },
    {
      key: 'points',
      label: 'Points',
      hint: 'Number of data points in the visible window',
      render: (v, onChange) => (
        <Slider
          value={v as number}
          min={SPARK_POINTS_MIN}
          max={SPARK_POINTS_MAX}
          step={1}
          onChange={onChange as (v: number) => void}
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
            { value: 'monotonic', label: 'Monotonic ramp' },
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
  /** True for `flow` mode — start near-empty, fly in from right.
   *  False for `live` mode — start pre-filled, stream + roll. */
  flow: boolean;
}

// Sits inside a key={preset|points|flow} boundary so switching dataset, window
// size, or mode remounts the streaming hook with fresh seeds rather than
// tearing through the live tail.
function AnimatedSparklineGrid({ seeds, flow, ...props }: AnimatedGridProps) {
  // Flow mode mounts with a SPARK_SEED-sized seed so the stream has
  // `last`/`startIndex` to resume from; the chart pins this seed near the
  // right edge of the empty window. Live mode mounts with the full window
  // pre-filled to `props.points` bars.
  const seriesHistory = useMemo(
    () => seeds.map((s) => (flow ? s.data.slice(0, SPARK_SEED) : s.data.slice(-props.points))),
    [seeds, flow, props.points],
  );
  const strategies = useMemo(() => seeds.map((s) => s.strategy), [seeds]);

  const { datasets } = useLineStreams(seriesHistory, {
    interval: DEMO_INTERVAL,
    speed: SPARK_SPEED,
    // STREAM_BUFFER extra points sit just off-screen left so trimming
    // doesn't yank a still-visible point off the canvas.
    maxPoints: props.points + STREAM_BUFFER,
    strategy: (_series, i) => strategies[i],
  });

  const rows: MetricRow[] = seeds.map((seed, i) => ({
    label: seed.label,
    sublabel: seed.sublabel,
    color: seed.color,
    variant: seed.variant,
    data: datasets[i]?.length ? datasets[i] : seriesHistory[i],
  }));

  return <SparklineGrid {...props} rows={rows} flow={flow ? { capacity: props.points } : undefined} />;
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
    const monotonic = MONOTONIC_LABELS.map((label, i) => makeMonotonicRow(i, label));

    return { crypto, servers, metrics, monotonic };
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
        mode: 'flow',
        points: SPARK_POINTS_DEFAULT,
      }}
      sections={[DEMO_SECTION, SERIES_SECTION, VALUE_SECTION, DATASET_SECTION]}
      charts={(props) => {
        const presetSeeds = seedsByPreset[props.preset];
        const seeds: RowSeed[] = presetSeeds.map((seed, i) => ({
          ...seed,
          color: seed.variant === 'bar' ? undefined : theme.seriesColors[i % theme.seriesColors.length],
        }));

        if (props.mode === 'static') {
          // Slice the tail of pre-generated history so the user sees exactly
          // `points` of data. Static mode has no flow window — the chart
          // fits to whatever it gets.
          const rows: MetricRow[] = seeds.map((s) => ({
            label: s.label,
            sublabel: s.sublabel,
            color: s.color,
            variant: s.variant,
            data: s.data.slice(-props.points),
          }));

          return <SparklineGrid {...props} rows={rows} mobile={mobile} />;
        }

        // Remount the streaming hook when preset, window size, or mode
        // changes — otherwise the existing live tail would be reinterpreted
        // mid-flight by a fresh seed or new viewport pinning.
        return (
          <AnimatedSparklineGrid
            key={`${props.preset}-${props.points}-${props.mode}`}
            {...props}
            seeds={seeds}
            mobile={mobile}
            flow={props.mode === 'flow'}
          />
        );
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
