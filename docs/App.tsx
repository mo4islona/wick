import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ChartTheme, ThemeProvider, createTheme } from '@wick-charts/react';

import { Sidebar } from './components/Sidebar';
import { ThemeSelect } from './components/ThemeSelect';
import { type JsonValue, normalizeThemeConfig, themeToJson } from './components/theme-editor/themeJson';
import { FrameworkProvider } from './context/framework';
import { useFrameworkState } from './hooks/useFramework';
import { useIsMobile } from './hooks/useIsMobile';
import { AdvancedRoutePage } from './pages/advanced';
import { ApiRoutePage } from './pages/api';
import { ChartRoutePage } from './pages/charts';
import { HookPage } from './pages/HookPage';
import { MigrationPage } from './pages/MigrationPage';
import { OverviewPage } from './pages/OverviewPage';
import { StressTestPage } from './pages/StressTestPage';
import { ThemePage } from './pages/ThemePage';
import { ROUTE_ALIASES, type Route, getTitle, hookKeyForRoute, isRoute } from './routes';
import { themes } from './themes';

interface RenderArgs {
  route: Route;
  theme: ChartTheme;
  baseTheme: ChartTheme;
  editorValue: JsonValue;
  onEditorChange: (next: JsonValue) => void;
}

function renderRoute({ route, theme, baseTheme, editorValue, onEditorChange }: RenderArgs) {
  if (route === 'overview') return <OverviewPage theme={theme} />;
  if (route === 'migration') return <MigrationPage theme={theme} />;
  if (route === 'customization/theme') {
    return <ThemePage theme={baseTheme} value={editorValue} onChange={onEditorChange} />;
  }
  if (route === 'stress-test') return <StressTestPage theme={theme} />;
  if (route.startsWith('charts/')) return <ChartRoutePage route={route} theme={theme} />;
  if (route.startsWith('advanced/')) return <AdvancedRoutePage route={route} theme={theme} />;
  if (route.startsWith('api/')) return <ApiRoutePage route={route} theme={theme} />;

  const hookKey = hookKeyForRoute(route);
  if (hookKey) return <HookPage hookKey={hookKey} theme={theme} />;

  return null;
}

