import { type ReactNode, useMemo, useState } from 'react';

import type { AxisBound, AxisConfig, ChartTheme } from '@wick-charts/react';
import { SlidersHorizontal, X } from 'lucide-react';

import { useIsMobile } from '../../hooks';
import type { ChartCodeConfig } from '../CodePreview';
import { Splitter } from '../Splitter';
import { CodeTabs } from './CodeTabs';
import { ICONS } from './icons';
import { Panel } from './Panel';
import { BoundInput, Select, Slider, Toggle, ToggleGroup } from './primitives';
import {
  type AnimationKind,
  type AxisCurve,
  type BarEntryAnim,
  COMMON_DEFAULTS,
  type CandleEntryAnim,
  type CommonState,
  type GridStyle,
  type HeaderLayout,
  type LineEntryAnim,
  type RowSpec,
  type SectionSpec,
} from './sections';
import { themeSurfaceVars } from './themeSurface';
import { useCodeHeight, usePanelWidth, useSettings } from './useSettings';

import './styles.css';

// ── Public chart-props contract ──────────────────────────────

/** Props threaded from Playground into the charts renderer. Library shapes
 * are assembled here — pages should pass these through verbatim. */
export interface PlaygroundChartProps {
  theme: ChartTheme;
  axis: AxisConfig;
  streaming: boolean;
  perfHudVisible: boolean;
  gradient: boolean;
  grid: { visible: boolean };
  // Per-series-type entry style
  candleEntryAnimation: CandleEntryAnim;
  barEntryAnimation: BarEntryAnim;
  lineEntryAnimation: LineEntryAnim;
  // Per-series-type durations (ms) — fed into `animations.series.{kind}.*`
  candleEntryMs: number;
  candleSmoothMs: number;
  barEntryMs: number;
  barSmoothMs: number;
  lineEntryMs: number;
  lineSmoothMs: number;
  linePulseMs: number;
  pieEntryMs: number;
  pieUpdateMs: number;
  // Axis transitions — fed into `animations.axis.{x,y}.*`
  xCurve: 'spring' | 'snap';
  xSettleMs: number;
  xGestureMs: number;
  yCurve: AxisCurve;
  ySettleMs: number;
  yStickyMs: number;
  yGestureMs: number;
  // Cross-cutting — fed into `animations.{axis.ticks, toggle}`
  ticksMs: number;
  toggleMs: number;
  headerLayout: HeaderLayout;
  navigatorVisible: boolean;
  navigatorHeight: number;
}

// Re-export types for consumer pages
export type {
  AnimationKind,
  AxisCurve,
  BarEntryAnim,
  CandleEntryAnim,
  GridStyle,
  HeaderLayout,
  LineEntryAnim,
  RowSpec,
  SectionSpec,
};

export interface PlaygroundProps<TExtra extends object = Record<string, never>> {
  id: string;
  theme: ChartTheme;
  /** Flat extra state merged on top of CommonState. Pass a function to make
   * defaults responsive to the viewport (e.g. hide InfoBar on mobile). */
  extraDefaults?: TExtra | ((mobile: boolean) => TExtra);
  /** Sections contributed by the page. Use `extend: 'display'` to append into a built-in. */
  sections?: SectionSpec[];
  charts: (props: PlaygroundChartProps & TExtra) => ReactNode;
  codeConfig?: (state: PlaygroundChartProps & TExtra) => ChartCodeConfig;
  gridTemplate?: string;
  gridColumns?: string;
  hideCartesian?: boolean;
  /** Whether the built-in Demo section shows a Perf HUD toggle. Off for charts
   * that don't render through `ChartContainer` (e.g. Sparkline). Default true. */
  showPerfHud?: boolean;
  animationKinds?: AnimationKind[];
}

// ── Helpers ──────────────────────────────────────────────────

function parseBound(raw: string): AxisBound | undefined {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'auto') return undefined;
  if (s.endsWith('%')) return s;

  const n = Number.parseFloat(s);
  if (!Number.isNaN(n)) return n;

  return undefined;
}

