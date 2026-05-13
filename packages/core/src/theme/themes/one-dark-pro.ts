import { MONO, MONO_URL, autoGradient, createTheme } from '../create';

export const oneDarkPro = createTheme({
  name: 'One Dark Pro',
  description: "Atom editor's iconic dark palette",
  background: '#282c34',
  grid: { color: 'rgba(99,104,116,0.3)' },
  candlestick: {
    up: { body: autoGradient('#98c379'), wick: '#98c379' },
    down: { body: autoGradient('#e06c75'), wick: '#e06c75' },
  },
  line: { color: '#61afef' },
  seriesColors: [
    '#61afef',
    '#e5c07b',
    '#98c379',
    '#c678dd',
    '#e06c75',
    '#56b6c2',
    '#d19a66',
    '#be5046',
    '#61afef',
    '#c678dd',
  ],
  bands: { upper: '#56b6c2', lower: '#c678dd' },
  crosshair: { color: 'rgba(99,110,123,0.7)', labelBackground: '#3e4451' },
  axis: { textColor: '#5c6370' },
  tooltip: { background: 'rgba(40,44,52,0.92)', textColor: '#abb2bf', borderColor: 'rgba(59,64,72,0.6)' },
  typography: { fontFamily: MONO },
  fontUrl: MONO_URL,
});
