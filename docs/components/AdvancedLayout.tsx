import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import { type ChartTheme, isDarkBg } from '@wick-charts/react';

import { useIsMobile } from '../hooks/useIsMobile';
import { hexToRgba } from '../utils';
import { Cell } from './Cell';
import { HighlightedCode } from './playground/CodeView';
import { Splitter } from './Splitter';

export interface Step {
  heading: string;
  body: ReactNode;
  code?: string;
}

export interface AdvancedLayoutProps {
  theme: ChartTheme;
  /** Short paragraph above the chart explaining what the example demonstrates. */
  lead: ReactNode;
  /** The live chart. Wrapped in a {@link Cell} for the bordered surface. */
  chart: ReactNode;
  /** Walk-through entries rendered in the right rail (or below the chart on mobile). */
  steps: Step[];
  /**
   * Full source text of the example page (typically imported with Vite's
   * `?raw` query). When provided, a `Walkthrough / Source` tab strip appears
   * in the right rail and the user can swap to the full file in one click.
   */
  source?: string;
  /**
   * When `false`, skip the bordered {@link Cell} around the chart slot.
   * Use for examples that wrap each chart in its own framed card (e.g.
   * multi-chart-sync) where the outer border just doubles up. Default `true`.
   */
  framedChart?: boolean;
}

type RailMode = 'walkthrough' | 'source';

const DEFAULT_RAIL_WIDTH = 560;
const MIN_RAIL_WIDTH = 320;
/** Minimum chart width — the splitter clamps so the chart stays usable. */
const MIN_CHART_WIDTH = 360;
const STORAGE_KEY = 'advanced-rail-width';

function readStoredWidth(): number {
  // localStorage `getItem` can throw in privacy mode / sandboxed iframes /
  // blocked-storage contexts even when the global itself is defined.
  // Swallow and fall back to the default — losing the persisted width is
  // a much better outcome than crashing the whole page render.
  if (typeof localStorage === 'undefined') return DEFAULT_RAIL_WIDTH;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RAIL_WIDTH;
    const parsed = Number.parseInt(raw, 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RAIL_WIDTH;
  } catch {
    return DEFAULT_RAIL_WIDTH;
  }
}

/**
 * Two-column shell for advanced docs examples: live chart on the left, narrative
 * walkthrough with inline code on the right. A vertical splitter lets the
 * reader resize the panels; the choice is persisted across visits.
 * Stacks to one column on mobile (no splitter).
 */
