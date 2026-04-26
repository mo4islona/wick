import { IBM, IBM_URL, autoGradient, createTheme } from '../create';

export const quietLight = createTheme({
  name: 'Quiet Light',
  description: 'Subdued and easy on the eyes',
  background: '#f5f5f5',
  // Pin the gradient top stop instead of letting `createTheme` derive it
  // from `lightenHex(bg, 0.06)` — that landed at `#ffffff`, which read as
  // a hard white seam against the rest of the chrome.
  chartGradient: ['#fdfdfd', '#f5f5f5'],
  grid: { color: 'rgba(200,200,200,0.5)' },
  candlestick: {
    up: { body: autoGradient('#448c27'), wick: '#448c27' },
    down: { body: autoGradient('#aa3731'), wick: '#aa3731' },
  },
  line: { color: '#4b69c6' },
  seriesColors: [
    '#4b69c6',
    '#c47820',
    '#448c27',
    '#7a3e9d',
    '#aa3731',
    '#c47820',
    '#2d8fa1',
    '#aa3731',
    '#448c27',
    '#7a3e9d',
  ],
  bands: { upper: '#2d8fa1', lower: '#aa3731' },
  crosshair: { color: 'rgba(170,170,170,0.3)', labelBackground: '#e8e8e8' },
  axis: { textColor: '#aaaaaa' },
  tooltip: { background: 'rgba(245,245,245,0.95)', textColor: '#333333', borderColor: 'rgba(200,200,200,0.5)' },
  typography: { fontFamily: IBM },
  fontUrl: IBM_URL,
});
