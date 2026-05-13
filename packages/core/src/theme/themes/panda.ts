import { FIRA, FIRA_URL, autoGradient, createTheme } from '../create';

export const panda = createTheme({
  name: 'Panda',
  description: 'Playful neons on charcoal',
  background: '#292a2b',
  grid: { color: 'rgba(98,98,100,0.3)' },
  candlestick: {
    up: { body: autoGradient('#19f9d8'), wick: '#19f9d8' },
    down: { body: autoGradient('#ff75b5'), wick: '#ff75b5' },
  },
  line: { color: '#6fc1ff' },
  seriesColors: [
    '#6fc1ff',
    '#ffb86c',
    '#19f9d8',
    '#b084eb',
    '#ff75b5',
    '#ffcc95',
    '#19f9d8',
    '#ff4b82',
    '#45a9f9',
    '#b084eb',
  ],
  bands: { upper: '#45a9f9', lower: '#ff75b5' },
  crosshair: { color: 'rgba(117,117,117,0.7)', labelBackground: '#3a3a3c' },
  axis: { textColor: '#757575' },
  tooltip: { background: 'rgba(41,42,43,0.92)', textColor: '#e6e6e6', borderColor: 'rgba(58,58,60,0.6)' },
  typography: { fontFamily: FIRA },
  fontUrl: FIRA_URL,
});
