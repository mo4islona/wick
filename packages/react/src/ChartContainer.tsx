import {
  type CSSProperties,
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type AnimationsConfig,
  type AxisConfig,
  ChartInstance,
  type ChartOptions,
  type ChartTheme,
  type EdgeReachedInfo,
  type VisibleRangeSpec,
} from '@wick-charts/core';

type PerfOption = NonNullable<ChartOptions['perf']>;

import { ChartContext } from './context';
import { ThemeProvider, useThemeOptional } from './ThemeContext';
import { InfoBar } from './ui/InfoBar';
import { Legend, type LegendProps } from './ui/Legend';
import { Navigator } from './ui/Navigator';
import { PieLegend, type PieLegendProps } from './ui/PieLegend';
import { Title } from './ui/Title';

/** Props for the {@link ChartContainer} component. */
export interface ChartContainerProps {
  /** Series components and UI overlays (Tooltip, TimeAxis, etc.) rendered inside the chart. */
  children?: ReactNode;
  /** Visual theme. Changing this at runtime will update all themed elements. */
  theme?: ChartTheme;
  /** Grouped axis configuration (Y/X visibility, bounds, sizing). */
  axis?: AxisConfig;
  /**
   * Viewport padding around the plot area. Applied on mount only — changing
   * this prop after mount is ignored. Set every side to `0` for an
   * edge-to-edge sparkline.
   *
   * @default `{ top: 20, bottom: 20, right: { intervals: 3 }, left: { intervals: 0 } }`
   */
  padding?: {
    /** Pixels of empty space above the plot area. Default `20`. */
    top?: number;
    /** Pixels of empty space below the plot area. Default `20`. */
    bottom?: number;
    /**
     * Empty space on the right edge. A `number` is pixels (e.g. `50`); an
     * object pads by data intervals on the time axis (e.g. `{ intervals: 3 }`
     * leaves room for three more bars/candles past the latest point). Default
     * `{ intervals: 3 }`.
     */
    right?: number | { intervals: number };
    /**
     * Empty space on the left edge. A `number` is pixels; an object pads by
     * data intervals on the time axis. Default `{ intervals: 0 }`.
     */
    left?: number | { intervals: number };
  };
  /**
   * Viewport-level streaming behavior. Captured at mount only — changing this
   * prop after the chart is created is ignored.
   */
  viewport?: {
    /**
     * Width of the visible window in data bars, set on the first data load
     * to `maxVisibleBars * dataInterval`. While the dataset is smaller than
     * this width, streaming ticks render into the empty right-side gap and
     * the viewport stays put; once the data reaches the right edge, the
     * viewport pans forward to keep the latest bar pinned (tail-scroll).
     * Default: 200.
     */
    maxVisibleBars?: number;
    /**
     * Initial visible range applied before the first paint with data. Same
     * shape as the imperative `chart.setVisibleRange` — pass a bar count
     * (e.g. `35`), an explicit `{from, to}` window, or `{from, bars}` for
     * a warm-up pair. The standard alternative is calling
     * `setVisibleRange` from a `useEffect`, but that runs post-paint and
     * makes the chart visibly re-zoom on the next RAF. Captured at mount.
     */
    initialRange?: VisibleRangeSpec;
  };
  /** Show the chart background gradient. Defaults to true. */
  gradient?: boolean;
  /** Enable zoom, pan, and crosshair interactions. Defaults to true. */
  interactive?: boolean;
  /** Background grid configuration. Default: `{ visible: true }`. */
  grid?: {
    /** Whether the background grid is rendered. Default: `true`. */
    visible: boolean;
  };
  /**
   * How `<Title>` and `<InfoBar>` are positioned relative to the canvas.
   * - `'overlay'` (default): absolute overlays on top of the canvas — the grid
   *   and Y-axis labels render full-height behind the header strip.
   * - `'inline'`: flex siblings above the canvas — the canvas (and grid) are
   *   shifted down by the measured header height, so nothing renders behind
   *   the title. The chart background still spans the full container.
   */
  headerLayout?: 'overlay' | 'inline';
  /**
   * Animation control. `true` / omitted uses built-in defaults; `false`
   * disables every category. Per-series options on `<LineSeries>` /
   * `<CandlestickSeries>` / `<BarSeries>` override these chart-level
   * defaults unless the category here is explicitly `false`. Updates
   * after mount call `chart.setAnimations(...)`.
   */
  animations?: boolean | AnimationsConfig;
  /**
   * Enable runtime performance instrumentation. Off by default.
   *
   * - `true` — attach a {@link PerfMonitor} and render a visible HUD overlay on this chart.
   * - `{ hud: true, windowMs, maxSamples, ... }` — same, with monitor options.
   * - `{ hud: false, monitor }` — attach to an existing monitor without rendering the HUD.
   *
   * Only read at mount; changing this prop after the chart is created is ignored.
   */
  perf?: PerfOption;
  /**
   * Fired after the user releases a pan/zoom gesture that pulled the viewport
   * past a data edge by more than ~10% of the visible range. Hosts typically
   * respond by prefetching more history.
   *
   * For threshold-based prefetch (load *before* the user fully overshoots),
   * use `<EdgeLoader>` instead — that component subscribes to `viewportChange`
   * and arms when the visible range nears the data edge.
   *
   * Captured at mount only; changing the prop identity later is ignored.
   */
  onEdgeReached?: (info: EdgeReachedInfo) => void;
  /** Inline style for the chart's outer wrapper element. */
  style?: CSSProperties;
  /** Extra class for the chart's outer wrapper element. */
  className?: string;
}

