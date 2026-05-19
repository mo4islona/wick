import { SPACE_MONO, SPACE_MONO_URL, autoGradient, createTheme } from '../create';

export const mintBreeze = createTheme({
  name: 'Mint Breeze',
  background: '#f6f5ee',
  candlestick: {
    up: { body: autoGradient('#2e9070'), wick: '#2e9070' },
    down: { body: autoGradient('#d04848'), wick: '#d04848' },
  },
  line: { color: '#2a8a80' },
  seriesColors: [
    '#2a8a80',
    '#d0884a',
    '#2e9070',
    '#7a68b0',
    '#d04848',
    '#a09040',
    '#3a7a9a',
    '#d04848',
    '#2a8a80',
    '#7a68b0',
  ],
  bands: { upper: '#3a7a9a', lower: '#d04848' },
  grid: { color: 'rgba(100,150,140,0.1)' },
  axis: { textColor: '#80a098' },
  crosshair: { color: 'rgba(55,80,70,0.45)', labelBackground: '#ece8de' },
  tooltip: { background: 'rgba(246,245,238,0.95)', textColor: '#2a3530', borderColor: 'rgba(130,140,115,0.2)' },
  typography: { fontFamily: SPACE_MONO },
  fontUrl: SPACE_MONO_URL,
  chartGradient: ['#f8f7f0', '#f6f5ee'],
});
