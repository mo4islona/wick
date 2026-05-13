import { resolveCandlestickBodyColor } from './resolve';
import type { ChartTheme } from './types';

export interface ThemePreset {
  name: string;
  description?: string;
  fontUrl: string | null;
  theme: ChartTheme;
  dark: boolean;
  /** Optional CSS background-image for the page */
  backgroundImage?: string;
  backgroundSize?: string;
}

/**
 * Input config for {@link createTheme}. Mirrors the structure of {@link ChartTheme}
 * but everything is optional except `background`. Missing values are derived automatically.
 */
export interface ThemeConfig {
  name?: string;
  description?: string;
  background: string;
  chartGradient?: [string, string];
  typography?: Partial<ChartTheme['typography']>;
  grid?: Partial<ChartTheme['grid']>;
  candlestick?: {
    up?: Partial<ChartTheme['candlestick']['up']>;
    down?: Partial<ChartTheme['candlestick']['down']>;
  };
  line?: Partial<ChartTheme['line']>;
  seriesColors?: string[];
  bands?: Partial<ChartTheme['bands']>;
  crosshair?: Partial<ChartTheme['crosshair']>;
  axis?: Partial<ChartTheme['axis']>;
  yLabel?: Partial<ChartTheme['yLabel']>;
  tooltip?: Partial<ChartTheme['tooltip']>;
  navigator?: {
    height?: number;
    background?: string;
    borderColor?: string;
    line?: Partial<ChartTheme['navigator']['line']>;
    candlestick?: {
      up?: Partial<ChartTheme['navigator']['candlestick']['up']>;
      down?: Partial<ChartTheme['navigator']['candlestick']['down']>;
    };
    window?: Partial<ChartTheme['navigator']['window']>;
    handle?: Partial<ChartTheme['navigator']['handle']>;
    mask?: Partial<ChartTheme['navigator']['mask']>;
  };
  /** URL to load the font (e.g. Google Fonts). */
  fontUrl?: string | null;
}

/**
 * `true` when the given `#rrggbb` background reads as dark — Rec. 601 luma
 * below the half-byte threshold (`< 128`). Used internally by
 * {@link createTheme} to flip default palette/contrast picks, and exported
 * for callers (docs UI chrome, host apps) that want to branch on theme
 * polarity without carrying their own copy of the heuristic.
 *
 * Falls through (`false`) for non-hex inputs (e.g. `transparent`,
 * `rgba(...)`, gradients) — the built-in presets all use plain hex on the
 * top-level `background`, so this is fine for the vast majority of cases.
 */
export function isDarkBg(bg: string): boolean {
  if (!bg.startsWith('#') || bg.length < 7) return false;
  return (
    parseInt(bg.slice(1, 3), 16) * 0.299 + parseInt(bg.slice(3, 5), 16) * 0.587 + parseInt(bg.slice(5, 7), 16) * 0.114 <
    128
  );
}

/**
 * Build a complete {@link ThemePreset} from a partial config.
 * Only `background` is required — everything else is derived from it.
 */
