// Each chart route renders its standalone playground. The companion API
// reference lives in the sidebar under API → Components, so the previous
// per-page Demos | API tab strip became redundant — readers reach the API
// page through the sidebar instead.

import type { FC } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import type { Route } from '../../routes';
import { BarPage } from '../BarPage';
import { CandlestickPage } from '../CandlestickPage';
import { LinePage } from '../LinePage';
import { PiePage } from '../PiePage';
import { SparklinePage } from '../SparklinePage';

const CHARTS: Record<string, FC<{ theme: ChartTheme }>> = {
  'charts/candlestick': CandlestickPage,
  'charts/line': LinePage,
  'charts/bar': BarPage,
  'charts/pie': PiePage,
  'charts/sparkline': SparklinePage,
};

export function ChartRoutePage({ route, theme }: { route: Route; theme: ChartTheme }) {
  const Demos = CHARTS[route];

  if (!Demos) {
    return <div style={{ padding: 24, color: theme.tooltip.textColor }}>Unknown chart route: {route}</div>;
  }

  return <Demos theme={theme} />;
}
