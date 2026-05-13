import { GEIST, GEIST_URL, autoGradient, createTheme } from '../create';

export const lightPink = createTheme({
  name: 'Love',
  description: 'Soft romantic pinks and roses',
  background: '#fef7f8',
  chartGradient: ['#fffafb', '#fef7f8'],
  grid: { color: 'rgba(200,160,175,0.25)', style: 'dotted' },
  candlestick: {
    up: { body: autoGradient('#6a9a6e'), wick: '#6a9a6e' },
    down: { body: autoGradient('#c45070'), wick: '#c45070' },
  },
  line: { color: '#a05080' },
  seriesColors: [
    '#a05080',
    '#d08850',
    '#6a9a6e',
    '#7868a8',
    '#c45070',
    '#c89040',
    '#508890',
    '#c45070',
    '#a05080',
    '#7868a8',
  ],
  bands: { upper: '#508890', lower: '#c45070' },
  crosshair: { color: 'rgba(120,70,90,0.5)', labelBackground: '#f0dce2' },
  axis: { textColor: '#b08898' },
  tooltip: { background: 'rgba(253,242,244,0.95)', textColor: '#4a3040', borderColor: 'rgba(200,160,175,0.25)' },
  typography: { fontFamily: GEIST },
  fontUrl: GEIST_URL,
});