/** Flat playground state → nested library props. */
function stateToChartProps<TExtra extends object>(
  state: CommonState & TExtra,
  theme: ChartTheme,
): PlaygroundChartProps & TExtra {
  const chartTheme: ChartTheme = state.gridVisible
    ? { ...theme, grid: { color: theme.grid.color, style: state.gridStyle } }
    : { ...theme, grid: { ...theme.grid, color: 'transparent' } };

  const axis: AxisConfig = {
    y: {
      width: state.yAxisWidth,
      min: parseBound(state.minBound),
      max: parseBound(state.maxBound),
      visible: state.yAxisVisible,
    },
    x: { height: state.xAxisHeight, visible: state.xAxisVisible },
  };

  return {
    ...(state as TExtra),
    theme: chartTheme,
    axis,
    streaming: state.streaming,
    perfHudVisible: state.perfHudVisible,
    gradient: state.bgGradient,
    grid: { visible: state.gridVisible },
    candleEntryAnimation: state.candleEntryAnimation,
    barEntryAnimation: state.barEntryAnimation,
    lineEntryAnimation: state.lineEntryAnimation,
    candleEntryMs: state.candleEntryMs,
    candleSmoothMs: state.candleSmoothMs,
    barEntryMs: state.barEntryMs,
    barSmoothMs: state.barSmoothMs,
    lineEntryMs: state.lineEntryMs,
    lineSmoothMs: state.lineSmoothMs,
    linePulseMs: state.linePulseMs,
    pieEntryMs: state.pieEntryMs,
    pieUpdateMs: state.pieUpdateMs,
    xCurve: state.xCurve,
    xSettleMs: state.xSettleMs,
    xGestureMs: state.xGestureMs,
    yCurve: state.yCurve,
    ySettleMs: state.ySettleMs,
    yStickyMs: state.yStickyMs,
    yGestureMs: state.yGestureMs,
    ticksMs: state.ticksMs,
    toggleMs: state.toggleMs,
    headerLayout: state.headerLayout,
    navigatorVisible: state.navigatorVisible,
    navigatorHeight: state.navigatorHeight,
  } as PlaygroundChartProps & TExtra;
}

// ── Built-in sections ────────────────────────────────────────

/** Compact factory for the recurring "ms slider" pattern used throughout the
 *  Animations panel. Keeps row specs readable when 15+ of them stack up. */
function msSliderRow({
  key,
  label,
  hint,
  group,
  max,
  step,
}: {
  key: string;
  label: string;
  hint: string;
  group: string;
  max: number;
  step: number;
}): RowSpec {
  return {
    key,
    label,
    hint,
    group,
    render: (v, onChange) => (
      <Slider
        value={v as number}
        min={0}
        max={max}
        step={step}
        suffix="ms"
        onChange={onChange as (v: number) => void}
      />
    ),
  } as RowSpec;
}

