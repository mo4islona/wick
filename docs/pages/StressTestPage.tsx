import { useEffect, useMemo, useState } from 'react';

import { type ChartTheme, hermite, snap, spring } from '@wick-charts/react';

import { Toggle } from '../components/playground/primitives';
import { themeSurfaceVars } from '../components/playground/themeSurface';
import { dataPanels } from './stress/data';
import { multiPanels } from './stress/multi';
import { StressPanels } from './stress/panel';
import { piePanels } from './stress/pie';
import { reactPanels } from './stress/react';
import { scalePanels } from './stress/scale';
import { streamingPanels } from './stress/streaming';
import { themePanels } from './stress/theme';
import { timeAxisPanels } from './stress/timeaxis';
import { viewportPanels } from './stress/viewport';
import { volumePanels } from './stress/volume';

type GroupId =
  | 'volume'
  | 'streaming'
  | 'data'
  | 'scale'
  | 'timeaxis'
  | 'multi'
  | 'pie'
  | 'viewport'
  | 'theme'
  | 'react';

const GROUPS: { id: GroupId; label: string; hint: string }[] = [
  { id: 'volume', label: 'Volume', hint: '10k · 100k points · streaming' },
  { id: 'streaming', label: 'Streaming', hint: 'warm-up · jumps · jitter · pause' },
  { id: 'data', label: 'Data hygiene', hint: 'empty · nulls · NaN · gaps' },
  { id: 'scale', label: 'Scale', hint: 'constant · tiny · giant · negative' },
  { id: 'timeaxis', label: 'Time axis', hint: 'ms · days · years · decades' },
  { id: 'multi', label: 'Multi-renderer', hint: 'candle + line + bar overlays' },
  { id: 'pie', label: 'Pie', hint: 'zero · 100-slice · poisoned' },
  { id: 'viewport', label: 'Viewport', hint: 'tiny · wide · zoom · hidden' },
  { id: 'theme', label: 'Theme', hint: 'thin-candles · cycle · contrast' },
  { id: 'react', label: 'React', hint: 'ref identity · id churn' },
];

const STORAGE_KEY = 'wick-charts:stress-test:group';

function isGroupId(value: unknown): value is GroupId {
  return typeof value === 'string' && GROUPS.some((g) => g.id === value);
}

function readPersistedGroup(): GroupId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isGroupId(stored)) return stored;
  } catch {
    // localStorage may be unavailable (private mode, sandboxed iframe) — fall through.
  }

  return 'volume';
}

type YEngineLabel = 'hermite' | 'spring' | 'snap';

const Y_ENGINE_FACTORIES = {
  hermite,
  spring,
  snap,
} as const;

export function StressTestPage({ theme }: { theme: ChartTheme }) {
  const [group, setGroup] = useState<GroupId>(readPersistedGroup);
  const [perfHud, setPerfHud] = useState(false);
  const [yEngineLabel, setYEngineLabel] = useState<YEngineLabel>('hermite');
  const yEngine = useMemo(() => Y_ENGINE_FACTORIES[yEngineLabel](), [yEngineLabel]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, group);
    } catch {
      // localStorage write failed — non-critical; the in-memory state still works.
    }
  }, [group]);

  const surface = useMemo(() => themeSurfaceVars(theme), [theme]);

  const panels = useMemo(() => {
    switch (group) {
      case 'volume':
        return volumePanels;
      case 'streaming':
        return streamingPanels;
      case 'data':
        return dataPanels;
      case 'scale':
        return scalePanels;
      case 'timeaxis':
        return timeAxisPanels;
      case 'multi':
        return multiPanels;
      case 'pie':
        return piePanels;
      case 'viewport':
        return viewportPanels;
      case 'theme':
        return themePanels;
      case 'react':
        return reactPanels;
    }
  }, [group]);

  return (
    <div
      className="wick-playground"
      style={{ ...surface, padding: 16, display: 'grid', gap: 16, overflowY: 'auto', minHeight: 0 }}
    >
      <header style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: theme.tooltip.textColor }}>Stress Tests</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: theme.axis.textColor, opacity: 0.8 }}>
              Visual regression catalog — only the active group is mounted. Dev-only in the sidebar; reachable at{' '}
              <code>#stress-test</code> in any build.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.tooltip.textColor }}
            >
              <span>Y engine</span>
              <div style={{ display: 'flex', border: `1px solid ${theme.tooltip.borderColor}`, borderRadius: 6 }}>
                {(['hermite', 'spring', 'snap'] as const).map((kind) => {
                  const active = kind === yEngineLabel;

                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setYEngineLabel(kind)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        fontFamily: 'var(--mono, ui-monospace, monospace)',
                        color: active ? theme.tooltip.textColor : theme.axis.textColor,
                        background: active ? theme.crosshair.labelBackground : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {kind}
                    </button>
                  );
                })}
              </div>
            </div>
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.tooltip.textColor }}
            >
              Perf HUD <Toggle checked={perfHud} onChange={setPerfHud} />
            </span>
          </div>
        </div>

        <nav
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            padding: 4,
            background: theme.tooltip.background,
            border: `1px solid ${theme.tooltip.borderColor}`,
            borderRadius: 8,
          }}
        >
          {GROUPS.map((g) => {
            const active = g.id === group;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setGroup(g.id)}
                title={g.hint}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  fontFamily: 'var(--mono, ui-monospace, monospace)',
                  color: active ? theme.tooltip.textColor : theme.axis.textColor,
                  background: active ? theme.crosshair.labelBackground : 'transparent',
                  border: `1px solid ${active ? theme.tooltip.borderColor : 'transparent'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                {g.label}
              </button>
            );
          })}
        </nav>
      </header>

      <StressPanels panels={panels} theme={theme} perfHud={perfHud} yEngine={yEngine} yEngineLabel={yEngineLabel} />
    </div>
  );
}
