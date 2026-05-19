import { type CSSProperties, useEffect, useState } from 'react';

import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  type ChartTheme,
  Crosshair,
  InfoBar,
  LineSeries,
  TimeAxis,
  Title,
  Tooltip,
  YAxis,
  YLabel,
  resolveCandlestickBodyColor,
} from '@wick-charts/react';

import { Cell } from '../components/Cell';
import { FrameworkSelect } from '../components/FrameworkSelect';
import { HighlightedCode } from '../components/playground/CodeView';
import { Slider } from '../components/playground/primitives';
import { WickLogo } from '../components/WickLogo';
import { WickWordmark } from '../components/WickWordmark';
import '../components/playground/styles.css';

import { DEMO_INTERVAL, areaLine, barSingle, lowerBand, multiLines, ohlcBTC, upperBand } from '../data/demo';
import { type Framework, useFramework, useIsMobile, useLatestVersion, useLineStreams, useOHLCStream } from '../hooks';
import { hexToRgba } from '../utils';

// Pre-bundled series arrays with stable identity so the streaming hooks
// don't rebuild their source on every dashboard re-render.
const AREA_BANDS_SERIES = [areaLine, upperBand, lowerBand];
const BAR_SERIES = [barSingle];

// Keep a fixed visible window per chart so fast-speed streams don't
// accumulate points indefinitely.
const MAX_POINTS = 300;

// Candle chart zooms in to the most recent N bars on mount — imperative API
// call, so the buffer stays at MAX_POINTS and the user can pan back for history.
// Kept low so each candle reads cleanly and the body/wick proportions stand
// out — the headline chart is meant to showcase candle rendering quality.
const INITIAL_CANDLE_BARS = 35;

// The speed slider is a developer-only escape hatch; hidden unless `debug`
// appears in the URL. Docs uses hash routing, so the flag may live in
// either `?debug` (before the hash) or `#/route?debug` (after it).
function hasDebugFlag(): boolean {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  if (search.has('debug')) return true;
  const hash = window.location.hash;
  const hashQueryStart = hash.indexOf('?');
  if (hashQueryStart === -1) return false;
  return new URLSearchParams(hash.slice(hashQueryStart)).has('debug');
}
const DEBUG = hasDebugFlag();

interface StreamProps {
  theme: ChartTheme;
  speed: number;
}

// ── Chart components ──────────────────────────────────────────

