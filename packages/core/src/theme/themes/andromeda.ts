import { ROBOTO, ROBOTO_URL, autoGradient, createTheme } from '../create';

export const andromeda = createTheme({
  name: 'Andromeda',
  description: 'Deep space purples and cosmic blues',
  background: '#23262e',
  grid: { color: 'rgba(90,88,100,0.3)' },
  candlestick: {
    up: { body: autoGradient('#96e072'), wick: '#96e072' },
    down: { body: autoGradient('#ee5d43'), wick: '#ee5d43' },
  },
  line: { color: '#00e8c6' },
  seriesColors: [
    '#00e8c6',
    '#f39c12',
    '#96e072',
    '#c74ded',
    '#ee5d43',
    '#ffe66d',
    '#00e8c6',
    '#ee5d43',
    '#7cb7ff',
    '#c74ded',
  ],
  bands: { upper: '#7cb7ff', lower: '#c74ded' },
  crosshair: { color: 'rgba(102,94,110,0.7)', labelBackground: '#2e3038' },
  axis: { textColor: '#665e6e' },
  tooltip: { background: 'rgba(35,38,46,0.92)', textColor: '#d5ced9', borderColor: 'rgba(50,48,56,0.6)' },
  typography: { fontFamily: ROBOTO },
  fontUrl: ROBOTO_URL,
});
