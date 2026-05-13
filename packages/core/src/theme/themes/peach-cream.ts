import { JAKARTA, JAKARTA_URL, autoGradient, createTheme } from '../create';

export const peachCream = createTheme({
  name: 'Peach Cream',
  background: '#fef6f0',
  candlestick: {
    up: { body: autoGradient('#5a9a68'), wick: '#5a9a68' },
    down: { body: autoGradient('#d06848'), wick: '#d06848' },
  },
  line: { color: '#d07040' },
  seriesColors: [
    '#d07040',
    '#5a9a68',
    '#8a6aaa',
    '#c0884a',
    '#d06848',
    '#4a8a9a',
    '#9a7a4a',
    '#d06848',
    '#d07040',
    '#8a6aaa',
  ],
  bands: { upper: '#4a8a9a', lower: '#d06848' },
  grid: { color: 'rgba(180,140,120,0.12)' },
  axis: { textColor: '#b09080' },
  crosshair: { color: 'rgba(100,70,55,0.45)', labelBackground: '#f0e4d8' },
  tooltip: { background: 'rgba(254,246,240,0.95)', textColor: '#4a3028', borderColor: 'rgba(180,140,120,0.25)' },
  typography: { fontFamily: JAKARTA },
  fontUrl: JAKARTA_URL,
  chartGradient: ['#fff8f2', '#fef6f0'],
});
