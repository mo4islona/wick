import { memo, useEffect, useState } from 'react';

import type { ThemePreset } from '@wick-charts/react';

import { useIsMobile } from '../hooks/useIsMobile';
import { themes } from '../themes';
import { hexToRgba } from '../utils';
import { ThemeDots, ThemeList } from './ThemeList';

const allNames = Object.keys(themes);
const darkThemes = allNames.filter((n) => themes[n].dark);
const lightThemes = allNames.filter((n) => !themes[n].dark);

type Props = {
  value: ThemePreset;
  onChange: (preset: ThemePreset) => void;
};

export const ThemeSelect = memo(
  function ThemeSelect({ value, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const mobile = useIsMobile();

    const baseName = value.name;
    const theme = value.theme;
    // Custom = the active theme isn't the base preset's theme. App constructs
    // `value` for the custom case by spreading the base preset and swapping
    // `theme`, so `value.name` keeps pointing at the base.
    const isCustom = theme !== themes[baseName]?.theme;

    // Keyboard shortcut: ] next theme, [ prev theme
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
          e.preventDefault();
          const idx = allNames.indexOf(baseName);
          const next =
            e.code === 'BracketRight' ? (idx + 1) % allNames.length : (idx - 1 + allNames.length) % allNames.length;
          onChange(themes[allNames[next]]);
        }
      };
      window.addEventListener('keydown', handler);

      return () => window.removeEventListener('keydown', handler);
    }, [baseName, onChange]);

    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(!open)}
          type="button"
          aria-label={`Theme: ${baseName}`}
          aria-expanded={open}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: hexToRgba(theme.crosshair.labelBackground, 0.45),
            color: theme.tooltip.textColor,
            border: `1px solid ${hexToRgba(theme.tooltip.borderColor, 0.5)}`,
            borderRadius: 6,
            height: 36,
            padding: '0 16px',
            fontSize: theme.typography.fontSize,
            fontFamily: 'inherit',
            fontWeight: 500,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <ThemeDots t={isCustom ? theme : themes[baseName].theme} />
          {!mobile &&
            (isCustom ? (
              <span>
                Custom <span style={{ opacity: 0.5, fontWeight: 400 }}>from {baseName}</span>
              </span>
            ) : (
              baseName
            ))}
          <span style={{ opacity: 0.4, fontSize: theme.axis.fontSize, marginLeft: mobile ? 0 : 2 }}>▾</span>
        </button>

        {open && (
          <>
            {mobile && (
              <style>{`@keyframes theme-menu-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
            )}
            <button
              type="button"
              aria-label="Close theme menu"
              onClick={() => setOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: mobile ? 200 : 99,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background: mobile ? 'rgba(0,0,0,0.6)' : 'transparent',
                backdropFilter: mobile ? 'blur(2px)' : undefined,
                WebkitBackdropFilter: mobile ? 'blur(2px)' : undefined,
              }}
            />
            <div
              style={{
                background: theme.tooltip.background,
                backdropFilter: mobile ? undefined : 'blur(16px)',
                WebkitBackdropFilter: mobile ? undefined : 'blur(16px)',
                border: mobile ? 'none' : `1px solid ${theme.tooltip.borderColor}`,
                borderLeft: mobile ? `1px solid ${theme.tooltip.borderColor}` : undefined,
                borderRadius: mobile ? 0 : 8,
                boxShadow: mobile ? 'none' : '0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
                zIndex: mobile ? 201 : 100,
                display: 'flex',
                flexDirection: 'column',
                minWidth: mobile ? undefined : 520,
                overflow: 'hidden',
                ...(mobile
                  ? {
                      position: 'fixed' as const,
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 'min(360px, 90vw)',
                      animation: 'theme-menu-slide-in 180ms ease-out',
                    }
                  : {
                      position: 'absolute' as const,
                      top: '100%',
                      right: 0,
                      marginTop: 4,
                      maxHeight: 'calc(100vh - 80px)',
                    }),
              }}
            >
              {mobile && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderBottom: `1px solid ${theme.tooltip.borderColor}`,
                    background: theme.tooltip.background,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: theme.typography.fontSize + 1,
                      fontWeight: 600,
                      color: theme.tooltip.textColor,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Theme
                  </span>
                  <button
                    type="button"
                    aria-label="Close theme menu"
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      color: theme.crosshair.labelTextColor,
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: 16,
                  display: 'flex',
                  flexDirection: mobile ? 'column' : 'row',
                  gap: mobile ? 16 : 32,
                }}
              >
                <ThemeList
                  label="Light"
                  names={lightThemes}
                  value={isCustom ? null : baseName}
                  onChange={(v) => {
                    onChange(themes[v]);
                    setOpen(false);
                  }}
                  theme={theme}
                />
                <ThemeList
                  label="Dark"
                  names={darkThemes}
                  value={isCustom ? null : baseName}
                  onChange={(v) => {
                    onChange(themes[v]);
                    setOpen(false);
                  }}
                  theme={theme}
                />
              </div>
              <div
                style={{
                  padding: '8px 16px',
                  borderTop: `1px solid ${theme.tooltip.borderColor}`,
                  fontSize: theme.axis.fontSize,
                  color: theme.crosshair.labelTextColor,
                  opacity: 0.5,
                  textAlign: 'center',
                  flexShrink: 0,
                  background: theme.tooltip.background,
                }}
              >
                Press
                <kbd
                  style={{
                    display: 'inline-block',
                    margin: '0 0 0 4px',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${theme.tooltip.borderColor}`,
                    borderBottomWidth: 2,
                    background: hexToRgba(theme.crosshair.labelBackground, 0.5),
                    boxShadow: `inset 0 1px 0 ${hexToRgba(theme.crosshair.labelBackground, 0.9)}, 0 1px 0 ${theme.tooltip.borderColor}`,
                  }}
                >
                  [
                </kbd>
                <kbd
                  style={{
                    display: 'inline-block',
                    margin: '0 4px 0 3px',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${theme.tooltip.borderColor}`,
                    borderBottomWidth: 2,
                    background: hexToRgba(theme.crosshair.labelBackground, 0.5),
                    boxShadow: `inset 0 1px 0 ${hexToRgba(theme.crosshair.labelBackground, 0.9)}, 0 1px 0 ${theme.tooltip.borderColor}`,
                  }}
                >
                  ]
                </kbd>
                to switch themes
              </div>
            </div>
          </>
        )}
      </div>
    );
  },
  // Explicit comparator: equivalent to default shallow-compare for our two props,
  // but in dev with StrictMode the default `memo` still forces re-invocations to
  // test purity. The explicit form actually bails out — confirmed empirically.
  (prev, next) => prev.value === next.value && prev.onChange === next.onChange,
);
