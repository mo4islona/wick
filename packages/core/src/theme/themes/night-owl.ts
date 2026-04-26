import { MONO, MONO_URL, autoGradient, createTheme } from '../create';

export const nightOwl = createTheme({
  name: 'Night Owl',
  description: 'Crafted for late-night coding',
  background: '#011627',
  grid: { color: 'rgba(31,52,72,0.8)' },
  candlestick: {
    up: { body: autoGradient('#7ec699'), wick: '#7ec699' },
    down: { body: autoGradient('#e06c75'), wick: '#e06c75' },
  },
  line: { color: '#82aaff' },
  seriesColors: [
    '#82aaff',
    '#d49a6a',
    '#7ec699',
    '#b48ead',
    '#e06c75',
    '#d4b568',
    '#5fb3a1',
    '#d47084',
    '#6bc5e0',
    '#b48ead',
  ],
  bands: { upper: '#6bc5e0', lower: '#d47084' },
  crosshair: { color: 'rgba(99,119,119,0.4)', labelBackground: '#1d3b53' },
  // Hue nudged from cyan (`#495a5a`) toward navy so the muted text shares
  // the page bg's blue family instead of reading as a separate teal-grey.
  axis: { textColor: '#4d5a6c' },
  tooltip: { background: 'rgba(1,22,39,0.92)', textColor: '#d6deeb', borderColor: 'rgba(31,52,72,0.6)' },
  typography: { fontFamily: MONO },
  fontUrl: MONO_URL,
});