export function createTheme(config: ThemeConfig): ThemePreset {
  const { background: bg, name = 'Custom', description, fontUrl = null } = config;
  const dark = isDarkBg(bg);

  // Default palette based on dark/light
  const defFg = dark ? '#d1d4dc' : '#24292f';
  const defDim = dark ? '#787b86' : '#8b949e';
  const defUp = dark ? '#26a69a' : '#2da44e';
  const defDown = dark ? '#ef5350' : '#cf222e';
  const defLine = dark ? '#2962ff' : '#0969da';
  const defGrid = dark ? 'rgba(42,46,57,0.6)' : 'rgba(200,200,200,0.5)';
  const defCrosshair = dark ? 'rgba(150,150,150,0.5)' : 'rgba(170,170,170,0.3)';
  const defCrosshairBg = dark ? lightenHex(bg, 0.1) : darkenHex(bg, 0.05);
  const defTooltipBg = dark ? hexToRgba(bg, 0.92) : hexToRgba(bg, 0.95);
  const defTooltipBorder = dark ? hexToRgba(lightenHex(bg, 0.15), 0.6) : 'rgba(200,200,200,0.5)';
  const defFont = GEIST;

  const upBody = config.candlestick?.up?.body ?? defUp;
  const downBody = config.candlestick?.down?.body ?? defDown;
  // For scalar fallbacks (yLabel backgrounds, bands, wick default), flatten a
  // gradient tuple to its top stop.
  const upBase = resolveCandlestickBodyColor(upBody);
  const downBase = resolveCandlestickBodyColor(downBody);
  const lineColor = config.line?.color ?? defLine;
  const fg = config.tooltip?.textColor ?? defFg;
  const dim = config.axis?.textColor ?? defDim;
  const font = config.typography?.fontFamily ?? defFont;
  const baseFontSize = config.typography?.fontSize ?? 12;

  const chartGradient: [string, string] =
    config.chartGradient ?? (dark ? [lightenHex(bg, 0.04), darkenHex(bg, 0.06)] : [lightenHex(bg, 0.06), bg]);

  const theme: ChartTheme = {
    background: bg,
    chartGradient,
    typography: {
      fontFamily: font,
      fontSize: baseFontSize,
    },
    grid: {
      color: config.grid?.color ?? defGrid,
      style: config.grid?.style ?? 'solid',
    },
    candlestick: {
      up: {
        body: upBody,
        wick: config.candlestick?.up?.wick ?? upBase,
      },
      down: {
        body: downBody,
        wick: config.candlestick?.down?.wick ?? downBase,
      },
    },
    line: {
      color: lineColor,
      width: config.line?.width ?? 1,
      areaTopColor: config.line?.areaTopColor ?? hexToRgba(lineColor, 0.08),
      areaBottomColor: config.line?.areaBottomColor ?? hexToRgba(lineColor, 0.01),
    },
    seriesColors: config.seriesColors ?? [lineColor, defUp, defDown],
    bands: {
      upper: config.bands?.upper ?? lineColor,
      lower: config.bands?.lower ?? downBase,
    },
    crosshair: {
      color: config.crosshair?.color ?? defCrosshair,
      labelBackground: config.crosshair?.labelBackground ?? defCrosshairBg,
      labelTextColor: config.crosshair?.labelTextColor ?? fg,
    },
    axis: {
      fontSize: config.axis?.fontSize ?? 10,
      textColor: dim,
      // Shallow-copy the override so later caller mutations don't leak into the theme.
      ...(config.axis?.x ? { x: { ...config.axis.x } } : {}),
      ...(config.axis?.y ? { y: { ...config.axis.y } } : {}),
    },
    yLabel: {
      fontSize: config.yLabel?.fontSize ?? 11,
      upBackground: config.yLabel?.upBackground ?? upBase,
      downBackground: config.yLabel?.downBackground ?? downBase,
      neutralBackground: config.yLabel?.neutralBackground ?? defCrosshairBg,
      textColor: config.yLabel?.textColor ?? '#ffffff',
    },
    tooltip: {
      fontSize: config.tooltip?.fontSize ?? baseFontSize,
      background: config.tooltip?.background ?? defTooltipBg,
      textColor: fg,
      borderColor: config.tooltip?.borderColor ?? defTooltipBorder,
    },
    navigator: resolveNavigatorTheme({
      dark,
      bg,
      chartGradient,
      neutralFg: dim,
      upBody,
      downBody,
      upBase,
      downBase,
      config: config.navigator,
    }),
  };

  return { name, description, fontUrl, dark, theme };
}

/**
 * Build the `navigator` slice of a theme from whatever overrides the caller
 * supplied, filling gaps from already-resolved chart colors (line, candlestick,
 * crosshair). Keeps navigator visually coherent with the main plot by default
 * while still allowing full override.
 */