// BT.601 luma — matches createTheme's isDarkBg but works on runtime hex colors.
function luminance(hex: string): number {
  if (!hex.startsWith('#') || hex.length < 7) return 0;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function readHash(): Route {
  const raw = window.location.hash.slice(1);
  // Strip leading slash so both `#overview` and `#/overview` work.
  const stripped = raw.replace(/^\//, '');
  // Migrate old single-key URLs (`#dashboard`, `#line`, …) → new path form.
  const aliased = ROUTE_ALIASES[stripped];
  if (aliased) {
    window.location.hash = aliased;

    return aliased;
  }
  if (isRoute(stripped)) return stripped;

  return 'overview';
}

function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(readHash);

  useEffect(() => {
    const handler = () => setRoute(readHash());
    window.addEventListener('hashchange', handler);

    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r;
  };

  return [route, navigate];
}

export default function App() {
  const [themeName, setThemeName] = useState(() => {
    const saved = localStorage.getItem('chart-theme');
    if (saved && themes[saved]) return saved;

    const prefersDark =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

    return prefersDark ? 'Catppuccin' : 'Quiet Light';
  });

  const [route, navigate] = useHashRoute();

  const mobile = useIsMobile();
  const [framework, setFramework] = useFrameworkState();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('chart-theme', themeName);
  }, [themeName]);

  const preset = themes[themeName];
  const baseTheme = preset.theme;

  // The editor's controlled JSON. `null` = no edits, show preset. Lives here
  // so edits persist across navigation (Dashboard → Theme → back) and across
  // browser restarts (via localStorage).
  const [editorJson, setEditorJson] = useState<JsonValue | null>(() => {
    try {
      const raw = localStorage.getItem('theme-editor-json');
      if (!raw) return null;

      return JSON.parse(raw) as JsonValue;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (editorJson === null) {
        localStorage.removeItem('theme-editor-json');
      } else {
        localStorage.setItem('theme-editor-json', JSON.stringify(editorJson));
      }
    } catch {
      // ignore quota / disabled storage
    }
  }, [editorJson]);

  const baseJson = useMemo<JsonValue>(() => themeToJson(baseTheme), [baseTheme]);
  const editorValue = editorJson ?? baseJson;

  // Derive the whole-page override from the edited JSON via createTheme.
  // `normalizeThemeConfig` coerces `background` / `line.color` to hex — the
  // editor accepts rgb/rgba/hsl/hsla, but createTheme's derivations
  // (isDarkBg, hexToRgba) assume `#RRGGBB`. Invalid JSON falls back to
  // `null` so previews don't crash.
  const override = useMemo<ChartTheme | null>(() => {
    if (!editorJson) return null;
    const cfg = normalizeThemeConfig(editorJson);
    if (!cfg) return null;
    try {
      return createTheme(cfg).theme;
    } catch {
      return null;
    }
  }, [editorJson]);

  const theme = override ?? baseTheme;
  const isCustom = editorJson !== null;
  const isDarkActive = useMemo(() => luminance(theme.background) < 0.5, [theme.background]);

  const pickTheme = useCallback(
    (name: string) => {
      setThemeName(name);
      setEditorJson(null);
    },
    [setThemeName, setEditorJson],
  );

  const onEditorChange = (next: JsonValue) => {
    // Clear the override when edits round-trip back to the preset baseline.
    setEditorJson(JSON.stringify(next) === JSON.stringify(baseJson) ? null : next);
  };

  // Load font + set root styles — tracks the ACTIVE theme so custom edits
  // propagate to document-level styling (body bg, root font, page glow).
  useEffect(() => {
    if (preset.fontUrl) {
      const id = `font-${themeName.replace(/\s/g, '-')}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = preset.fontUrl;
        document.head.appendChild(link);
      }
    }
    document.documentElement.style.fontSize = `${theme.typography.fontSize}px`;
    document.documentElement.style.fontFamily = theme.typography.fontFamily;
    document.body.style.backgroundColor = theme.background;
    const glow = isDarkActive ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)';
    document.body.style.setProperty('--page-glow', glow);
  }, [themeName, theme, preset.fontUrl, isDarkActive]);

  const pageTitle = getTitle(route);

  const bgImage = (() => {
    const major = isDarkActive ? 0.06 : 0.12;
    const minor = isDarkActive ? 0.03 : 0.06;
    return [
      preset.backgroundImage,
      `repeating-linear-gradient(0deg, transparent, transparent 129px, rgba(150,150,150,${major}) 129px, rgba(150,150,150,${major}) 130px)`,
      `repeating-linear-gradient(90deg, transparent, transparent 129px, rgba(150,150,150,${major}) 129px, rgba(150,150,150,${major}) 130px)`,
      `repeating-linear-gradient(0deg, transparent, transparent 25px, rgba(150,150,150,${minor}) 25px, rgba(150,150,150,${minor}) 26px)`,
      `repeating-linear-gradient(90deg, transparent, transparent 25px, rgba(150,150,150,${minor}) 25px, rgba(150,150,150,${minor}) 26px)`,
    ]
      .filter(Boolean)
      .join(', ');
  })();

  const fwCtx = { framework, setFramework };

  return (
    <ThemeProvider value={theme}>
      <FrameworkProvider value={fwCtx}>
        <div
          style={{
            width: '100%',
            height: '100vh',
            display: 'flex',
            backgroundColor: theme.background,
            backgroundImage: bgImage,
            fontFamily: theme.typography.fontFamily,
            color: theme.tooltip.textColor,
            transition: 'background 0.3s ease',
            overflow: 'hidden',
          }}
        >
          {/* Sidebar — hidden on mobile, shown on desktop */}
          {!mobile && <Sidebar route={route} onNavigate={navigate} theme={theme} />}

          {/* Mobile overlay sidebar */}
          {mobile && mobileMenuOpen && (
            <>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(2px)',
                  WebkitBackdropFilter: 'blur(2px)',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  zIndex: 200,
                }}
              />
              <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 201 }}>
                <Sidebar
                  route={route}
                  onNavigate={(r) => {
                    navigate(r);
                    setMobileMenuOpen(false);
                  }}
                  onClose={() => setMobileMenuOpen(false)}
                  theme={theme}
                  mobile
                />
              </div>
            </>
          )}

          {/* Main area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Header */}
            <div
              style={{
                padding: mobile ? '6px 10px' : '8px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Mobile hamburger */}
                {mobile && (
                  <button
                    type="button"
                    aria-label="Open navigation menu"
                    aria-expanded={mobileMenuOpen}
                    onClick={() => setMobileMenuOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: 6,
                      border: `1px solid ${theme.tooltip.borderColor}`,
                      background: 'transparent',
                      color: theme.tooltip.textColor,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <line x1="2" y1="4" x2="14" y2="4" />
                      <line x1="2" y1="8" x2="14" y2="8" />
                      <line x1="2" y1="12" x2="14" y2="12" />
                    </svg>
                  </button>
                )}
                {pageTitle && (
                  <h1
                    style={{
                      margin: 0,
                      fontSize: mobile ? theme.typography.fontSize + 2 : theme.typography.fontSize + 4,
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {pageTitle}
                  </h1>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 4 : 8 }}>
                {!mobile && (
                  <>
                    <a
                      href="https://github.com/mo4islona/wick-charts"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 38,
                        height: 38,
                        borderRadius: 6,
                        border: `1px solid ${theme.tooltip.borderColor}`,
                        background: 'transparent',
                        color: theme.tooltip.textColor,
                        opacity: 0.6,
                        transition: 'opacity 0.15s ease',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.6';
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                    </a>
                    <a
                      href="https://x.com/mo4islona"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 38,
                        height: 38,
                        borderRadius: 6,
                        border: `1px solid ${theme.tooltip.borderColor}`,
                        background: 'transparent',
                        color: theme.tooltip.textColor,
                        opacity: 0.6,
                        transition: 'opacity 0.15s ease',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.6';
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </a>
                  </>
                )}
                <ThemeSelect value={themeName} onChange={pickTheme} theme={theme} mobile={mobile} custom={isCustom} />
              </div>
            </div>

            {/* Page content */}
            <div style={{ flex: 1, minHeight: 0, padding: mobile ? 4 : 6, overflow: 'auto' }}>
              {renderRoute({
                route,
                theme,
                baseTheme,
                editorValue,
                onEditorChange,
              })}
            </div>
          </div>
        </div>
      </FrameworkProvider>
    </ThemeProvider>
  );
}
