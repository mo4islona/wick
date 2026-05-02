import { autoGradient } from './create';
import type { ChartTheme } from './types';

/**
 * @deprecated Use a named preset instead — `catppuccin.theme` is the new
 * default dark palette, and `dracula`, `nightOwl`, `oneDarkPro`, `gruvbox`,
 * `monokaiPro`, `materialPalenight`, or `panda` cover the rest of the
 * dark spectrum. `darkTheme` is kept as an alias for the previous default
 * and will be removed in a future major release.
 */
export const darkTheme: ChartTheme = {
  background: '#131722',
  chartGradient: ['#1a1f2e', '#101318'] as [string, string],

  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 12,
  },

  grid: {
    color: 'rgba(42, 46, 57, 0.6)',
    style: 'dashed',
  },

  candlestick: {
    up: { body: autoGradient('#26a69a'), wick: '#26a69a' },
    down: { body: autoGradient('#ef5350'), wick: '#ef5350' },
  },

  line: {
    color: '#2962FF',
    width: 1,
    areaTopColor: 'rgba(41, 98, 255, 0.08)',
    areaBottomColor: 'rgba(41, 98, 255, 0.01)',
  },

  seriesColors: [
    '#2962FF',
    '#FF6D00',
    '#26a69a',
    '#AB47BC',
    '#ef5350',
    '#FFCA28',
    '#66BB6A',
    '#EC407A',
    '#42A5F5',
    '#B388FF',
  ],

  bands: {
    upper: '#42A5F5',
    lower: '#EC407A',
  },

  crosshair: {
    color: 'rgba(150, 150, 150, 0.5)',
    labelBackground: '#363a45',
    labelTextColor: '#d1d4dc',
  },

  axis: {
    fontSize: 10,
    textColor: '#787b86',
  },

  yLabel: {
    fontSize: 11,
    upBackground: '#26a69a',
    downBackground: '#ef5350',
    neutralBackground: '#363a45',
    textColor: '#ffffff',
  },

  tooltip: {
    fontSize: 12,
    background: 'rgba(19, 23, 34, 0.9)',
    textColor: '#d1d4dc',
    borderColor: 'rgba(42, 46, 57, 0.8)',
  },

  navigator: {
    height: 48,
    background: 'transparent',
    borderColor: 'rgba(120, 123, 134, 0.18)',
    line: {
      color: '#787b86',
      width: 1,
      areaTopColor: 'rgba(120, 123, 134, 0.22)',
      areaBottomColor: 'rgba(120, 123, 134, 0)',
    },
    candlestick: {
      up: { body: autoGradient('#26a69a'), wick: '#26a69a' },
      down: { body: autoGradient('#ef5350'), wick: '#ef5350' },
    },
    window: {
      fill: 'transparent',
      border: 'transparent',
      borderWidth: 0,
    },
    handle: {
      color: 'rgba(255, 255, 255, 0.30)',
      width: 6,
    },
    // Mask = page bg at high alpha. Outside the window the sparkline is
    // washed out by this color, so the visible window reads as a spotlight.
    mask: {
      fill: 'rgba(19, 23, 34, 0.78)',
    },
  },
};
