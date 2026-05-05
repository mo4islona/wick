// Centralised route table — sidebar groups, page titles, and hash-route
// validation all read from here so adding/renaming a page is a one-file change.

export type Route =
  | 'overview'
  | 'migration'
  | 'charts/candlestick'
  | 'charts/line'
  | 'charts/bar'
  | 'charts/pie'
  | 'charts/sparkline'
  // TODO(advanced): only multi-chart-sync ships in this PR. Page files for
  // 'advanced/load-on-scroll' and 'advanced/custom-overlay' live on disk
  // (docs/pages/advanced/{load-on-scroll,custom-overlay}.tsx) and stay
  // unwired here intentionally — they need polish before going live.
  // Re-enable by adding the two route literals below and re-registering
  // them in docs/pages/advanced/index.tsx.
  | 'advanced/multi-chart-sync'
  | 'api/line-series'
  | 'api/bar-series'
  | 'api/candlestick-series'
  | 'api/pie-series'
  | 'api/sparkline'
  | 'api/chart-container'
  | 'api/x-axis'
  | 'api/y-axis'
  | 'api/tooltip'
  | 'api/crosshair'
  | 'api/legend'
  | 'api/navigator'
  | 'api/title'
  | 'api/info-bar'
  | 'api/pie-legend'
  | 'api/pie-tooltip'
  | 'api/number-flow'
  | 'api/y-label'
  | 'hooks/use-chart-instance'
  | 'hooks/use-theme'
  | 'hooks/use-crosshair-position'
  | 'hooks/use-last-y-value'
  | 'hooks/use-previous-close'
  | 'hooks/use-visible-range'
  | 'hooks/use-y-range'
  | 'customization/theme'
  | 'stress-test';

export interface RouteEntry {
  route: Route;
  label: string;
  /**
   * Title shown in the App-level page header. Empty when the page renders
   * its own header (e.g. ApiPage, HookPage) — keeps us from showing the
   * component name twice.
   */
  title: string;
}

export interface RouteSection {
  /** `null` = ungrouped (rendered without a header). */
  heading: string | null;
  /** Leaf entries. Mutually exclusive with `subsections` — a section is
   *  either a flat list (Charts, Hooks) or a container of nested groups
   *  (API → Components + Hooks). */
  items?: RouteEntry[];
  /** Nested groups, each rendered with their own collapsible heading
   *  one indent level deeper than this section. */
  subsections?: RouteSection[];
}

/**
 * Backwards-compatible aliases for the old hash routes. When someone lands
 * on an old URL we silently rewrite the hash to the new path.
 *
 * Two generations of aliases live here:
 *   1. The pre-restructure single-key form (`#dashboard`, `#line`, `#theme`).
 *   2. The first-restructure `components/*` paths, now renamed to `charts/*`.
 */
export const ROUTE_ALIASES: Record<string, Route> = {
  // pre-restructure
  dashboard: 'overview',
  candlestick: 'charts/candlestick',
  line: 'charts/line',
  bar: 'charts/bar',
  pie: 'charts/pie',
  sparkline: 'charts/sparkline',
  theme: 'customization/theme',
  // pre-rename (Components → Charts)
  'components/candlestick': 'charts/candlestick',
  'components/line': 'charts/line',
  'components/bar': 'charts/bar',
  'components/pie': 'charts/pie',
  'components/sparkline': 'charts/sparkline',
};

const CHARTS: RouteEntry[] = [
  { route: 'charts/candlestick', label: 'Candlestick', title: 'Candlestick' },
  { route: 'charts/line', label: 'Line & Area', title: 'Line & Area' },
  { route: 'charts/bar', label: 'Bar', title: 'Bar' },
  { route: 'charts/pie', label: 'Pie & Donut', title: 'Pie & Donut' },
  { route: 'charts/sparkline', label: 'Sparkline', title: 'Sparkline' },
];

const ADVANCED: RouteEntry[] = [
  { route: 'advanced/multi-chart-sync', label: 'Multi-chart Sync', title: 'Multi-chart Sync' },
];

// API entries own their own header (rendered by ApiPage), so the App-level
// title is left blank to avoid the "PieLegend / PieLegend" duplication.
// Split into two flat A→Z lists:
//   - `Charts` — series renderers (have a "↗ Try the live demo" link
//     to the matching `charts/*` route)
//   - `Components` — container, axes, overlays, formatters
// Both render under the API parent section in the sidebar.
const API_CHARTS: RouteEntry[] = [
  { route: 'api/bar-series', label: 'BarSeries', title: '' },
  { route: 'api/candlestick-series', label: 'CandlestickSeries', title: '' },
  { route: 'api/line-series', label: 'LineSeries', title: '' },
  { route: 'api/pie-series', label: 'PieSeries', title: '' },
  { route: 'api/sparkline', label: 'Sparkline', title: '' },
];

const API_COMPONENTS: RouteEntry[] = [
  { route: 'api/chart-container', label: 'ChartContainer', title: '' },
  { route: 'api/crosshair', label: 'Crosshair', title: '' },
  { route: 'api/info-bar', label: 'InfoBar', title: '' },
  { route: 'api/legend', label: 'Legend', title: '' },
  { route: 'api/navigator', label: 'Navigator', title: '' },
  { route: 'api/number-flow', label: 'NumberFlow', title: '' },
  { route: 'api/pie-legend', label: 'PieLegend', title: '' },
  { route: 'api/pie-tooltip', label: 'PieTooltip', title: '' },
  { route: 'api/title', label: 'Title', title: '' },
  { route: 'api/tooltip', label: 'Tooltip', title: '' },
  { route: 'api/x-axis', label: 'XAxis', title: '' },
  { route: 'api/y-axis', label: 'YAxis', title: '' },
  { route: 'api/y-label', label: 'YLabel', title: '' },
];

