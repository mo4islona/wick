export function darken(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function hexToRgba(color: string, alpha: number): string {
  if (color.startsWith('rgba')) return color;
  if (!color.startsWith('#')) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Per-theme font-size override for docs UI surfaces only (sidebar, markdown,
 * ApiTable, etc.). Charts read `theme.typography.fontSize` directly and stay
 * at whatever the theme set — this helper only affects the documentation
 * chrome.
 *
 * Caveat (Handwritten theme) has thin strokes that read ~30 % smaller
 * perceptually than monospace at the same px size. The theme keeps Caveat
 * at 15 px so chart-internal Title/InfoBar don't look oversized; the docs
 * bump it for legibility. Detected by font-family rather than theme name
 * because `ChartTheme` carries no name field.
 */
export function docFontSize(theme: { typography: { fontSize: number; fontFamily: string } }): number {
  if (theme.typography.fontFamily.includes('Caveat')) return theme.typography.fontSize + 4;

  return theme.typography.fontSize;
}