function CandleChart({ theme, speed }: StreamProps) {
  const { data } = useOHLCStream(ohlcBTC, { interval: DEMO_INTERVAL, speed, maxPoints: MAX_POINTS });
  const sid = 'candle';
  const mobile = useIsMobile();
  return (
    <ChartContainer theme={theme} viewport={{ initialRange: INITIAL_CANDLE_BARS }}>
      <Title sub="Live Candlestick">BTC/USD</Title>
      {!mobile && <InfoBar />}
      <CandlestickSeries id={sid} data={data} />
      <YLabel seriesId={sid} />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function AreaBandsChart({ theme, speed }: StreamProps) {
  // Historical bands come from `generateBandLine(ohlcETH, ±1)` — i.e. they
  // are derived from the same OHLC source. In live mode we don't stream
  // that OHLC, so each of the three series drifts independently; accepting
  // the visual approximation rather than coordinating three streams.
  const { datasets } = useLineStreams(AREA_BANDS_SERIES, {
    interval: DEMO_INTERVAL,
    speed,
    maxPoints: MAX_POINTS,
  });
  const mobile = useIsMobile();
  return (
    <ChartContainer theme={theme}>
      <Title sub="Live Area + Bands">ETH/USD</Title>
      {!mobile && <InfoBar />}
      <LineSeries data={[datasets[0]]} options={{ area: { visible: true }, strokeWidth: 1 }} />
      <LineSeries
        data={[datasets[1]]}
        options={{ colors: [theme.bands.upper], area: { visible: true }, strokeWidth: 1 }}
      />
      <LineSeries
        data={[datasets[2]]}
        options={{ colors: [theme.bands.lower], area: { visible: true }, strokeWidth: 1 }}
      />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function MultiLineChart({ theme, speed }: StreamProps) {
  const { datasets } = useLineStreams(multiLines, { interval: DEMO_INTERVAL, speed, maxPoints: MAX_POINTS });
  return (
    <ChartContainer theme={theme}>
      <Title sub="10 assets · Live">Portfolio</Title>
      <LineSeries
        data={datasets}
        options={{ colors: theme.seriesColors.slice(0, datasets.length), area: { visible: false }, strokeWidth: 1 }}
      />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function BarChart({ theme, speed }: StreamProps) {
  const { datasets } = useLineStreams(BAR_SERIES, {
    interval: DEMO_INTERVAL,
    kind: 'bar',
    speed,
    maxPoints: MAX_POINTS,
  });
  return (
    <ChartContainer theme={theme}>
      <Title sub="Live Bar">P&L Delta</Title>
      <BarSeries
        data={[datasets[0]]}
        options={{
          colors: [
            resolveCandlestickBodyColor(theme.candlestick.up.body),
            resolveCandlestickBodyColor(theme.candlestick.down.body),
          ],
        }}
      />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

// ── Speed control ─────────────────────────────────────────────

function SpeedControl({
  value,
  onChange,
  theme,
  mobile,
}: {
  value: number;
  onChange: (v: number) => void;
  theme: ChartTheme;
  mobile: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: mobile ? '0 6px' : '0 12px',
        opacity: 0.55,
      }}
    >
      <div style={{ width: mobile ? '100%' : 150 }}>
        <Slider
          label="Speed"
          value={value}
          onChange={onChange}
          min={1}
          max={20}
          step={1}
          theme={theme}
          suffix="×"
          accentColor={theme.axis.textColor}
        />
      </div>
    </div>
  );
}

// ── Feature pills ─────────────────────────────────────────────

const FEATURES = ['AI-first', 'React · Svelte · Vue', 'Realtime', 'Themeable', 'MIT'];

function FeaturePill({ text, theme }: { text: string; theme: ChartTheme }) {
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 100,
        border: `1px solid ${theme.tooltip.borderColor}`,
        background: hexToRgba(theme.crosshair.labelBackground, 0.4),
        color: theme.tooltip.textColor,
        opacity: 0.7,
        fontSize: theme.axis.fontSize,
        fontFamily: theme.typography.fontFamily,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

// ── Hero section ──────────────────────────────────────────────

const FRAMEWORKS = [
  {
    name: 'React',
    color: '#61DAFB',
    icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
        <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="4"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          transform="rotate(60 12 12)"
        />
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="4"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          transform="rotate(120 12 12)"
        />
      </svg>
    ),
  },
  {
    name: 'Vue',
    color: '#42b883',
    icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
        <path d="M2 3h3.5L12 14.5 18.5 3H22L12 21 2 3z" opacity="0.6" />
        <path d="M7.5 3L12 10.5 16.5 3H14L12 6.5 10 3H7.5z" />
      </svg>
    ),
  },
  {
    name: 'Svelte',
    color: '#FF3E00',
    icon: (
      <svg viewBox="0 0 512 512" width="17" height="17">
        <path
          d="M416.9 93.1c-41.1-58.9-122.4-76.3-181.2-38.9L132.5 120c-28.2 17.7-47.6 46.5-53.5 79.3-4.9 27.3-.6 55.5 12.3 80-8.8 13.4-14.9 28.5-17.7 44.2-5.9 33.4 1.8 67.8 21.6 95.4 41.2 58.9 122.4 76.3 181.2 38.9L379.6 392c28.2-17.7 47.6-46.5 53.5-79.3 4.9-27.3.6-55.5-12.3-80 8.8-13.4 14.9-28.4 17.7-44.2 5.8-33.4-1.9-67.8-21.6-95.4"
          fill="#ff3e00"
        />
        <path
          d="M225.6 424.5c-33.3 8.6-68.4-4.4-88-32.6-11.9-16.6-16.5-37.3-13-57.4.6-3.3 1.4-6.5 2.5-9.6l1.9-5.9 5.3 3.9c12.2 9 25.9 15.8 40.4 20.2l3.8 1.2-.4 3.8c-.5 5.4 1 10.9 4.2 15.3 5.9 8.5 16.5 12.4 26.5 9.8 2.2-.6 4.4-1.5 6.3-2.8l103.2-65.8c5.1-3.2 8.6-8.4 9.7-14.4 1.1-6.1-.3-12.3-3.9-17.3-5.9-8.5-16.5-12.4-26.5-9.8-2.2.6-4.4 1.5-6.3 2.8L252 291c-6.5 4.1-13.5 7.2-21 9.2-33.3 8.6-68.4-4.4-88-32.6-11.9-16.6-16.5-37.3-13-57.4 3.5-19.7 15.2-37 32.2-47.7l103.2-65.8c6.5-4.1 13.5-7.2 21-9.2 33.3-8.6 68.4 4.4 88 32.6 11.9 16.6 16.5 37.3 13 57.4-.6 3.3-1.4 6.5-2.5 9.6L383 193l-5.3-3.9c-12.2-9-25.9-15.8-40.4-20.2l-3.8-1.2.4-3.8c.5-5.4-1-10.9-4.2-15.3-5.9-8.5-16.5-12.4-26.5-9.8-2.2.6-4.4 1.5-6.3 2.8l-103.2 65.8c-5.1 3.2-8.6 8.4-9.7 14.4-1.1 6.1.3 12.3 3.9 17.3 5.9 8.5 16.5 12.4 26.5 9.8 2.2-.6 4.4-1.5 6.3-2.8L260 221c6.5-4.1 13.5-7.2 21-9.2 33.3-8.6 68.4 4.4 88 32.6 11.9 16.6 16.5 37.3 13 57.4-3.5 19.7-15.2 37-32.2 47.7l-103.2 65.8c-6.5 4.1-13.6 7.2-21 9.2"
          fill="#fff"
        />
      </svg>
    ),
  },
];

function FrameworkRotator() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % FRAMEWORKS.length), 2500);
    return () => clearInterval(timer);
  }, []);

  const fw = FRAMEWORKS[index];

  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 6,
        lineHeight: 1,
      }}
    >
      <span
        key={`icon-${fw.name}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: fw.color,
          position: 'relative',
          top: 1,
          animation: 'fadeSlideIn 0.4s ease',
        }}
      >
        {fw.icon}
      </span>
      <span
        key={fw.name}
        style={{
          display: 'inline-block',
          animation: 'fadeSlideIn 0.4s ease',
        }}
      >
        {fw.name}
      </span>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </span>
  );
}

function Hero({ theme, mobile }: { theme: ChartTheme; mobile: boolean }) {
  const latestVersion = useLatestVersion('@wick-charts/react');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: mobile ? 8 : 12,
        padding: mobile ? '24px 12px' : '50px 20px',
        textAlign: 'center',
      }}
    >
      {/* Logo + Wordmark */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: mobile ? 8 : 12,
          marginBottom: mobile ? 6 : 10,
        }}
      >
        <WickLogo
          height={mobile ? 26 : 32}
          color={theme.tooltip.textColor}
          style={{ position: 'relative', top: -1 }}
          ariaLabel="Wick Charts logo"
        />
        <WickWordmark height={mobile ? 18 : 22} color={theme.tooltip.textColor} ariaLabel="Wick Charts" />
      </div>

      {/* Tagline */}
      <div style={{ maxWidth: 600 }}>
        <h2
          style={{
            margin: 0,
            fontSize: mobile ? 14 : 16,
            fontWeight: 600,
            color: theme.tooltip.textColor,
            lineHeight: 1.4,
            fontFamily: theme.typography.fontFamily,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ marginRight: 8, whiteSpace: 'nowrap' }}>High-performance charting library for</div>
          <div style={{ flex: '0 auto' }}>
            <FrameworkRotator />
          </div>
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: theme.typography.fontSize,
            color: theme.tooltip.textColor,
            opacity: 0.6,
            lineHeight: 1.5,
            fontFamily: theme.typography.fontFamily,
          }}
        >
          Candlesticks, lines, areas, bars &mdash; streaming in realtime.
          <br />
          AI&#8209;first, tiny bundle, zero deps, 20+ themes, fully open source.
        </p>
      </div>

      {/* Feature pills */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: mobile ? 4 : 6,
          maxWidth: 540,
        }}
      >
        {latestVersion && (
          <a
            href="https://www.npmjs.com/package/@wick-charts/react"
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 10px',
              borderRadius: 100,
              border: `1px solid ${theme.tooltip.borderColor}`,
              background: hexToRgba(theme.crosshair.labelBackground, 0.4),
              color: theme.tooltip.textColor,
              opacity: 0.8,
              fontSize: theme.axis.fontSize,
              fontFamily: theme.typography.fontFamily,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: resolveCandlestickBodyColor(theme.candlestick.up.body),
                boxShadow: `0 0 6px ${hexToRgba(resolveCandlestickBodyColor(theme.candlestick.up.body), 0.7)}`,
              }}
            />
            v{latestVersion}
          </a>
        )}
        {FEATURES.map((f) => (
          <FeaturePill key={f} text={f} theme={theme} />
        ))}
      </div>
    </div>
  );
}

// ── Getting Started ──────────────────────────────────────────

const INSTALL_COMMANDS: Record<Framework, string> = {
  react: 'npm install @wick-charts/react',
  vue: 'npm install @wick-charts/vue',
  svelte: 'npm install @wick-charts/svelte',
};

const CODE_EXAMPLES: Record<Framework, string> = {
  react: `import {
  ChartContainer, CandlestickSeries, Tooltip,
  Crosshair, YAxis, TimeAxis
} from '@wick-charts/react';

function Chart({ data }) {
  return (
    <ChartContainer>
      <CandlestickSeries data={data} />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}`,
  vue: `<script setup>
import {
  ChartContainer, CandlestickSeries, Tooltip,
  Crosshair, YAxis, TimeAxis
} from '@wick-charts/vue';

const props = defineProps(['data']);
</script>

<template>
  <ChartContainer>
    <CandlestickSeries :data="props.data" />
    <Tooltip />
    <Crosshair />
    <YAxis />
    <TimeAxis />
  </ChartContainer>
</template>`,
  svelte: `<script>
  import {
    ChartContainer, CandlestickSeries, Tooltip,
    Crosshair, YAxis, TimeAxis
  } from '@wick-charts/svelte';

  export let data = [];
</script>

<ChartContainer>
  <CandlestickSeries {data} />
  <Tooltip />
  <Crosshair />
  <YAxis />
  <TimeAxis />
</ChartContainer>`,
};

function SectionHeading({ children, theme }: { children: React.ReactNode; theme: ChartTheme }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: theme.tooltip.textColor,
        opacity: 0.5,
        fontFamily: theme.typography.fontFamily,
      }}
    >
      {children}
    </h3>
  );
}

function GettingStarted({ theme, mobile }: { theme: ChartTheme; mobile: boolean }) {
  const [fw, _setFw] = useFramework();

  const cardStyle: CSSProperties = {
    background: hexToRgba(theme.crosshair.labelBackground, 0.25),
    border: `1px solid ${hexToRgba(theme.tooltip.borderColor, 0.4)}`,
    borderRadius: 10,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  return (
    <div
      style={{
        padding: mobile ? '20px 10px 30px' : '40px 20px 50px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: mobile ? 16 : 24,
        fontFamily: theme.typography.fontFamily,
      }}
    >
      {/* Section title */}
      <div style={{ textAlign: 'center' }}>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: theme.tooltip.textColor,
            fontFamily: theme.typography.fontFamily,
          }}
        >
          Get started
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: theme.typography.fontSize,
            color: theme.tooltip.textColor,
            opacity: 0.5,
            fontFamily: theme.typography.fontFamily,
          }}
        >
          Install the package, add the AI skill, and start building charts.
        </p>
      </div>

      {/* Framework selector */}
      <FrameworkSelect theme={theme} />

      {/* Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
          gap: mobile ? 12 : 16,
          width: '100%',
          maxWidth: 900,
        }}
      >
        {/* Left: Install + AI skill */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={cardStyle}>
            <SectionHeading theme={theme}>1. Install</SectionHeading>
            <HighlightedCode code={INSTALL_COMMANDS[fw]} theme={theme} prompt="$" />
          </div>

          <div style={cardStyle}>
            <SectionHeading theme={theme}>2. AI skill</SectionHeading>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: theme.tooltip.textColor,
                opacity: 0.7,
                lineHeight: 1.5,
              }}
            >
              Wick Charts ships with a built-in AI skill. Your AI assistant will know every component, prop, and theme
              out of the box.
            </p>
            <HighlightedCode code="npx skills add mo4islona/wick-charts" theme={theme} prompt="$" />
          </div>
        </div>

        {/* Right: Code example */}
        <div style={{ ...cardStyle, minWidth: 0 }}>
          <SectionHeading theme={theme}>3. Build a chart</SectionHeading>
          <HighlightedCode code={CODE_EXAMPLES[fw]} theme={theme} />
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export function OverviewPage({ theme }: { theme: ChartTheme }) {
  const mobile = useIsMobile();
  // DEMO_INTERVAL is 5_000ms; speed=10 → a fresh bar every ~500ms, which is
  // the "crypto exchange" pace the hero chart is tuned for. Users can drag
  // the debug speed slider to slow down and watch a single bar form.
  const [speed, setSpeed] = useState(10);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        gap: 6,
      }}
    >
      <Hero theme={theme} mobile={mobile} />

      {DEBUG && <SpeedControl value={speed} onChange={setSpeed} theme={theme} mobile={mobile} />}

      <div
        style={{
          minHeight: mobile ? undefined : 500,
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
          gridTemplateRows: mobile ? undefined : '1fr 1fr',
          gap: mobile ? 6 : 10,
          padding: mobile ? 6 : 12,
        }}
      >
        <Cell theme={theme} style={mobile ? { height: 220 } : undefined}>
          <CandleChart theme={theme} speed={speed} />
        </Cell>
        <Cell theme={theme} style={mobile ? { height: 220 } : undefined}>
          <AreaBandsChart theme={theme} speed={speed} />
        </Cell>
        {!mobile && (
          <>
            <Cell theme={theme}>
              <MultiLineChart theme={theme} speed={speed} />
            </Cell>
            <Cell theme={theme}>
              <BarChart theme={theme} speed={speed} />
            </Cell>
          </>
        )}
      </div>

      <GettingStarted theme={theme} mobile={mobile} />
    </div>
  );
}
