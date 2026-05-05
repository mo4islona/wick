import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CandlestickSeries,
  ChartContainer,
  type ChartTheme,
  Crosshair,
  EdgeLoader,
  type OHLCData,
  Title,
  XAxis,
  YAxis,
  YLabel,
  useChartInstance,
} from '@wick-charts/react';

import { AdvancedLayout, type Step } from '../../components/AdvancedLayout';
import { generateOHLCData } from '../../data';
import { hexToRgba } from '../../utils';
import source from './load-on-scroll.tsx?raw';

const INTERVAL = 60_000 * 60; // 1-hour candles
const PAGE_SIZE = 100;
const INITIAL_PAGES = 2;
const MAX_PAGES = 8;
const INITIAL_VISIBLE_BARS = 60;
const NEAR_EDGE_BARS = 8;
const FETCH_DELAY_MS = 400;

/**
 * Walk backwards from the existing first candle so each older candle's close
 * matches the next candle's open — chunks chain price-continuously instead of
 * jumping to a fresh seed value.
 */
function makeOlderPage({ count, interval, next }: { count: number; interval: number; next: OHLCData }): OHLCData[] {
  const round = (n: number): number => Math.round(n * 100) / 100;
  const out: OHLCData[] = new Array(count);

  let nextOpen = next.open;
  for (let i = count - 1; i >= 0; i--) {
    const close = nextOpen;
    const drift = (Math.random() - 0.5) * 0.01 * close;
    const open = round(close - drift);
    const wick = Math.random() * 0.005 * close;
    const high = round(Math.max(open, close) + wick);
    const low = round(Math.min(open, close) - wick);

    out[i] = {
      time: next.time - (count - i) * interval,
      open,
      high,
      low,
      close: round(close),
    };
    nextOpen = open;
  }

  return out;
}

function InitialZoom({ bars }: { bars: number }) {
  const chart = useChartInstance();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    chart.setVisibleRange(bars);
    applied.current = true;
  }, [chart, bars]);

  return null;
}

function LoaderBadge({ x, theme }: { x: number; theme: ChartTheme }) {
  const stroke = theme.tooltip.textColor;
  const bg = hexToRgba(stroke, 0.08);
  const border = hexToRgba(stroke, 0.18);

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        // Anchor the badge to the right of the data-edge column. translateY
        // centers it vertically on the chart so it reads as "loading at the
        // wall of history" rather than a corner toast.
        left: Math.max(8, x + 12),
        transform: 'translateY(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 999,
        color: stroke,
        fontSize: theme.typography.fontSize - 1,
        fontFamily: theme.typography.fontFamily,
        zIndex: 4,
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="5.5" stroke={hexToRgba(stroke, 0.2)} strokeWidth="1.5" fill="none" />
        <path d="M 7 1.5 A 5.5 5.5 0 0 1 12.5 7" stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round">
          <animateTransform
            attributeName="transform"
            attributeType="XML"
            type="rotate"
            from="0 7 7"
            to="360 7 7"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
      Loading older history…
    </div>
  );
}

const STEPS: Step[] = [
  {
    heading: '01 — DROP IN <EDGELOADER>',
    body: (
      <>
        Place <code>&lt;EdgeLoader&gt;</code> as a child of <code>&lt;ChartContainer&gt;</code> and point it at the side
        you want to watch. <code>onTrigger</code> fires whenever the visible range comes within <code>threshold</code>{' '}
        bars of the data edge — return a Promise and the component handles deduping for you.
      </>
    ),
    code: `<ChartContainer>\n  <CandlestickSeries data={data} />\n  <EdgeLoader\n    side="left"\n    threshold={8}\n    onTrigger={loadOlder}\n  />\n</ChartContainer>`,
  },
  {
    heading: '02 — RESOLVE THE PROMISE TO STOP',
    body: (
      <>
        <code>onTrigger</code> can return a Promise. While it's pending, <code>EdgeLoader</code> won't fire again. When
        you're out of history, resolve with the literal <code>false</code> — the loader stops watching and the built-in
        canvas indicator switches to its <em>no-data</em> state.
      </>
    ),
    code: `const loadOlder = useCallback(async () => {\n  const page = await fetchOlder({ before: oldestTime });\n  setData((prev) => [...page, ...prev]);\n  return page.length > 0; // false → "no more history"\n}, []);`,
  },
  {
    heading: '03 — DRAW YOUR OWN LOADER',
    body: (
      <>
        Pass children to render any positioned overlay. <code>x</code> is the data edge in CSS pixels — anchor your
        spinner there and it slides with the data as the user pans.
      </>
    ),
    code: `<EdgeLoader side="left" onTrigger={loadOlder}>\n  {({ x, isLoading }) =>\n    isLoading && <Spinner style={{ left: x + 8 }} />\n  }\n</EdgeLoader>`,
  },
];

export function LoadOnScrollPage({ theme }: { theme: ChartTheme }) {
  const initial = useMemo(() => generateOHLCData(PAGE_SIZE * INITIAL_PAGES, 100, INTERVAL), []);
  const [data, setData] = useState<OHLCData[]>(initial);
  const [pagesLoaded, setPagesLoaded] = useState(INITIAL_PAGES);

  const loadOlder = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        let appended = false;
        setData((prev) => {
          const head = prev[0];
          if (!head) return prev;
          const older = makeOlderPage({ count: PAGE_SIZE, interval: INTERVAL, next: head });
          appended = true;
          return [...older, ...prev];
        });
        setPagesLoaded((p) => {
          const next = p + 1;
          // Resolve `false` once we've hit the cap — EdgeLoader stops watching
          // and flips its canvas indicator to `no-data`.
          resolve(appended && next < MAX_PAGES);

          return next;
        });
      }, FETCH_DELAY_MS);
    });
  }, []);

  return (
    <AdvancedLayout
      theme={theme}
      source={source}
      lead={
        <>
          Pan the chart to the left. As the visible range nears the data's start, <code>&lt;EdgeLoader&gt;</code> calls{' '}
          <code>onTrigger</code> and a simulated fetch prepends an older page. Up to {MAX_PAGES} pages of {PAGE_SIZE}{' '}
          candles will load in.
        </>
      }
      chart={
        <ChartContainer theme={theme}>
          <Title sub={`${pagesLoaded * PAGE_SIZE} candles · ${INITIAL_PAGES * PAGE_SIZE} initial`}>BTC/USD</Title>
          <CandlestickSeries id="candle" data={data} />
          <InitialZoom bars={INITIAL_VISIBLE_BARS} />
          <EdgeLoader side="left" threshold={NEAR_EDGE_BARS} onTrigger={loadOlder}>
            {({ x, isLoading }) => (isLoading ? <LoaderBadge x={x} theme={theme} /> : null)}
          </EdgeLoader>
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