/**
 * Split children into `<Title>`, `<Legend>`, `<InfoBar>`, and the rest.
 *
 * Transparently walks through `<React.Fragment>` wrappers so the caller can
 * use normal React patterns — e.g. wrapping children in a conditional
 * fragment or returning fragments from parent components — and still get
 * hoisting. Deeper component boundaries are left alone on purpose: a custom
 * component that internally renders a `<Title>` / `<InfoBar>` is its own DOM
 * subtree and should stay there.
 *
 * Exported for testing — this is pure React-children iteration with no DOM
 * dependencies, so it can be asserted in Node.
 */
export function siftContainerChildren(children: ReactNode): {
  titleEl: ReactElement | null;
  legendEl: ReactElement<LegendProps> | null;
  pieLegendEl: ReactElement<PieLegendProps> | null;
  tooltipLegendEl: ReactElement | null;
  navigatorEl: ReactElement | null;
  overlay: ReactNode[];
} {
  let titleEl: ReactElement | null = null;
  let legendEl: ReactElement<LegendProps> | null = null;
  let pieLegendEl: ReactElement<PieLegendProps> | null = null;
  let tooltipLegendEl: ReactElement | null = null;
  let navigatorEl: ReactElement | null = null;
  const overlay: ReactNode[] = [];

  const visit = (child: ReactNode): void => {
    if (isValidElement(child) && child.type === Fragment) {
      // Unwrap fragments recursively — fragments don't produce DOM nodes,
      // so a Title/Legend/InfoBar nested in one is still a layout-level sibling.
      Children.forEach((child as ReactElement<{ children?: ReactNode }>).props.children, visit);
      return;
    }
    if (isValidElement(child)) {
      if (child.type === Title) {
        titleEl = child;
        return;
      }
      if (child.type === Legend) {
        legendEl = child as ReactElement<LegendProps>;
        return;
      }
      if (child.type === PieLegend) {
        // `position='overlay'` opts back into the old absolute-positioned
        // layout, so we leave it in the overlay array for that path only.
        const typed = child as ReactElement<PieLegendProps>;
        if (typed.props.position === 'overlay') {
          overlay.push(child);
        } else {
          pieLegendEl = typed;
        }
        return;
      }
      if (child.type === InfoBar) {
        tooltipLegendEl = child;
        return;
      }
      if (child.type === Navigator) {
        navigatorEl = child;
        return;
      }
    }
    overlay.push(child);
  };

  Children.forEach(children, visit);
  return { titleEl, legendEl, pieLegendEl, tooltipLegendEl, navigatorEl, overlay };
}

/**
 * Top-level React wrapper that creates a {@link ChartInstance} and provides it to children via context.
 * Owns the DOM container and canvas lifecycle; renders children as an overlay layer.
 *
 * Detects `<Title>`, `<InfoBar>`, and `<Legend>` children and positions them as:
 *   - Title + InfoBar — absolutely-positioned *overlays* stacked at the top of the canvas
 *     block, so the canvas (and therefore the grid) fills the full container height. The stacked
 *     height is measured and fed back into `chart.setPadding({ top })` so series data stays below
 *     them.
 *   - Legend — flex sibling at the bottom (or right, when `position="right"`), so its height is
 *     reserved by browser layout.
 */
