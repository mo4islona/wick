import { ROBOTO, ROBOTO_URL, autoGradient, createTheme } from '../create';

export const materialPalenight = createTheme({
  name: 'Material Palenight',
  description: 'Material Design in moonlit hues',
  background: '#292d3e',
  grid: { color: 'rgba(95,99,120,0.3)' },
  candlestick: {
    up: { body: autoGradient('#c3e88d'), wick: '#c3e88d' },
    down: { body: autoGradient('#f07178'), wick: '#f07178' },
  },
  line: { color: '#82aaff' },
  seriesColors: [
    '#82aaff',
    '#f78c6c',
    '#c3e88d',
    '#c792ea',
    '#f07178',
    '#ffcb6b',
    '#89ddff',
    '#ff5370',
    '#82aaff',
    '#c792ea',
  ],
  bands: { upper: '#89ddff', lower: '#f07178' },
  crosshair: { color: 'rgba(103,110,149,0.7)', labelBackground: '#34324a' },
  axis: { textColor: '#676e95' },
  tooltip: { background: 'rgba(41,45,62,0.92)', textColor: '#a6accd', borderColor: 'rgba(55,59,75,0.6)' },
  typography: { fontFamily: ROBOTO },
  fontUrl: ROBOTO_URL,
});