/** Combined flat list — used by `getSection` / `isRoute` lookups. */
const API: RouteEntry[] = [...API_CHARTS, ...API_COMPONENTS];

// Hook pages render their own H2, so leave the App-level title blank.
const HOOKS: RouteEntry[] = [
  { route: 'hooks/use-chart-instance', label: 'useChartInstance', title: '' },
  { route: 'hooks/use-theme', label: 'useTheme', title: '' },
  { route: 'hooks/use-crosshair-position', label: 'useCrosshairPosition', title: '' },
  { route: 'hooks/use-last-y-value', label: 'useLastYValue', title: '' },
  { route: 'hooks/use-previous-close', label: 'usePreviousClose', title: '' },
  { route: 'hooks/use-visible-range', label: 'useVisibleRange', title: '' },
  { route: 'hooks/use-y-range', label: 'useYRange', title: '' },
];

const CUSTOMIZATION: RouteEntry[] = [{ route: 'customization/theme', label: 'Theme', title: 'Custom Theme' }];

const OVERVIEW: RouteEntry = { route: 'overview', label: 'Overview', title: '' };
// Title left blank — the markdown page already renders its own H1 ("Migration
// guide"), so showing it again in the topbar would duplicate.
const MIGRATION: RouteEntry = { route: 'migration', label: 'Migration Guide', title: '' };
const STRESS: RouteEntry = { route: 'stress-test', label: 'Stress', title: 'Stress Tests' };

const BASE_SECTIONS: RouteSection[] = [
  { heading: null, items: [OVERVIEW, MIGRATION] },
  { heading: 'Charts', items: CHARTS },
  { heading: 'Advanced', items: ADVANCED },
  {
    heading: 'API',
    subsections: [
      { heading: 'Charts', items: API_CHARTS },
      { heading: 'Components', items: API_COMPONENTS },
      { heading: 'Hooks', items: HOOKS },
    ],
  },
  { heading: 'Customization', items: CUSTOMIZATION },
];

export function getSections(dev: boolean): RouteSection[] {
  if (!dev) return BASE_SECTIONS;

  return [...BASE_SECTIONS, { heading: 'Internal', items: [STRESS] }];
}

const ALL_ENTRIES: RouteEntry[] = [
  OVERVIEW,
  MIGRATION,
  ...CHARTS,
  ...ADVANCED,
  ...API,
  ...HOOKS,
  ...CUSTOMIZATION,
  STRESS,
];

const ROUTES_SET = new Set<string>(ALL_ENTRIES.map((e) => e.route));

export function isRoute(s: string): s is Route {
  return ROUTES_SET.has(s);
}

export function getTitle(route: Route): string {
  const entry = ALL_ENTRIES.find((e) => e.route === route);

  return entry?.title ?? '';
}

/**
 * Section heading for a given route — used by the breadcrumb on subcomponent
 * and chart pages. Walks one level into `subsections` so a route under
 * `API → Hooks` still resolves to `'API'` (the breadcrumb's outermost label).
 * Returns `null` for top-level routes (Overview).
 */
export function getSection(route: Route): string | null {
  for (const section of BASE_SECTIONS) {
    if (section.items?.some((i) => i.route === route)) return section.heading;
    if (section.subsections?.some((sub) => sub.items?.some((i) => i.route === route))) {
      return section.heading;
    }
  }

  return null;
}

/**
 * Returns every heading on the path from root to the leaf containing `route`.
 * Used by the sidebar to auto-expand nested groups on deep-link / nav.
 *
 * For `route = 'hooks/use-chart-instance'` returns `['API', 'Hooks']`; for a
 * top-level route under `Charts` returns `['Charts']`.
 */
export function getSectionPath(route: Route): string[] {
  for (const section of BASE_SECTIONS) {
    if (section.items?.some((i) => i.route === route)) {
      return section.heading ? [section.heading] : [];
    }
    if (section.subsections) {
      for (const sub of section.subsections) {
        if (sub.items?.some((i) => i.route === route)) {
          const path: string[] = [];
          if (section.heading) path.push(section.heading);
          if (sub.heading) path.push(sub.heading);

          return path;
        }
      }
    }
  }

  return [];
}

/** Charts API → Charts demo route mapping (used for the "↗ See demos" cross-link). */
export const CHART_API_TO_DEMO: Record<string, Route> = {
  'api/line-series': 'charts/line',
  'api/bar-series': 'charts/bar',
  'api/candlestick-series': 'charts/candlestick',
  'api/pie-series': 'charts/pie',
  'api/sparkline': 'charts/sparkline',
};

/**
 * Derive the canonical React hook name from a `hooks/<slug>` route — single
 * source of truth for App.tsx (dispatch) and Sidebar.tsx (per-framework
 * label swap), so adding/renaming a hook only requires updating the route
 * table here.
 *
 *   "hooks/use-chart-instance" → "useChartInstance"
 */
export function hookKeyForRoute(route: Route): string | null {
  if (!route.startsWith('hooks/')) return null;
  const slug = route.slice('hooks/'.length);

  return slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
