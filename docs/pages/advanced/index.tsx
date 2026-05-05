import type { FC } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import type { Route } from '../../routes';
import { MultiChartSyncPage } from './multi-chart-sync';

// TODO(advanced): only multi-chart-sync is wired up. Sibling page files
// (load-on-scroll.tsx, custom-overlay.tsx) live on disk and stay
// intentionally unregistered — they need polish before going live. To
// revive: import the page component and add a `'advanced/<slug>': Page`
// entry below, then add the matching literal to the `Route` union in
// `docs/routes.ts` and the sidebar list in `getSections`.
const ADVANCED: Record<string, FC<{ theme: ChartTheme }>> = {
  'advanced/multi-chart-sync': MultiChartSyncPage,
};

export function AdvancedRoutePage({ route, theme }: { route: Route; theme: ChartTheme }) {
  const Page = ADVANCED[route];

  if (!Page) {
    return <div style={{ padding: 24, color: theme.tooltip.textColor }}>Unknown advanced route: {route}</div>;
  }

  return <Page theme={theme} />;
}