export function AdvancedLayout({ theme, lead, chart, steps, source, framedChart = true }: AdvancedLayoutProps) {
  const mobile = useIsMobile();
  const muted = hexToRgba(theme.tooltip.textColor, 0.7);
  // On dark themes the rail's textColor-based bg sits as a 4% white tint
  // over a dark page — visible enough. On light themes the same alpha is a
  // 4% black tint over white that reads as a heavier panel — drop to 2%
  // so the surface stays subtle.
  const railBgAlpha = isDarkBg(theme.background) ? 0.04 : 0.02;
  const [mode, setMode] = useState<RailMode>('walkthrough');
  const [railWidth, setRailWidth] = useState<number>(readStoredWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  const showSource = source !== undefined && mode === 'source';

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    // Same swallow as readStoredWidth — the persisted width is a nicety,
    // not load-bearing, so a write failure mustn't bubble up.
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(railWidth)));
    } catch {
      // ignore
    }
  }, [railWidth]);

  const onSplitterDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const startX = e.clientX;
    const startWidth = railWidth;
    const containerRight = container.getBoundingClientRect().right;
    const containerWidth = container.getBoundingClientRect().width;
    const maxRail = Math.max(MIN_RAIL_WIDTH, containerWidth - MIN_CHART_WIDTH);

    // Pointer capture so a fast-moving drag doesn't lose events when the
    // cursor leaves the 1px-wide handle. Uses the same element that fired
    // pointerdown — required by the Pointer Events spec.
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      // Right-rail width grows as cursor moves left.
      const next = Math.min(maxRail, Math.max(MIN_RAIL_WIDTH, containerRight - ev.clientX));
      setRailWidth(next);
      // Avoid the unused-but-needed binding warning while keeping startX/startWidth
      // useful for future "snap on shift-drag" extensions.
      void startX;
      void startWidth;
    };

    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: mobile ? 8 : '8px 16px 32px',
        color: theme.tooltip.textColor,
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: theme.typography.fontSize,
          color: muted,
          lineHeight: 1.5,
          maxWidth: 880,
        }}
      >
        {lead}
      </div>

      <div
        ref={containerRef}
        style={{
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          gap: mobile ? 16 : 0,
          flex: 1,
          minHeight: 0,
        }}
      >
        {framedChart ? (
          <Cell theme={theme} style={{ flex: 1, minWidth: 0, minHeight: mobile ? 320 : 0 }}>
            {chart}
          </Cell>
        ) : (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: mobile ? 320 : 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {chart}
          </div>
        )}

        {!mobile && <Splitter theme={theme} onPointerDown={onSplitterDown} />}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflow: 'hidden',
            minHeight: 0,
            width: mobile ? '100%' : railWidth,
            flexShrink: 0,
            // Bordered card around the rail — matches the chart's `<Cell>`
            // and the playground's `pg-right` panel so chart + walkthrough
            // sit on equally-weighted surfaces.
            border: `1px solid ${theme.tooltip.borderColor}`,
            borderRadius: 8,
            background: hexToRgba(theme.tooltip.textColor, railBgAlpha),
            padding: mobile ? 12 : 14,
          }}
        >
          {source !== undefined && <RailTabs mode={mode} onChange={setMode} theme={theme} muted={muted} />}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: showSource ? 0 : 18,
              overflow: 'auto',
              flex: 1,
              minHeight: 0,
              // Soft fade at top + bottom edges so clipped content reveals
              // a scroll affordance. Skipped in source-mode — the code
              // block already has its own framing and fading the syntax
              // highlight would just look like a rendering bug.
              ...(showSource
                ? {}
                : {
                    maskImage:
                      'linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
                    WebkitMaskImage:
                      'linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
                  }),
            }}
          >
            {showSource ? (
              <HighlightedCode code={source ?? ''} theme={theme} label="Full source" />
            ) : (
              steps.map((step, i) => <StepBlock key={`${i}-${step.heading}`} step={step} theme={theme} muted={muted} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RailTabs({
  mode,
  onChange,
  theme,
  muted,
}: {
  mode: RailMode;
  onChange: (next: RailMode) => void;
  theme: ChartTheme;
  muted: string;
}) {
  const border = hexToRgba(theme.tooltip.textColor, 0.18);
  const tabs: Array<{ id: RailMode; label: string }> = [
    { id: 'walkthrough', label: 'Walkthrough' },
    { id: 'source', label: 'Source' },
  ];

  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        gap: 0,
        alignSelf: 'flex-start',
        border: `1px solid ${border}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontSize: theme.typography.fontSize - 1,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === mode;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            style={{
              padding: '5px 12px',
              border: 'none',
              background: active ? hexToRgba(theme.tooltip.textColor, 0.08) : 'transparent',
              color: active ? theme.tooltip.textColor : muted,
              cursor: 'pointer',
              fontFamily: theme.typography.fontFamily,
              fontSize: 'inherit',
              fontWeight: active ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function StepBlock({ step, theme, muted }: { step: Step; theme: ChartTheme; muted: string }) {
  // Subtle card under heading + body. Vertical padding only — horizontal is
  // zero so the text sits flush with the code block's flush-padded lines (see
  // the inline <style> override at the rail root).
  const textCardStyle: CSSProperties = {
    // background: hexToRgba(theme.tooltip.textColor, 0.04),
    borderRadius: 8,
    padding: '10px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };

  const numberStyle: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: theme.typography.fontSize - 2,
    color: muted,
    letterSpacing: '0.04em',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={textCardStyle}>
        <div style={numberStyle}>{step.heading}</div>
        <div
          style={{
            fontSize: theme.typography.fontSize,
            lineHeight: 1.55,
            color: theme.tooltip.textColor,
            textAlign: 'justify',
            textJustify: 'inter-word',
            hyphens: 'auto',
          }}
        >
          {step.body}
        </div>
      </div>
      {step.code && <HighlightedCode code={step.code} theme={theme} style={{ padding: 0 }} />}
    </div>
  );
}
