import type { ReactNode } from 'react';

import type { ChartTheme, TransitionFactory, YRange } from '@wick-charts/react';

import { Cell } from '../../components/Cell';

export interface PanelCtx {
  theme: ChartTheme;
  /** `perf={true}` passes through to the panel's ChartContainer. */
  perfHud: boolean;
  /** Y-bound transition factory. Panels that exercise streaming Y motion
   *  forward this through `ChartContainer.animations.axis.y.curve`.
   *  The stress page swaps between built-ins (hermite / spring / snap)
   *  via the top-bar toggle. */
  yEngine: TransitionFactory<YRange>;
  /** Short label for the currently selected transition — used in panel keys
   *  so toggling re-mounts the charts (the factory is captured at
   *  ChartContainer mount, so a live swap needs a fresh ChartInstance). */
  yEngineLabel: string;
}

export interface StressPanel {
  id: string;
  title: string;
  /** One-line hint shown under the title. */
  hint: string;
  /** Optional inline note in the panel footer (bigger explanations). */
  note?: string;
  render: (ctx: PanelCtx) => ReactNode;
  /** Minimum vertical space. Defaults to 320px. */
  minHeight?: number;
}

export function StressPanels({
  panels,
  theme,
  perfHud,
  yEngine,
  yEngineLabel,
}: {
  panels: readonly StressPanel[];
  theme: ChartTheme;
  perfHud: boolean;
  yEngine: TransitionFactory<YRange>;
  yEngineLabel: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {panels.map((p) => (
        // `ChartContainer` captures `perf` and `animations.axis.y.curve`
        // at mount only, so toggling the global HUD or the Y transition re-keys
        // each panel to force a remount.
        <div key={`${p.id}:${perfHud ? 'perf' : 'no-perf'}:${yEngineLabel}`} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: 14, color: theme.tooltip.textColor }}>{p.title}</strong>
              <span style={{ fontSize: 12, color: theme.axis.textColor, opacity: 0.8 }}>{p.hint}</span>
            </div>
          </div>
          <div style={{ height: p.minHeight ?? 320, display: 'grid', minHeight: 0, position: 'relative' }}>
            <Cell theme={theme}>{p.render({ theme, perfHud, yEngine, yEngineLabel })}</Cell>
          </div>
          {p.note && (
            <div style={{ fontSize: 11, color: theme.axis.textColor, opacity: 0.6, paddingLeft: 2 }}>{p.note}</div>
          )}
        </div>
      ))}
    </div>
  );
}
