import { MONO, MONO_URL, autoGradient, createTheme } from '../create';

export const gruvbox = createTheme({
  name: 'Gruvbox',
  description: 'Retro warm with earthy tones',
  background: '#282828',
  grid: { color: 'rgba(100,94,90,0.3)' },
  candlestick: {
    up: { body: autoGradient('#b8bb26'), wick: '#b8bb26' },
    down: { body: autoGradient('#fb4934'), wick: '#fb4934' },
  },
  line: { color: '#83a598' },
  seriesColors: [
    '#83a598',
    '#fe8019',
    '#b8bb26',
    '#d3869b',
    '#fb4934',
    '#fabd2f',
    '#8ec07c',
    '#fb4934',
    '#458588',
    '#d3869b',
  ],
  bands: { upper: '#83a598', lower: '#d3869b' },
  crosshair: { color: 'rgba(146,131,116,0.7)', labelBackground: '#3c3836' },
  axis: { textColor: '#928374' },
  tooltip: { background: 'rgba(40,40,40,0.92)', textColor: '#ebdbb2', borderColor: 'rgba(60,56,54,0.6)' },
  typography: { fontFamily: MONO },
  fontUrl: MONO_URL,
});
