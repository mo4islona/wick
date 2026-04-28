import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  type ChartTheme,
  Crosshair,
  InfoBar,
  LineSeries,
  PieLegend,
  PieSeries,
  type PieSliceData,
  PieTooltip,
  TimeAxis,
  Title,
  Tooltip,
  XAxis,
  YAxis,
  YLabel,
  createTheme,
} from '@wick-charts/react';

import { Cell } from '../components/Cell';
import { CHECK_ICON, COPY_ICON } from '../components/playground/icons';
import { themeSurfaceVars } from '../components/playground/themeSurface';
import { useCodeHeight, usePanelWidth } from '../components/playground/useSettings';
import { JsonEditor } from '../components/theme-editor/JsonEditor';
import { type JsonValue, normalizeThemeConfig } from '../components/theme-editor/themeJson';
import { generateBarData, generateOHLCData, generateWaveData } from '../data';
import { DEMO_INTERVAL } from '../data/demo';
import { useIsMobile } from '../hooks';

// ── Mock data ─────────────────────────────────────────────────

// Small candle count so bodies and wicks are clearly visible in the preview —
// this chart is used to eyeball `candlestick.up.body` / `wick` edits.
const ohlcData = generateOHLCData(60, 42000, DEMO_INTERVAL);

const SERIES_WAVE_OPTS = [
  { base: 5, amplitude: 120, period: 50, phase: 0, onset: 0 },
  { base: 5, amplitude: 80, period: 65, phase: 0.5, onset: 0.1 },
  { base: 5, amplitude: 60, period: 40, phase: 1.0, onset: 0.2 },
  { base: 5, amplitude: 95, period: 55, phase: 1.6, onset: 0.15 },
  { base: 5, amplitude: 70, period: 45, phase: 2.2, onset: 0.25 },
  { base: 5, amplitude: 110, period: 60, phase: 2.8, onset: 0.05 },
];
const LINE_POOL = SERIES_WAVE_OPTS.map((opts) => generateWaveData(200, { interval: DEMO_INTERVAL, ...opts }));

const barData = generateBarData(40, DEMO_INTERVAL);

const pieData: PieSliceData[] = [
  { label: 'BTC', value: 42 },
  { label: 'ETH', value: 28 },
  { label: 'SOL', value: 12 },
  { label: 'AVAX', value: 8 },
  { label: 'DOT', value: 6 },
  { label: 'Other', value: 4 },
];

// ── Types ─────────────────────────────────────────────────────

type Mode = 'pretty' | 'raw';

// ── Previews ──────────────────────────────────────────────────

