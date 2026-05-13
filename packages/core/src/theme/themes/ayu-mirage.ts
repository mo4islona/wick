import { GEIST, GEIST_URL, autoGradient, createTheme } from '../create';

export const ayuMirage = createTheme({
  name: 'Ayu Mirage',
  description: 'Warm dark with amber accents',
  background: '#1f2430',
  grid: { color: 'rgba(82,90,108,0.3)' },
  candlestick: {
    up: { body: autoGradient('#bae67e'), wick: '#bae67e' },
    down: { body: autoGradient('#f27983'), wick: '#f27983' },
  },
  line: { color: '#73d0ff' },
  seriesColors: [
    '#73d0ff',
    '#ffad66',
    '#bae67e',
    '#d4bfff',
    '#f27983',
    '#ffd580',
    '#95e6cb',
    '#f28779',
    '#5ccfe6',
    '#d4bfff',
  ],
  bands: { upper: '#5ccfe6', lower: '#f28779' },
  crosshair: { color: 'rgba(92,103,115,0.7)', labelBackground: '#2a3040' },
  axis: { textColor: '#5c6773' },
  tooltip: { background: 'rgba(31,36,48,0.92)', textColor: '#cbccc6', borderColor: 'rgba(42,48,60,0.6)' },
  typography: { fontFamily: GEIST },
  fontUrl: GEIST_URL,
});
