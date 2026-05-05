import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useState } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import { hexToRgba } from '../utils';

export interface SplitterProps {
  theme: ChartTheme;
  /**
   * `'vertical'` (default) — col-resize handle between left/right panes
   * (the visible pill is vertical). `'horizontal'` — row-resize handle
   * between stacked panes (the visible pill is horizontal).
   */
  orientation?: 'vertical' | 'horizontal';
  /** Pointer-down callback — use for full pointer-event semantics (capture, etc.). */
  onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  /** Mouse-down callback — useful when consuming hooks that expose only `onMouseDown`. */
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  /**
   * Accessible label describing what the handle resizes (e.g. "Resize chart
   * panel"). Surfaces in screen readers; defaults to a generic "Resize panel".
   */
  ariaLabel?: string;
  /** Pill length along the resize axis. Default 48. */
  thumbLength?: number;
  /** Pill thickness across the resize axis. Default 2. */
  thumbThickness?: number;
}

/**
 * Shared resize-handle splitter. Used by `AdvancedLayout`, `Playground`, and
 * `ThemePage` for the chart/panel divider, and by `Playground` again as a
 * row-resize handle between settings and the code editor.
 *
 * Theme-aware (reads `theme.tooltip.textColor` for the pill colour). Inline
 * styles only — no CSS dependency, so callers don't need a `.wick-playground`
 * ancestor for it to render correctly.
 */
export function Splitter({
  theme,
  orientation = 'vertical',
  onPointerDown,
  onMouseDown,
  ariaLabel = 'Resize panel',
  thumbLength = 48,
  thumbThickness = 2,
}: SplitterProps) {
  const [hover, setHover] = useState(false);
  const accent = hexToRgba(theme.tooltip.textColor, hover ? 0.55 : 0.25);
  const isVertical = orientation === 'vertical';

  return (
    <button
      // Plain semantic <button> keeps screen-reader identification + focus
      // for free, matching the playground's pre-extraction handle. The
      // actual resize stays pointer-driven; activation is meaningless here
      // but `aria-label` plus the button role still beats a bare div on
      // accessibility audits. Default browser button chrome is reset
      // inline so the visible pill is the only thing the user sees.
      type="button"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        ...(isVertical ? { width: 10 } : { height: 10, width: '100%' }),
        cursor: isVertical ? 'col-resize' : 'row-resize',
        flexShrink: 0,
        userSelect: 'none',
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 0,
        padding: 0,
        margin: 0,
      }}
    >
      <div
        style={{
          ...(isVertical
            ? { width: thumbThickness, height: thumbLength }
            : { width: thumbLength, height: thumbThickness }),
          borderRadius: 2,
          background: accent,
          transition: 'background 0.15s ease',
        }}
      />
    </button>
  );
}
