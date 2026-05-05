import { useEffect, useMemo, useState } from 'react';

import {
  CandlestickSeries,
  ChartContainer,
  type ChartTheme,
  Crosshair,
  type OHLCData,
  Title,
  XAxis,
  YAxis,
  YLabel,
  useChartInstance,
} from '@wick-charts/react';

import { AdvancedLayout, type Step } from '../../components/AdvancedLayout';
import { generateOHLCData } from '../../data';
import source from './custom-overlay.tsx?raw';

const COUNT = 250;
const INTERVAL = 60_000 * 60;
const SMA_PERIOD = 20;

interface BandPoint {
  time: number;
  mid: number;
  upper: number;
  lower: number;
}

function computeBollinger(candles: OHLCData[], period: number): BandPoint[] {
  if (candles.length < period) return [];

  const out: BandPoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const mid = sum / period;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j].close - mid;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);

    out.push({
      time: candles[i].time,
      mid,
      upper: mid + 2 * sd,
      lower: mid - 2 * sd,
    });
  }

  return out;
}

function BollingerBand({ band, color }: { band: BandPoint[]; color: string }) {
  const chart = useChartInstance();
  const [, bump] = useState(0);

  // Track the values that move our pixel mapping: viewport (timeScale.from/to,
  // yScale.min/max) and overlay-affecting changes (resize, theme, axis width).
  useEffect(() => {
    const tick = () => bump((n) => n + 1);
    chart.on('viewportChange', tick);
    chart.on('overlayChange', tick);

    return () => {
      chart.off('viewportChange', tick);
      chart.off('overlayChange', tick);
    };
  }, [chart]);

  if (band.length < 2) return null;

  const visible = chart.getVisibleRange();
  const points = band.filter((p) => p.time >= visible.from && p.time <= visible.to);
  if (points.length < 2) return null;

  const xs = points.map((p) => chart.timeScale.timeToX(p.time));
  const upperYs = points.map((p) => chart.yScale.valueToY(p.upper));
  const lowerYs = points.map((p) => chart.yScale.valueToY(p.lower));
  const midYs = points.map((p) => chart.yScale.valueToY(p.mid));

  const fillPath = [
    `M ${xs[0]} ${upperYs[0]}`,
    ...xs.slice(1).map((x, i) => `L ${x} ${upperYs[i + 1]}`),
    ...xs
      .slice()
      .reverse()
      .map((x, i) => `L ${x} ${lowerYs[lowerYs.length - 1 - i]}`),
    'Z',
  ].join(' ');

  const midPath =
    `M ${xs[0]} ${midYs[0]} ` +
    xs
      .slice(1)
      .map((x, i) => `L ${x} ${midYs[i + 1]}`)
      .join(' ');

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: chart.yAxisWidth,
        bottom: chart.xAxisHeight,
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <title>Bollinger Bands ({SMA_PERIOD}, 2)</title>
      <path d={fillPath} fill={color} fillOpacity={0.12} />
      <path d={midPath} stroke={color} strokeWidth={1.25} fill="none" strokeDasharray="3 3" />
    </svg>
  );
}

const STEPS: Step[] = [
  {
    heading: '01 — RENDER AS A CHILD',
    body: (
      <>
        Anything you put inside <code>&lt;ChartContainer&gt;</code> that isn't a built-in slot lands in an absolutely
        positioned overlay above the canvas. Your component has access to the chart via <code>useChartInstance()</code>.
      </>
    ),
    code: `<ChartContainer>\n  <CandlestickSeries data={candles} />\n  <BollingerBand band={band} color="#7AA9FF" />\n  <YAxis />\n  <XAxis />\n</ChartContainer>`,
  },
  {
    heading: '02 — MAP DATA TO PIXELS',
    body: (
      <>
        Read the chart's scales: <code>timeScale.timeToX(time)</code> and <code>yScale.valueToY(value)</code>. Both
        return CSS pixels in the overlay's coordinate space, so an SVG positioned at{' '}
        <code>{`{ inset: 0, right: chart.yAxisWidth, bottom: chart.xAxisHeight }`}</code> aligns perfectly with the plot
        area.
      </>
    ),
    code: `const xs = points.map((p) => chart.timeScale.timeToX(p.time));\nconst ys = points.map((p) => chart.yScale.valueToY(p.value));`,
  },
  {
    heading: '03 — REDRAW ON CHANGE',
    body: (
      <>
        Subscribe to <code>viewportChange</code> (pan / zoom / resize moves the scales) and <code>overlayChange</code>{' '}
        (data updates, axis width changes). A bump-counter <code>useState</code> is enough to force a re-render.
      </>
    ),
    code: `useEffect(() => {\n  const tick = () => bump((n) => n + 1);\n  chart.on('viewportChange', tick);\n  chart.on('overlayChange', tick);\n  return () => {\n    chart.off('viewportChange', tick);\n    chart.off('overlayChange', tick);\n  };\n}, [chart]);`,
  },
];

export function CustomOverlayPage({ theme }: { theme: ChartTheme }) {
  const candles = useMemo(() => generateOHLCData(COUNT, 100, INTERVAL), []);
  const band = useMemo(() => computeBollinger(candles, SMA_PERIOD), [candles]);
  const bandColor = theme.bands?.upper ?? theme.tooltip.textColor;

  return (
    <AdvancedLayout
      theme={theme}
      source={source}
      lead={
        <>
          A 20-period Bollinger Band drawn on top of a candlestick chart with a custom React overlay component. The band
          is a single SVG that uses the chart's <code>timeScale</code> and <code>yScale</code> to project data onto
          pixels — pan and zoom keep it perfectly aligned.
        </>
      }
      chart={
        <ChartContainer theme={theme}>
          <Title sub={`Bollinger ${SMA_PERIOD}, 2σ`}>BTC/USD</Title>
          <CandlestickSeries id="candle" data={candles} />
          <BollingerBand band={band} color={bandColor} />
          <YLabel seriesId="candle" />
          <Crosshair />
          <YAxis />
          <XAxis />
        </ChartContainer>
      }
      steps={STEPS}
    />
  );
}