export function ChartContainer({
  children,
  theme,
  axis,
  padding,
  viewport,
  gradient = true,
  interactive,
  grid,
  headerLayout = 'overlay',
  perf,
  animations,
  onEdgeReached,
  style,
  className,
}: ChartContainerProps) {
  // Mount-only: capture the initial perf option in a ref so later renders with
  // a new object identity don't recreate the chart or remount the HUD.
  const perfRef = useRef(perf);
  // Same mount-only capture for the edge callback — the chart binds it once.
  const onEdgeReachedRef = useRef(onEdgeReached);
  const contextTheme = useThemeOptional();
  const resolvedTheme = theme ?? contextTheme ?? undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const [_, setRevision] = useState(0);

  // useLayoutEffect — synchronous, runs before paint.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) return;

    const options: ChartOptions = {};
    if (axis) options.axis = axis;
    if (resolvedTheme) options.theme = resolvedTheme;
    if (padding) options.padding = padding;
    if (viewport) options.viewport = viewport;
    if (interactive !== undefined) options.interactive = interactive;
    if (grid !== undefined) options.grid = grid;
    if (perfRef.current !== undefined) options.perf = perfRef.current;
    if (animations !== undefined) options.animations = animations;
    if (onEdgeReachedRef.current) options.onEdgeReached = onEdgeReachedRef.current;
    chartRef.current = new ChartInstance(containerRef.current, options);

    // Note: the init path above already propagated `grid` into the chart. The
    // effect below handles live updates, but also needs to run on the same
    // commit so an initial `grid={{visible:false}}` isn't silently reset.
    setRevision((r) => r + 1);

    return () => {
      // Destroy synchronously. A previous revision deferred this through
      // `setTimeout(..., 0)` to "tolerate StrictMode" but the guard was
      // broken: in the StrictMode remount sequence (cleanup → second mount →
      // timeout), the check `if (!chartRef.current) instance.destroy()`
      // always saw the second instance and skipped the destroy — leaking
      // the first ChartInstance's canvases (hence 4 canvases per chart in
      // dev). StrictMode exists precisely to exercise cleanup; a correct
      // `destroy` is cheap enough to run on every cycle.
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && resolvedTheme) {
      chartRef.current.setTheme(resolvedTheme);
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (chartRef.current && axis) {
      chartRef.current.setAxis(axis);
    }
  }, [axis?.y?.width, axis?.y?.min, axis?.y?.max, axis?.y?.visible, axis?.x?.height, axis?.x?.visible]);

  // JSON.stringify drops functions, so a factory swap on
  // `animations.viewport.yEngine` wouldn't otherwise re-fire the effect
  // below. Compare it as a separate dep; chart.setAnimations
  // short-circuits when the factory reference is unchanged.
  //
  // Both deps are memoized by reference identity of `animations` so
  // callers that memoize the prop pay one stringify per shape change,
  // not one per render. Stringify of a small object is microsecond-
  // level, but on a streaming chart that re-renders dozens of times
  // per second the cost adds up if not cached.
  const animationsShape = useMemo(() => JSON.stringify(animations), [animations]);
  const yEngineRef = useMemo(
    () =>
      typeof animations === 'object' && animations && typeof animations.viewport === 'object' && animations.viewport
        ? animations.viewport.yEngine
        : undefined,
    [animations],
  );
  useEffect(() => {
    if (chartRef.current && animations !== undefined) {
      chartRef.current.setAnimations(animations);
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: structural dep computed above
  }, [animationsShape, yEngineRef]);

  // Top-overlay height (title + info bar) — measured below. Declared here so
  // the padding effect can fold it into `padding.top`.
  const topOverlayRef = useRef<HTMLDivElement>(null);
  const [topOverlayHeight, setTopOverlayHeight] = useState(0);

  // In 'inline' mode the canvas itself is shorter (browser flex reserves the
  // header height), so adding topOverlayHeight here would double-shift the
  // data. Only the overlay mode needs the fold-in. Depend on `headerExtra`
  // below instead of `topOverlayHeight` so inline-mode header resizes don't
  // fire redundant `chart.setPadding(...)` calls (headerExtra stays 0).
  const headerExtra = headerLayout === 'overlay' ? topOverlayHeight : 0;

  // useLayoutEffect (not useEffect) so the header-height fold-in lands
  // before the browser paints the chart for the first time. With
  // `useEffect` the padding update would fire AFTER paint, causing a
  // visible "chart drawn, then everything shifts down by the header
  // height on the next frame" jump on initial mount.
  useLayoutEffect(() => {
    const current = chartRef.current;
    if (!current) return;
    const userTop = padding?.top ?? 20;
    const merged: ChartOptions['padding'] = {
      top: userTop + headerExtra,
      ...(padding?.bottom !== undefined ? { bottom: padding.bottom } : {}),
      ...(padding?.right !== undefined ? { right: padding.right } : {}),
      ...(padding?.left !== undefined ? { left: padding.left } : {}),
    };
    current.setPadding(merged);
  }, [
    padding?.top,
    padding?.bottom,
    typeof padding?.right === 'object' ? padding.right.intervals : padding?.right,
    typeof padding?.left === 'object' ? padding.left.intervals : padding?.left,
    headerExtra,
  ]);

  useEffect(() => {
    if (chartRef.current && grid !== undefined) {
      chartRef.current.setGrid(grid);
    }
  }, [grid?.visible]);

  const chart = chartRef.current;

  const { titleEl, legendEl, pieLegendEl, tooltipLegendEl, navigatorEl, overlay } = siftContainerChildren(children);
  const legendPosition = legendEl?.props.position ?? 'bottom';
  const pieLegendPosition = pieLegendEl?.props.position ?? 'bottom';
  // Either legend type can pull the layout into row-mode. `Legend` and
  // `PieLegend` are mutually exclusive in practice (line vs pie chart), so we
  // just OR the two position checks.
  const isLegendRight = legendPosition === 'right' || pieLegendPosition === 'right';

  const effectiveTheme = resolvedTheme ?? chart?.getTheme();
  const [gtop, gbot] = effectiveTheme?.chartGradient ?? ['transparent', 'transparent'];
  const bg = effectiveTheme?.background ?? 'transparent';
  const backgroundStyle = gradient ? `linear-gradient(to bottom, ${gtop} 0%, ${bg} 70%, ${gbot} 100%)` : bg;

  // Measure the stacked overlay (Title + InfoBar) height and feed it
  // into the padding effect above so data stays below them even though the
  // canvas itself fills the whole container. Only needed in 'overlay' mode —
  // 'inline' mode lets browser flex layout reserve header height directly,
  // so we skip the ResizeObserver entirely and clear any stale measurement.
  useLayoutEffect(() => {
    if (headerLayout !== 'overlay') {
      setTopOverlayHeight(0);
      return;
    }
    const el = topOverlayRef.current;
    if (!el) {
      // When neither Title nor InfoBar is present the overlay wrapper
      // isn't rendered — clear any stale measured height so `padding.top`
      // drops back to the user's configured value on the next effect run.
      setTopOverlayHeight(0);
      return;
    }
    const update = () => setTopOverlayHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // `chart !== null` is in deps so the measurement re-runs once the
    // ChartInstance is attached — on the first pass the overlay wrapper is
    // gated behind `chart && (...)` so the ref is null; without this dep
    // React wouldn't re-fire when the overlay finally mounts.
  }, [titleEl !== null, tooltipLegendEl !== null, headerLayout, chart !== null]);

  const headerStack = (titleEl || tooltipLegendEl) && (
    <div
      data-chart-header=""
      data-chart-top-overlay={headerLayout === 'overlay' ? '' : undefined}
      ref={topOverlayRef}
      style={
        headerLayout === 'overlay'
          ? {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              // Lower than the series-overlay layer below, so the floating
              // <Tooltip> glass panel renders *above* Title/InfoBar
              // when the cursor hovers near them.
              zIndex: 2,
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
            }
          : {
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'none',
            }
      }
    >
      {titleEl}
      {tooltipLegendEl}
    </div>
  );

  const chartInner = (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {chart && (
        <ChartContext.Provider value={chart}>
          <ThemeProvider value={resolvedTheme ?? chart.getTheme()}>
            {headerLayout === 'overlay' && headerStack}
            <div
              data-chart-series-overlay=""
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 3,
              }}
            >
              {overlay}
            </div>
          </ThemeProvider>
        </ChartContext.Provider>
      )}
    </div>
  );

  const canvasBlock =
    headerLayout === 'inline' ? (
      <div
        data-chart-canvas-block=""
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}
      >
        {chart && headerStack && (
          <ChartContext.Provider value={chart}>
            <ThemeProvider value={resolvedTheme ?? chart.getTheme()}>{headerStack}</ThemeProvider>
          </ChartContext.Provider>
        )}
        {chartInner}
      </div>
    ) : (
      chartInner
    );

  const hoistedLegend = chart && legendEl && (
    <ChartContext.Provider value={chart}>
      <ThemeProvider value={resolvedTheme ?? chart.getTheme()}>{legendEl}</ThemeProvider>
    </ChartContext.Provider>
  );

  const hoistedPieLegend = chart && pieLegendEl && (
    <ChartContext.Provider value={chart}>
      <ThemeProvider value={resolvedTheme ?? chart.getTheme()}>{pieLegendEl}</ThemeProvider>
    </ChartContext.Provider>
  );

  const hoistedNavigator = chart && navigatorEl && (
    <ChartContext.Provider value={chart}>
      <ThemeProvider value={resolvedTheme ?? chart.getTheme()}>{navigatorEl}</ThemeProvider>
    </ChartContext.Provider>
  );

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: backgroundStyle,
        ...style,
      }}
    >
      {/* One stable wrapper for both legend positions. Keeping the tree
          structure identical means React reconciles canvasBlock in place
          when `isLegendRight` flips, preserving the canvas element and
          letting its ResizeObserver re-layout the chart in response to
          the new flex bounds. A branching <> ↔ <div> swap would remount
          the canvas and throw away chart state. */}
      <div
        style={{
          display: 'flex',
          flexDirection: isLegendRight ? 'row' : 'column',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {canvasBlock}
        {hoistedLegend}
        {hoistedPieLegend}
      </div>
      {hoistedNavigator}
    </div>
  );
}