function resolveNavigatorTheme(input: {
  dark: boolean;
  bg: string;
  chartGradient: [string, string];
  /** Axis/dim foreground — used as the navigator's default neutral so its
   *  miniature line doesn't compete with theme-accent series colors. */
  neutralFg: string;
  upBody: string | [string, string];
  downBody: string | [string, string];
  upBase: string;
  downBase: string;
  config: ThemeConfig['navigator'];
}): ChartTheme['navigator'] {
  const { dark, bg, neutralFg, upBody, downBody, upBase, downBase, config } = input;

  // Strip is transparent by default — the sparkline paints over the page bg,
  // and the mask wash hides it everywhere except inside the window. That gives
  // a "spotlight" reading where the visible window is the only bright zone.
  const stripBg = config?.background ?? 'transparent';

  // Handles still use neutral chrome derived from the page bg.
  const chromeBase = dark ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
  const handleColor = config?.handle?.color ?? hexToRgbaLoose(chromeBase, 0.3);

  // Mask uses the page bg color at high alpha — outside the window the
  // sparkline gets washed out so the visible window pops by absence of mask.
  const maskFill = config?.mask?.fill ?? hexToRgbaLoose(bg, dark ? 0.78 : 0.82);

  return {
    height: config?.height ?? 48,
    background: stripBg,
    borderColor: config?.borderColor ?? hexToRgbaLoose(neutralFg, dark ? 0.18 : 0.22),
    line: {
      color: config?.line?.color ?? neutralFg,
      width: config?.line?.width ?? 1,
      areaTopColor: config?.line?.areaTopColor ?? hexToRgbaLoose(neutralFg, dark ? 0.22 : 0.18),
      areaBottomColor: config?.line?.areaBottomColor ?? hexToRgbaLoose(neutralFg, 0),
    },
    candlestick: {
      up: {
        body: config?.candlestick?.up?.body ?? upBody,
        wick: config?.candlestick?.up?.wick ?? upBase,
      },
      down: {
        body: config?.candlestick?.down?.body ?? downBody,
        wick: config?.candlestick?.down?.wick ?? downBase,
      },
    },
    // Window has no chrome — the unmasked region IS the window.
    window: {
      fill: config?.window?.fill ?? 'transparent',
      border: config?.window?.border ?? 'transparent',
      borderWidth: config?.window?.borderWidth ?? 0,
    },
    handle: {
      color: handleColor,
      width: config?.handle?.width ?? 6,
    },
    mask: {
      fill: maskFill,
    },
  };
}

/** Accepts `#rrggbb`, `rgb(...)`, or `rgba(...)` and applies the supplied
 *  alpha. Other color forms (named colors, oklch, etc.) pass through unchanged
 *  — callers shouldn't depend on alpha being applied in those rare cases. */
function hexToRgbaLoose(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) return hexToRgba(color, alpha);
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;

  return color;
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lightenHex(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) + 255 * amount));
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) + 255 * amount));
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) + 255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function darkenHex(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Tuple returned by {@link autoGradient}. The non-enumerable `source` property
 * carries the original canonical color so scalar-fallback consumers
 * (yLabel backgrounds, bands, default wick, volume tint) can recover it via
 * {@link resolveCandlestickBodyColor} instead of picking the lightened top
 * stop. `JSON.stringify` drops the marker, which is fine because
 * `themeToJson` serializes all dependent scalar fields explicitly.
 */
export type AutoGradientTuple = [string, string] & { readonly source?: string };

/**
 * Build a 2-stop candle-body gradient around a single hex color — a lightened
 * top stop and a darkened bottom stop. Presets use this to get a subtle
 * vertical lift without hand-picking both ends.
 *
 *     candlestick: { up: { body: autoGradient('#089981'), wick: '#089981' } }
 *
 * The input must be `#rrggbb`; other CSS color forms are returned as a flat
 * `[color, color]` tuple because the lighten/darken math requires hex.
 *
 * The returned tuple carries the source color on a non-enumerable `source`
 * property so {@link resolveCandlestickBodyColor} can recover it for scalar
 * fallbacks (yLabel backgrounds, bands, volume tint) instead of picking the
 * lightened top stop.
 */
export function autoGradient(color: string): AutoGradientTuple {
  const isHex = color.startsWith('#') && color.length === 7;
  const tuple: [string, string] = isHex ? [lightenHex(color, 0.2), darkenHex(color, 0.15)] : [color, color];
  Object.defineProperty(tuple, 'source', { value: color, enumerable: false });

  return tuple as AutoGradientTuple;
}

// Common font stacks
export const MONO = "'JetBrains Mono', 'Fira Code', monospace";
export const MONO_URL = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap';
export const GEIST = "'Outfit', -apple-system, BlinkMacSystemFont, sans-serif";
export const GEIST_URL = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap';
export const ROBOTO = "'Roboto Mono', monospace";
export const ROBOTO_URL = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600&display=swap';
export const IBM = "'IBM Plex Mono', monospace";
export const IBM_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap';
export const FIRA = "'Fira Code', monospace";
export const FIRA_URL = 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&display=swap';
export const SOURCE_CODE = "'Source Code Pro', monospace";
export const SOURCE_CODE_URL = 'https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600&display=swap';
export const SPACE_MONO = "'Space Mono', monospace";
export const SPACE_MONO_URL = 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap';
export const JAKARTA = "'Plus Jakarta Sans', sans-serif";
export const JAKARTA_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
export const CAVEAT = "'Caveat', 'Comic Sans MS', cursive";
export const CAVEAT_URL = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap';
