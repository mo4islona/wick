import { autoGradient, createTheme } from '../create';

const SILKSCREEN = "'Silkscreen', cursive";
const SILKSCREEN_URL = 'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap';

export const minimalLight = createTheme({
  name: 'Monochrome',
  description: 'Pure black and white, pixel font',
  background: '#ffffff',
  chartGradient: ['#ffffff', '#fafafa'],
  grid: { color: 'rgba(0,0,0,0.04)', style: 'solid' },
  candlestick: {
    up: { body: autoGradient('#111111'), wick: '#111111' },
    down: { body: autoGradient('#bbbbbb'), wick: '#bbbbbb' },
  },
  line: { color: '#111111' },
  seriesColors: [
    '#111111',
    '#888888',
    '#bbbbbb',
    '#555555',
    '#999999',
    '#333333',
    '#aaaaaa',
    '#666666',
    '#cccccc',
    '#444444',
  ],
  bands: { upper: '#555555', lower: '#bbbbbb' },
  crosshair: { color: 'rgba(0,0,0,0.35)', labelBackground: '#f0f0f0' },
  axis: { textColor: '#b0b0b0' },
  tooltip: { fontSize: 9, background: 'rgba(255,255,255,0.97)', textColor: '#222222', borderColor: 'rgba(0,0,0,0.04)' },
  typography: { fontFamily: SILKSCREEN },
  fontUrl: SILKSCREEN_URL,
});