function buildBuiltinSections({
  hideCartesian,
  showPerfHud,
  animationKinds,
}: {
  hideCartesian: boolean;
  showPerfHud: boolean;
  animationKinds: AnimationKind[];
}): SectionSpec[] {
  const showCandle = animationKinds.includes('candle');
  const showBar = animationKinds.includes('bar');
  const showLine = animationKinds.includes('line');
  const showPie = animationKinds.includes('pie');
  // X/Y axis transitions don't apply to pie (radial) — hide their sub-groups
  // when pie is the only active kind. Cartesian kinds keep the full panel.
  const showAxisAnim = showCandle || showBar || showLine;
  const showCrossCutting = animationKinds.length > 0;

  const sections: SectionSpec[] = [];

  // "Demo" groups controls that are about *what the live preview shows or exposes*
  // rather than chart configuration — the live/static data toggle and the Perf HUD
  // debug overlay. Kept separate from chart settings so the copied code snippet
  // doesn't mix playground-only concerns with real library props. Pages extend
  // this via `extend: 'demo'`; the Perf HUD row is appended after page extensions
  // in `mergeSections` so it always sits at the bottom of the section.
  const demoRows: RowSpec[] = [];
  if (!hideCartesian) {
    demoRows.push({
      key: 'streaming',
      label: 'Mode',
      hint: 'Stream mock data vs. static snapshot',
      render: (v, onChange) => (
        <ToggleGroup<'live' | 'static'>
          value={(v as boolean) ? 'live' : 'static'}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'static', label: 'Static' },
          ]}
          onChange={(next) => (onChange as (b: boolean) => void)(next === 'live')}
        />
      ),
    } as RowSpec);
  }
  if (demoRows.length > 0 || showPerfHud) {
    sections.push({
      id: 'demo',
      title: 'Demo',
      icon: ICONS.data,
      defaultOpen: true,
      rows: demoRows,
    });
  }

  sections.push({
    id: 'display',
    title: 'Display',
    icon: ICONS.display,
    defaultOpen: true,
    rows: [],
  });

  if (!hideCartesian) {
    sections.push({
      id: 'grid',
      title: 'Grid',
      icon: ICONS.grid,
      defaultOpen: false,
      rows: [
        {
          key: 'gridVisible',
          label: 'Visible',
          render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
        } as RowSpec,
        {
          key: 'gridStyle',
          label: 'Style',
          visible: (s) => s.gridVisible === true,
          render: (v, onChange) => (
            <Select<GridStyle>
              value={v as GridStyle}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' },
              ]}
              onChange={onChange as (v: GridStyle) => void}
            />
          ),
        } as RowSpec,
      ],
    });
  }

  if (!hideCartesian) {
    sections.push({
      id: 'x-axis',
      title: 'X axis',
      icon: ICONS.axes,
      defaultOpen: false,
      rows: [
        {
          key: 'xAxisVisible',
          label: 'Visible',
          render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
        } as RowSpec,
        {
          key: 'xAxisHeight',
          label: 'Height',
          hint: 'Reserved pixels for labels',
          visible: (s) => s.xAxisVisible === true,
          render: (v, onChange) => (
            <Slider
              value={v as number}
              min={15}
              max={60}
              step={5}
              suffix="px"
              onChange={onChange as (v: number) => void}
            />
          ),
        } as RowSpec,
      ],
    });

    sections.push({
      id: 'y-axis',
      title: 'Y axis',
      icon: ICONS.axes,
      defaultOpen: false,
      rows: [
        {
          key: 'yAxisVisible',
          label: 'Visible',
          render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
        } as RowSpec,
        {
          key: 'yAxisWidth',
          label: 'Width',
          hint: 'Reserved pixels for labels',
          visible: (s) => s.yAxisVisible === true,
          render: (v, onChange) => (
            <Slider
              value={v as number}
              min={20}
              max={120}
              step={5}
              suffix="px"
              onChange={onChange as (v: number) => void}
            />
          ),
        } as RowSpec,
        {
          key: 'minBound',
          label: 'Min',
          hint: 'Fixed lower bound (or auto)',
          visible: (s) => s.yAxisVisible === true,
          render: (v, onChange) => <BoundInput value={v as string} onChange={onChange as (v: string) => void} />,
        } as RowSpec,
        {
          key: 'maxBound',
          label: 'Max',
          hint: 'Fixed upper bound (or auto)',
          visible: (s) => s.yAxisVisible === true,
          render: (v, onChange) => <BoundInput value={v as string} onChange={onChange as (v: string) => void} />,
        } as RowSpec,
      ],
    });
  }

  const backgroundRows: RowSpec[] = [
    {
      key: 'bgGradient',
      label: 'Gradient',
      hint: 'Soft background gradient',
      render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
    } as RowSpec,
  ];
  if (!hideCartesian) {
    backgroundRows.push({
      key: 'headerLayout',
      label: 'Header layout',
      hint: 'How the header interacts with the plot area',
      render: (v, onChange) => (
        <Select<HeaderLayout>
          value={v as HeaderLayout}
          options={[
            { value: 'overlay', label: 'Overlay (grid full-height)' },
            { value: 'inline', label: 'Inline (shift chart down)' },
          ]}
          onChange={onChange as (v: HeaderLayout) => void}
        />
      ),
    } as RowSpec);
  }
  sections.push({
    id: 'background',
    title: 'Background',
    icon: ICONS.background,
    defaultOpen: false,
    rows: backgroundRows,
  });

  if (showCrossCutting) {
    const animRows: RowSpec[] = [];

    // ── Series group: per-kind entry style + durations ──
    if (showCandle) {
      animRows.push(
        {
          key: 'candleEntryAnimation',
          label: 'Candle entry style',
          group: 'Series',
          render: (v, onChange) => (
            <Select<CandleEntryAnim>
              value={v as CandleEntryAnim}
              options={[
                { value: 'none', label: 'None' },
                { value: 'fade', label: 'Fade' },
                { value: 'unfold', label: 'Unfold' },
                { value: 'slide', label: 'Slide' },
                { value: 'fade-unfold', label: 'Fade + Unfold' },
              ]}
              onChange={onChange as (v: CandleEntryAnim) => void}
            />
          ),
        } as RowSpec,
        msSliderRow({
          key: 'candleEntryMs',
          label: 'Candle entry',
          hint: 'Per-candle entrance duration. 0 disables.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
        msSliderRow({
          key: 'candleSmoothMs',
          label: 'Candle smooth',
          hint: 'OHLC chase duration on data updates. 0 snaps.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
      );
    }
    if (showBar) {
      animRows.push(
        {
          key: 'barEntryAnimation',
          label: 'Bar entry style',
          group: 'Series',
          render: (v, onChange) => (
            <Select<BarEntryAnim>
              value={v as BarEntryAnim}
              options={[
                { value: 'none', label: 'None' },
                { value: 'fade', label: 'Fade' },
                { value: 'grow', label: 'Grow' },
                { value: 'fade-grow', label: 'Fade + Grow' },
                { value: 'slide', label: 'Slide' },
              ]}
              onChange={onChange as (v: BarEntryAnim) => void}
            />
          ),
        } as RowSpec,
        msSliderRow({
          key: 'barEntryMs',
          label: 'Bar entry',
          hint: 'Per-bar entrance duration. 0 disables.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
        msSliderRow({
          key: 'barSmoothMs',
          label: 'Bar smooth',
          hint: 'Value chase duration on data updates. 0 snaps.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
      );
    }
    if (showLine) {
      animRows.push(
        {
          key: 'lineEntryAnimation',
          label: 'Line entry style',
          group: 'Series',
          render: (v, onChange) => (
            <Select<LineEntryAnim>
              value={v as LineEntryAnim}
              options={[
                { value: 'none', label: 'None' },
                { value: 'fade', label: 'Fade' },
                { value: 'grow', label: 'Grow' },
              ]}
              onChange={onChange as (v: LineEntryAnim) => void}
            />
          ),
        } as RowSpec,
        msSliderRow({
          key: 'lineEntryMs',
          label: 'Line entry',
          hint: 'Per-point entrance duration. 0 disables.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
        msSliderRow({
          key: 'lineSmoothMs',
          label: 'Line smooth',
          hint: 'Last-value chase time-constant. 0 snaps.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
        msSliderRow({
          key: 'linePulseMs',
          label: 'Line pulse',
          hint: 'Halo cycle period at the line tail. 0 disables.',
          group: 'Series',
          max: 3000,
          step: 50,
        }),
      );
    }
    if (showPie) {
      animRows.push(
        msSliderRow({
          key: 'pieEntryMs',
          label: 'Pie entry',
          hint: 'Slice grow-in duration on first paint.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
        msSliderRow({
          key: 'pieUpdateMs',
          label: 'Pie update',
          hint: 'Slice resize duration when data changes.',
          group: 'Series',
          max: 2000,
          step: 50,
        }),
      );
    }

    // ── X axis group — cartesian only ──
    if (showAxisAnim) {
      animRows.push(
        {
          key: 'xCurve',
          label: 'X curve',
          group: 'X axis',
          hint: 'Spring carries velocity across streaming ticks; Snap disables easing.',
          render: (v, onChange) => (
            <ToggleGroup<'spring' | 'snap'>
              value={v as 'spring' | 'snap'}
              options={[
                { value: 'spring', label: 'Spring' },
                { value: 'snap', label: 'Snap' },
              ]}
              onChange={onChange as (v: 'spring' | 'snap') => void}
            />
          ),
        } as RowSpec,
        msSliderRow({
          key: 'xSettleMs',
          label: 'X settle',
          hint: 'Streaming retarget baseline. Cadence EMA tunes this at runtime.',
          group: 'X axis',
          max: 1000,
          step: 25,
        }),
        msSliderRow({
          key: 'xGestureMs',
          label: 'X gesture',
          hint: 'Pan / zoom commit easing. 0 = instant apply.',
          group: 'X axis',
          max: 1000,
          step: 25,
        }),
      );
    }

    // ── Y axis group — cartesian only ──
    if (showAxisAnim) {
      animRows.push(
        {
          key: 'yCurve',
          label: 'Y curve',
          group: 'Y axis',
          hint: 'Hermite: fixed-duration cubic. Spring: critically-damped physics. Snap: no animation.',
          render: (v, onChange) => (
            <ToggleGroup<AxisCurve>
              value={v as AxisCurve}
              options={[
                { value: 'hermite', label: 'Hermite' },
                { value: 'spring', label: 'Spring' },
                { value: 'snap', label: 'Snap' },
              ]}
              onChange={onChange as (v: AxisCurve) => void}
            />
          ),
        } as RowSpec,
        msSliderRow({
          key: 'ySettleMs',
          label: 'Y settle',
          hint: 'Outward chase to a new extreme. Faster = punchier reaction to spikes.',
          group: 'Y axis',
          max: 2000,
          step: 50,
        }),
        msSliderRow({
          key: 'yStickyMs',
          label: 'Y sticky',
          hint: 'Inward contraction after an extreme leaves. Larger = stickier auto-fit.',
          group: 'Y axis',
          max: 10000,
          step: 100,
        }),
        msSliderRow({
          key: 'yGestureMs',
          label: 'Y gesture',
          hint: 'Y override during gestures. Short = frame-per-tick interactive feel.',
          group: 'Y axis',
          max: 1000,
          step: 25,
        }),
      );
    }

    // ── Other ──
    if (showAxisAnim) {
      animRows.push(
        msSliderRow({
          key: 'ticksMs',
          label: 'Tick fade',
          hint: 'Cross-fade duration for axis tick labels.',
          group: 'Other',
          max: 1000,
          step: 50,
        }),
      );
    }
    animRows.push(
      msSliderRow({
        key: 'toggleMs',
        label: 'Visibility toggle',
        hint: 'Series-visibility fade plus Y re-fit duration.',
        group: 'Other',
        max: 1000,
        step: 50,
      }),
    );

    sections.push({
      id: 'animations',
      title: 'Animations',
      icon: ICONS.animations,
      defaultOpen: false,
      rows: animRows,
    });
  }

  // Navigator is still in beta — only surface its toggle in `pnpm dev`, the
  // same dev-only gate that exposes the Stress page in the sidebar. Production
  // builds keep the data props plumbed (so the section just lays dormant) but
  // hide the controls so the strip can't be turned on accidentally.
  if (!hideCartesian && import.meta.env.DEV) {
    sections.push({
      id: 'navigator',
      title: 'Navigator (beta)',
      icon: ICONS.navigator,
      defaultOpen: false,
      rows: [
        {
          key: 'navigatorVisible',
          label: 'Visible',
          hint: 'Miniature overview strip with a draggable zoom window — beta',
          render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
        } as RowSpec,
        {
          key: 'navigatorHeight',
          label: 'Height',
          hint: 'Strip height in pixels',
          visible: (s) => s.navigatorVisible === true,
          render: (v, onChange) => (
            <Slider
              value={v as number}
              min={30}
              max={140}
              step={5}
              suffix="px"
              onChange={onChange as (v: number) => void}
            />
          ),
        } as RowSpec,
      ],
    });
  }

  return sections;
}

/** Merge page-contributed sections: `extend:` appends rows to a built-in, otherwise the section is added as new. */
function mergeSections(
  builtin: SectionSpec[],
  extra: SectionSpec[] = [],
  opts: { showPerfHud: boolean } = { showPerfHud: false },
): SectionSpec[] {
  const out: SectionSpec[] = builtin.map((s) => ({ ...s, rows: [...s.rows] }));
  const addAfterIndex: { [id: string]: number } = {};
  out.forEach((s, i) => {
    addAfterIndex[s.id] = i;
  });

  const newSections: SectionSpec[] = [];

  for (const spec of extra) {
    if (spec.extend) {
      const target = out.find((s) => s.id === spec.extend);
      if (target) {
        target.rows.push(...spec.rows);
        continue;
      }
    }
    newSections.push({ ...spec, rows: [...spec.rows] });
  }

  // Page-contributed new sections go after the built-in Display but before Grid
  // so they show up near the top where users expect them.
  const displayIdx = out.findIndex((s) => s.id === 'display');
  if (displayIdx >= 0 && newSections.length > 0) {
    out.splice(displayIdx + 1, 0, ...newSections);
  } else {
    out.push(...newSections);
  }

  // Perf HUD row is appended *after* page extensions so it always anchors the
  // bottom of the Demo section, regardless of what rows pages contribute.
  if (opts.showPerfHud) {
    const demo = out.find((s) => s.id === 'demo');
    if (demo) {
      demo.rows.push({
        key: 'perfHudVisible',
        label: 'Perf HUD',
        hint: 'FPS, frame time, draw calls, per-series ms, heap',
        render: (v, onChange) => <Toggle checked={v as boolean} onChange={onChange as (v: boolean) => void} />,
      } as RowSpec);
    }
  }

  // Respect explicit `defaultOpen` on every section. If nothing is explicitly
  // opened, the first non-empty section opens by default so the panel isn't
  // entirely collapsed on first load.
  for (const sec of out) {
    if (sec.rows.length === 0) continue;
    sec.defaultOpen = sec.defaultOpen ?? false;
  }
  const anyOpen = out.some((s) => s.rows.length > 0 && s.defaultOpen);
  if (!anyOpen) {
    const firstNonEmpty = out.find((s) => s.rows.length > 0);
    if (firstNonEmpty) firstNonEmpty.defaultOpen = true;
  }

  return out.filter((s) => s.rows.length > 0);
}

// ── Component ────────────────────────────────────────────────

export function Playground<TExtra extends object = Record<string, never>>({
  id,
  theme,
  extraDefaults,
  sections: extraSections,
  charts,
  codeConfig,
  gridTemplate = '1fr 1fr',
  gridColumns = '1fr',
  hideCartesian = false,
  showPerfHud = true,
  animationKinds = ['candle', 'bar', 'line'],
}: PlaygroundProps<TExtra>) {
  const mobile = useIsMobile();

  const fullDefaults = useMemo(() => {
    const resolved = typeof extraDefaults === 'function' ? extraDefaults(mobile) : extraDefaults;

    return { ...COMMON_DEFAULTS, ...(resolved as object) } as CommonState & TExtra;
  }, [extraDefaults, mobile]);

  const { state, setMany, reset, activeCount } = useSettings<CommonState & TExtra>({
    id,
    defaults: fullDefaults,
  });

  const allSections = useMemo(
    () =>
      mergeSections(buildBuiltinSections({ hideCartesian, showPerfHud, animationKinds }), extraSections, {
        showPerfHud,
      }),
    [hideCartesian, showPerfHud, animationKinds, extraSections],
  );

  const chartProps = useMemo(() => stateToChartProps(state, theme), [state, theme]);
  const codeConfigValue = codeConfig?.(chartProps);

  const { pct, containerRef, onMouseDown } = usePanelWidth();
  const { pct: codePct, rightRef, onMouseDown: onCodeDragDown } = useCodeHeight();
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

  const surfaceVars = useMemo(() => themeSurfaceVars(theme), [theme]);

  if (mobile) {
    return (
      <div className="wick-playground" data-mobile="true" style={surfaceVars}>
        <div className="pg-shell">
          <div
            className="pg-main"
            style={{
              gridTemplateRows: undefined,
              gridAutoRows: 200,
              gridTemplateColumns: '1fr',
            }}
          >
            {charts(chartProps)}
          </div>
        </div>

        <button
          type="button"
          className="pg-mobile-fab"
          aria-label="Open controls"
          onClick={() => setMobileControlsOpen(true)}
        >
          <SlidersHorizontal size={18} />
          <span className="pg-mobile-fab-label">Controls</span>
        </button>

        {mobileControlsOpen && (
          <>
            <button
              type="button"
              aria-label="Close controls"
              className="pg-mobile-backdrop"
              onClick={() => setMobileControlsOpen(false)}
            />
            <div className="pg-mobile-sheet" role="dialog" aria-modal="true" aria-label="Playground controls">
              <div className="pg-mobile-sheet-head">
                <span className="pg-mobile-sheet-title">Controls</span>
                <button
                  type="button"
                  className="pg-mobile-sheet-close"
                  aria-label="Close controls"
                  onClick={() => setMobileControlsOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="pg-right">
                <Panel<CommonState & TExtra>
                  sections={allSections}
                  state={state}
                  setMany={setMany}
                  reset={reset}
                  activeCount={activeCount}
                />
                {codeConfigValue && <CodeTabs config={codeConfigValue} theme={theme} />}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="wick-playground" ref={containerRef} style={surfaceVars}>
      <div className="pg-shell">
        <div
          className="pg-main"
          style={{
            gridTemplateRows: gridTemplate,
            gridTemplateColumns: gridColumns,
          }}
        >
          {charts(chartProps)}
        </div>

        <Splitter theme={theme} onMouseDown={onMouseDown} />

        <div
          className="pg-right"
          ref={rightRef}
          style={{
            width: `${pct}%`,
            gridTemplateRows: codeConfigValue ? `auto 1fr auto auto minmax(0, ${codePct}%)` : 'auto 1fr auto',
          }}
        >
          <Panel<CommonState & TExtra>
            sections={allSections}
            state={state}
            setMany={setMany}
            reset={reset}
            activeCount={activeCount}
          />
          {codeConfigValue && (
            <>
              <Splitter theme={theme} orientation="horizontal" onMouseDown={onCodeDragDown} thumbLength={36} />
              <CodeTabs config={codeConfigValue} theme={theme} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Re-exports (convenience for pages) ───────────────────────

export { Row } from './Row';
export { Section } from './Section';
