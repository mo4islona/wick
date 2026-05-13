import { JAKARTA, JAKARTA_URL, autoGradient, createTheme } from '../create';

export const githubLight = createTheme({
  name: 'GitHub Light',
  description: 'Clean and familiar, GitHub-inspired',
  background: '#fafbfc',
  chartGradient: ['#ffffff', '#fafbfc'],
  grid: { color: 'rgba(208,215,222,0.4)' },
  candlestick: {
    up: { body: autoGradient('#2da44e'), wick: '#2da44e' },
    down: { body: autoGradient('#cf222e'), wick: '#cf222e' },
  },
  line: { color: '#0969da', areaTopColor: 'rgba(9,105,218,0.05)', areaBottomColor: 'rgba(9,105,218,0.005)' },
  seriesColors: [
    '#0969da',
    '#c4820e',
    '#2da44e',
    '#8250df',
    '#cf222e',
    '#c4820e',
    '#0550ae',
    '#cf222e',
    '#2da44e',
    '#8250df',
  ],
  bands: { upper: '#0550ae', lower: '#cf222e' },
  crosshair: { color: 'rgba(80,90,100,0.5)', labelBackground: '#f0f3f6' },
  axis: { textColor: '#8b949e' },
  tooltip: { background: 'rgba(250,251,252,0.95)', textColor: '#24292f', borderColor: 'rgba(216,222,228,0.5)' },
  typography: { fontFamily: JAKARTA },
  fontUrl: JAKARTA_URL,
});
