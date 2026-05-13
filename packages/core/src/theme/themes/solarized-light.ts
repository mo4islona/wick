import { MONO, MONO_URL, autoGradient, createTheme } from '../create';

export const solarizedLight = createTheme({
  name: 'Solarized Light',
  description: "Ethan Schoonover's precision palette",
  background: '#fdf6e3',
  chartGradient: ['#fef8e8', '#fdf6e3'],
  grid: { color: 'rgba(200,193,170,0.4)' },
  candlestick: {
    up: { body: autoGradient('#859900'), wick: '#859900' },
    down: { body: autoGradient('#dc322f'), wick: '#dc322f' },
  },
  line: { color: '#268bd2' },
  seriesColors: [
    '#268bd2',
    '#cb4b16',
    '#859900',
    '#6c71c4',
    '#dc322f',
    '#b58900',
    '#2aa198',
    '#d33682',
    '#268bd2',
    '#6c71c4',
  ],
  bands: { upper: '#2aa198', lower: '#d33682' },
  crosshair: { color: 'rgba(80,100,100,0.55)', labelBackground: '#eee8d5' },
  axis: { textColor: '#93a1a1' },
  tooltip: { background: 'rgba(253,246,227,0.95)', textColor: '#586e75', borderColor: 'rgba(238,232,213,0.6)' },
  typography: { fontFamily: MONO },
  fontUrl: MONO_URL,
});
