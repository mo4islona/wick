import { CAVEAT, CAVEAT_URL, type ThemePreset, autoGradient } from '../create';

export const handwritten: ThemePreset = {
  name: 'Handwritten',
  description: 'Sketch-style with a personal touch',
  fontUrl: CAVEAT_URL,
  dark: false,
  theme: {
    background: '#fdf5e6',
    chartGradient: ['#fef6e3', '#fdf5e6'],
    // Caveat reads larger than monospace at the same px size, but `18` was
    // overshooting — sidebar items and prop descriptions sat ~50 % taller
    // than every other theme. `15` lands in the same visual weight class
    // while still feeling distinctly handwritten.
    typography: {
      fontFamily: CAVEAT,
      fontSize: 15,
    },
    grid: {
      color: 'rgba(180,170,150,0.3)',
      style: 'dashed',
    },
    candlestick: {
      up: { body: autoGradient('#7a9a5e'), wick: '#7a9a5e' },
      down: { body: autoGradient('#b07060'), wick: '#b07060' },
    },
    line: {
      color: '#6a8fa0',
      width: 1,
      areaTopColor: 'rgba(106,143,160,0.08)',
      areaBottomColor: 'rgba(106,143,160,0.01)',
    },
    seriesColors: [
      '#6a8fa0',
      '#c09050',
      '#7a9a5e',
      '#8a7098',
      '#b07060',
      '#a09030',
      '#508878',
      '#a06878',
      '#6888a0',
      '#8870a0',
    ],
    bands: {
      upper: '#6888a0',
      lower: '#a06878',
    },
    crosshair: {
      color: 'rgba(160,152,128,0.3)',
      labelBackground: '#f5edd8',
      labelTextColor: '#5c5040',
    },
    axis: {
      fontSize: 13,
      textColor: '#a09880',
    },
    yLabel: {
      fontSize: 15,
      upBackground: '#7a9a5e',
      downBackground: '#b07060',
      neutralBackground: '#e8dcc8',
      textColor: '#fdf5e6',
    },
    tooltip: {
      fontSize: 14,
      background: 'rgba(253,245,230,0.95)',
      textColor: '#5c5040',
      borderColor: 'rgba(180,170,150,0.4)',
    },
    navigator: {
      height: 48,
      background: 'transparent',
      borderColor: 'rgba(106,143,160,0.22)',
      line: {
        color: '#92806c',
        width: 1,
        areaTopColor: 'rgba(146,128,108,0.18)',
        areaBottomColor: 'rgba(146,128,108,0)',
      },
      candlestick: {
        up: { body: autoGradient('#7a9a5e'), wick: '#7a9a5e' },
        down: { body: autoGradient('#b07060'), wick: '#b07060' },
      },
      window: {
        fill: 'transparent',
        border: 'transparent',
        borderWidth: 0,
      },
      handle: {
        color: 'rgba(0,0,0,0.30)',
        width: 6,
      },
      mask: {
        fill: 'rgba(253,245,230,0.78)',
      },
    },
  },
};
