import { JAKARTA, JAKARTA_URL, autoGradient, createTheme } from '../create';

export const lavenderMist = createTheme({
  name: 'Lavender Mist',
  background: '#f5f0f4',
  candlestick: {
    up: { body: autoGradient('#6b8e5e'), wick: '#6b8e5e' },
    down: { body: autoGradient('#b85468'), wick: '#b85468' },
  },
  line: { color: '#7c6bc4' },
  seriesColors: [
    '#7c6bc4',
    '#d4885a',
    '#6b8e5e',
    '#c46b8e',
    '#b85468',
    '#8e7a4e',
    '#4e8e8a',
    '#b85468',
    '#7c6bc4',
    '#c46b8e',
  ],
  bands: { upper: '#4e8e8a', lower: '#b85468' },
  grid: { color: 'rgba(150,130,155,0.3)', style: 'dashed' },
  axis: { textColor: '#9a88a0' },
  crosshair: { color: 'rgba(80,60,90,0.45)', labelBackground: '#ebe4e8' },
  tooltip: { background: 'rgba(245,240,244,0.95)', textColor: '#3a3050', borderColor: 'rgba(150,130,155,0.25)' },
  typography: { fontFamily: JAKARTA },
  fontUrl: JAKARTA_URL,
  chartGradient: ['#f8f4f7', '#f5f0f4'],
});
