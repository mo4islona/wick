import type { ReactNode } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import { Cell } from '../../components/Cell';

export interface PanelCtx {
  theme: ChartTheme;
  /** `perf={true}` passes through to the panel's ChartContainer. */
  perfHud: boolean;
  /** Y-bound animator engine — `'spring'` (default) for asymptotic
   *  velocity-handoff physics, `'hermite'` for fixed-duration
   *  velocity-matched cubic. Panels that exercise streaming Y motion
   *  should pass this through their `ChartContainer.animations.viewport.yEngine`. */
  yEngine: 'spring' | 'hermite';
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
}: {
  panels: readonly StressPanel[];
  theme: ChartTheme;
  perfHud: boolean;
  yEngine: 'spring' | 'hermite';
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {panels.map((p) => (
        // `ChartContainer` captures `perf` and `animations.viewport.yEngine`
        // at mount only, so toggling the global HUD or the Y engine re-keys
        // each panel to force a remount.
        <div key={`${p.id}:${perfHud ? 'perf' : 'no-perf'}:${yEngine}`} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: 14, color: theme.tooltip.textColor }}>{p.title}</strong>
              <span style={{ fontSize: 12, color: theme.axis.textColor, opacity: 0.8 }}>{p.hint}</span>
            </div>
          </div>
          <div style={{ height: p.minHeight ?? 320, display: 'grid', minHeight: 0, position: 'relative' }}>
            <Cell theme={theme}>{p.render({ theme, perfHud, yEngine })}</Cell>
          </div>
          {p.note && (
            <div style={{ fontSize: 11, color: theme.axis.textColor, opacity: 0.6, paddingLeft: 2 }}>{p.note}</div>
          )}
        </div>
      ))}
    </div>
  );
}
