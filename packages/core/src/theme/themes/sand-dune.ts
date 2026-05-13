import { SOURCE_CODE, SOURCE_CODE_URL, autoGradient, createTheme } from '../create';

export const sandDune = createTheme({
  name: 'Sand Dune',
  background: '#f4f0e8',
  candlestick: {
    up: { body: autoGradient('#5a8a50'), wick: '#5a8a50' },
    down: { body: autoGradient('#b85040'), wick: '#b85040' },
  },
  line: { color: '#8a6a3a' },
  seriesColors: [
    '#8a6a3a',
    '#b87a40',
    '#5a8a50',
    '#7a5a70',
    '#b85040',
    '#a09030',
    '#4a7a7a',
    '#b85040',
    '#8a6a3a',
    '#7a5a70',
  ],
  bands: { upper: '#4a7a7a', lower: '#b85040' },
  grid: { color: 'rgba(150,130,100,0.15)' },
  axis: { textColor: '#9a8a70' },
  crosshair: { color: 'rgba(85,65,45,0.45)', labelBackground: '#e8e0d0' },
  tooltip: { background: 'rgba(244,240,232,0.95)', textColor: '#3a3020', borderColor: 'rgba(150,130,100,0.3)' },
  typography: { fontFamily: SOURCE_CODE },
  fontUrl: SOURCE_CODE_URL,
  chartGradient: ['#f8f4ec', '#f4f0e8'],
});
