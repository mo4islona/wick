import { FIRA, FIRA_URL, autoGradient, createTheme } from '../create';

export const dracula = createTheme({
  name: 'Dracula',
  description: 'Classic dark with vibrant highlights',
  background: '#282a36',
  grid: {
    color: 'rgba(108,113,140,0.3)',
  },
  candlestick: {
    up: { body: autoGradient('#50fa7b'), wick: '#50fa7b' },
    down: { body: autoGradient('#ff5555'), wick: '#ff5555' },
  },
  line: { color: '#bd93f9' },
  seriesColors: [
    '#bd93f9',
    '#8be9fd',
    '#50fa7b',
    '#ff79c6',
    '#ffb86c',
    '#f1fa8c',
    '#ff5555',
    '#6272a4',
    '#ff5555',
    '#ff79c6',
  ],
  bands: { upper: '#8be9fd', lower: '#ff79c6' },
  crosshair: { color: 'rgba(98,114,164,0.7)', labelBackground: '#44475a' },
  axis: { textColor: '#a0b0d0' },
  tooltip: { background: 'rgba(40,42,54,0.92)', textColor: '#f8f8f2', borderColor: 'rgba(68,71,90,0.6)' },
  typography: { fontFamily: FIRA },
  fontUrl: FIRA_URL,
});
