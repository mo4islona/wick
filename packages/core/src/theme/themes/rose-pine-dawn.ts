import { SOURCE_CODE, SOURCE_CODE_URL, autoGradient, createTheme } from '../create';

export const rosePineDawn = createTheme({
  name: 'Rosé Pine Dawn',
  description: 'Dawn-inspired warm neutrals',
  background: '#faf4ed',
  grid: { color: 'rgba(152,147,165,0.2)' },
  candlestick: {
    up: { body: autoGradient('#56949f'), wick: '#56949f' },
    down: { body: autoGradient('#b4637a'), wick: '#b4637a' },
  },
  line: { color: '#907aa9' },
  seriesColors: [
    '#907aa9',
    '#ea9d34',
    '#56949f',
    '#d7827e',
    '#b4637a',
    '#ea9d34',
    '#286983',
    '#b4637a',
    '#907aa9',
    '#d7827e',
  ],
  bands: { upper: '#286983', lower: '#b4637a' },
  crosshair: { color: 'rgba(80,72,98,0.5)', labelBackground: '#f2e9e1' },
  axis: { textColor: '#9893a5' },
  tooltip: { background: 'rgba(250,244,237,0.95)', textColor: '#575279', borderColor: 'rgba(152,147,165,0.2)' },
  typography: { fontFamily: SOURCE_CODE },
  fontUrl: SOURCE_CODE_URL,
});