function CandlestickPreview({ theme }: { theme: ChartTheme }) {
  const sid = 'candle-v2';
  const mobile = useIsMobile();

  return (
    <ChartContainer theme={theme} interactive={false}>
      <Title sub="custom theme">Candlestick</Title>
      {!mobile && <InfoBar />}
      <CandlestickSeries id={sid} data={ohlcData} />
      <YLabel seriesId={sid} />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

function BarPreview({ theme }: { theme: ChartTheme }) {
  return (
    <ChartContainer theme={theme} interactive={false}>
      <Title sub="theme preview">Bar</Title>
      <BarSeries data={[barData]} options={{ colors: theme.seriesColors.slice(0, 1) }} />
      <Crosshair />
      <YAxis />
      <XAxis />
    </ChartContainer>
  );
}

function PiePreview({ theme }: { theme: ChartTheme }) {
  const sid = 'pie-v2';

  return (
    <ChartContainer theme={theme} interactive={false}>
      <Title sub="theme preview">Pie</Title>
      <PieSeries id={sid} data={pieData} />
      <PieLegend seriesId={sid} position="right" />
      <PieTooltip seriesId={sid} />
    </ChartContainer>
  );
}

function LinePreview({ theme, seriesCount }: { theme: ChartTheme; seriesCount: number }) {
  const n = Math.max(1, seriesCount);
  const data = useMemo(() => Array.from({ length: n }, (_, i) => LINE_POOL[i % LINE_POOL.length]), [n]);
  const mobile = useIsMobile();

  return (
    <ChartContainer theme={theme} interactive={false}>
      <Title sub={`${data.length} series`}>Line</Title>
      {!mobile && <InfoBar />}
      <LineSeries
        id="line-v2"
        data={data}
        options={{
          colors: theme.seriesColors.slice(0, data.length),
          area: { visible: true },
          pulse: true,
        }}
      />
      <Tooltip />
      <Crosshair />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

// ── Page ──────────────────────────────────────────────────────

function stringify(v: JsonValue): string {
  return JSON.stringify(v, null, 2);
}

export function ThemePage({
  theme,
  value,
  onChange,
}: {
  /** Base preset theme — used for the chart-preview fallback when JSON fails
   * to validate. App passes the active preset, not the override. */
  theme: ChartTheme;
  /** Controlled editor state. Parent holds the JSON so edits persist across
   * navigation and drive the whole-page override. */
  value: JsonValue;
  onChange: (v: JsonValue) => void;
}) {
  const mobile = useIsMobile();

  const [mode, setMode] = useState<Mode>('pretty');
  const [copied, setCopied] = useState(false);

  const [rawText, setRawText] = useState(() => stringify(value));
  const lastParsed = useRef<JsonValue>(value);

  // Sync textarea when parent drives a new value (preset swap, undo, etc.)
  // and it didn't originate from the textarea itself.
  useEffect(() => {
    if (JSON.stringify(value) === JSON.stringify(lastParsed.current)) return;
    setRawText(stringify(value));
    lastParsed.current = value;
  }, [value]);

  const onRawChange = (next: string) => {
    setRawText(next);
    try {
      const parsed = JSON.parse(next) as JsonValue;
      if (JSON.stringify(parsed) !== JSON.stringify(value)) {
        lastParsed.current = parsed;
        onChange(parsed);
      }
    } catch {
      // Invalid JSON — keep user's text, don't commit.
    }
  };

  // Build the preview ChartTheme from the current JSON via createTheme.
  // `normalizeThemeConfig` coerces `background` / `line.color` to hex so
  // createTheme's internal `hexToRgba` / `isDarkBg` don't choke on non-hex
  // editor input. Validation failure (missing or invalid `background`)
  // falls back to the page theme so previews don't crash.
  const customTheme = useMemo(() => {
    const cfg = normalizeThemeConfig(value);
    if (!cfg) return theme;
    try {
      return createTheme(cfg).theme;
    } catch {
      return theme;
    }
  }, [value, theme]);

  const seriesCount = useMemo(() => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const s = (value as Record<string, unknown>).seriesColors;
      if (Array.isArray(s)) return Math.max(1, Math.min(8, s.length));
    }

    return 3;
  }, [value]);

  // Editor chrome tracks the page theme (stable while you edit colors);
  // picker pop-overs use the same surface vars via the portal injection.
  const surfaceVars = useMemo(() => themeSurfaceVars(theme), [theme]);
  const pickerSurface = surfaceVars as CSSProperties;

  const { pct: panelPct, containerRef, onMouseDown } = usePanelWidth();
  const { rightRef } = useCodeHeight();

  const copy = () => {
    navigator.clipboard
      .writeText(stringify(value))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const editorBody =
    mode === 'pretty' ? (
      <div className="tev2-scroll">
        <JsonEditor value={value} onChange={(v) => onChange(v as JsonValue)} pickerSurface={pickerSurface} />
      </div>
    ) : (
      <textarea
        className="pg-code pg-code-edit tev2-raw"
        value={rawText}
        onChange={(e) => onRawChange(e.target.value)}
        spellCheck={false}
        wrap="off"
      />
    );

  const panelHeader = (
    <div className="pg-head tev2-head">
      <div className="tev2-mode tgroup" role="tablist" aria-label="Editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'pretty'}
          className={mode === 'pretty' ? 'on' : ''}
          onClick={() => setMode('pretty')}
        >
          <span>Pretty</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'raw'}
          className={mode === 'raw' ? 'on' : ''}
          onClick={() => setMode('raw')}
        >
          <span>Raw</span>
        </button>
      </div>
      <div className="pg-actions">
        <button type="button" onClick={copy} title={copied ? 'Copied' : 'Copy'} aria-label="Copy JSON">
          {copied ? CHECK_ICON : COPY_ICON}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );

  if (mobile) {
    return (
      <div className="wick-playground" data-mobile="true" style={surfaceVars}>
        <div className="pg-shell">
          <div className="pg-main" style={{ gridTemplateColumns: '1fr', gridAutoRows: 220 }}>
            <Cell theme={customTheme}>
              <CandlestickPreview theme={customTheme} />
            </Cell>
            <Cell theme={customTheme}>
              <LinePreview theme={customTheme} seriesCount={seriesCount} />
            </Cell>
            <Cell theme={customTheme}>
              <BarPreview theme={customTheme} />
            </Cell>
            <Cell theme={customTheme}>
              <PiePreview theme={customTheme} />
            </Cell>
          </div>
        </div>
        <div className="pg-right tev2-right">
          {panelHeader}
          {editorBody}
        </div>
      </div>
    );
  }

  return (
    <div className="wick-playground" ref={containerRef} style={surfaceVars}>
      <div className="pg-shell">
        <div
          className="pg-main tev2-previews"
          style={{ gridTemplateColumns: '1fr', gridAutoRows: 280, overflow: 'auto' }}
        >
          <Cell theme={customTheme}>
            <CandlestickPreview theme={customTheme} />
          </Cell>
          <Cell theme={customTheme}>
            <LinePreview theme={customTheme} seriesCount={seriesCount} />
          </Cell>
          <Cell theme={customTheme}>
            <BarPreview theme={customTheme} />
          </Cell>
          <Cell theme={customTheme}>
            <PiePreview theme={customTheme} />
          </Cell>
        </div>

        <button type="button" className="pg-drag" onMouseDown={onMouseDown} aria-label="Resize panel">
          <div className="pg-drag-thumb" />
        </button>

        <div
          className="pg-right tev2-right"
          ref={rightRef}
          style={{
            width: `${panelPct}%`,
            gridTemplateRows: 'auto 1fr',
          }}
        >
          {panelHeader}
          {editorBody}
        </div>
      </div>
    </div>
  );
}
