import { FIRA, FIRA_URL, autoGradient, createTheme } from '../create';

export const monokaiPro = createTheme({
  name: 'Monokai Pro',
  description: 'Bold syntax colors on dark gray',
  background: '#2d2a2e',
  grid: { color: 'rgba(104,100,102,0.3)' },
  candlestick: {
    up: { body: autoGradient('#8ab862'), wick: '#8ab862' },
    down: { body: autoGradient('#d05470'), wick: '#d05470' },
  },
  line: { color: '#62b8c8' },
  seriesColors: [
    '#62b8c8',
    '#d08050',
    '#8ab862',
    '#9080c8',
    '#d05470',
    '#d0b850',
    '#62b8c8',
    '#d05470',
    '#8ab862',
    '#9080c8',
  ],
  bands: { upper: '#62b8c8', lower: '#d05470' },
  crosshair: { color: 'rgba(114,112,114,0.7)', labelBackground: '#403e42' },
  axis: { textColor: '#727072' },
  tooltip: { background: 'rgba(45,42,46,0.92)', textColor: '#fcfcfa', borderColor: 'rgba(64,60,62,0.6)' },
  typography: { fontFamily: FIRA },
  fontUrl: FIRA_URL,
});
