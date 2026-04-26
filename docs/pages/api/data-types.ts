// Inner data-point shapes for chart series. Surfaced as a nested expansion
// on the chart's `data` prop (see ApiPage) so a reader can drill from
// `OHLCInput[]` straight into the OHLC fields without leaving the page.
//
// Structured as ApiProp[] (not raw TS interface text) so the same renderer
// drives this and the regular nested expansions like `Partial<LineSeriesOptions>`.
// Sourced from packages/core/src/types.ts — keep in sync; the parity check
// doesn't cover data shape.

import type { ApiProp } from '../../components/ApiTable';

export interface DataShape {
  /** Short name of the inner type (e.g. "TimePoint", "OHLCData"). */
  typeName: string;
  /** Optional one-liner shown above the nested fields. */
  description?: string;
  /** Fields of the inner element type — same shape as ApiProp so the existing renderer just works. */
  props: ApiProp[];
}

const TIME_FIELD: ApiProp = {
  name: 'time',
  type: 'number',
  optional: false,
  defaultValue: null,
  deprecated: null,
  description: 'Unix milliseconds.',
};

const TIME_POINT: DataShape = {
  typeName: 'TimePoint',
  props: [
    TIME_FIELD,
    {
      name: 'value',
      type: 'number',
      optional: false,
      defaultValue: null,
      deprecated: null,
      description: 'Y-axis value at this point. Drives the line height / bar height.',
    },
  ],
};

export const CHART_DATA_TYPES: Record<string, DataShape> = {
  LineSeries: {
    ...TIME_POINT,
    description: 'Each layer is `TimePoint[]`. The series accepts a 2D array — one inner array per line.',
  },
  BarSeries: {
    ...TIME_POINT,
    description: 'Same shape as `LineSeries` — bars take `TimePoint[][]` (one layer per stacked / overlapping series).',
  },
  Sparkline: {
    ...TIME_POINT,
    description: 'Single-array form — `Sparkline` plots one tiny line/bar, so the input is `TimePoint[]` (not 2D).',
  },

  CandlestickSeries: {
    typeName: 'OHLCData',
    description:
      "One inner array per candlestick stream. `volume` is optional — omit it when you don't want a volume pane.",
    props: [
      TIME_FIELD,
      {
        name: 'open',
        type: 'number',
        optional: false,
        defaultValue: null,
        deprecated: null,
        description: 'Price at the start of the candle interval.',
      },
      {
        name: 'high',
        type: 'number',
        optional: false,
        defaultValue: null,
        deprecated: null,
        description: 'Highest price reached during the interval. Drives the upper wick.',
      },
      {
        name: 'low',
        type: 'number',
        optional: false,
        defaultValue: null,
        deprecated: null,
        description: 'Lowest price reached during the interval. Drives the lower wick.',
      },
      {
        name: 'close',
        type: 'number',
        optional: false,
        defaultValue: null,
        deprecated: null,
        description:
          'Price at the end of the interval. The body is drawn between `open` and `close`; `close > open` paints the up colour, otherwise the down colour.',
      },
      {
        name: 'volume',
        type: 'number',
        optional: true,
        defaultValue: null,
        deprecated: null,
        description:
          'Trade volume for the interval. When present on any candle, the chart adds a volume pane below the price pane; omit it across the whole series to hide that pane.',
      },
    ],
  },

  PieSeries: {
    typeName: 'PieSliceData',
    description:
      'A single flat array of slices. The renderer applies the seriesColors palette automatically when no per-slice `color` is set.',
    props: [
      {
        name: 'label',
        type: 'string',
        optional: false,
        defaultValue: null,
        deprecated: null,
        description: 'Slice name. Shown in the legend and the slice tooltip.',
      },
      {
        name: 'value',
        type: 'number',
        optional: false,
        defaultValue: null,
        deprecated: null,
        description: "Slice magnitude. Sums across slices determine each one's share of the pie.",
      },
      {
        name: 'color',
        type: 'string',
        optional: true,
        defaultValue: null,
        deprecated: null,
        description: 'Override colour for this slice. Falls back to the seriesColors palette.',
      },
    ],
  },
};

export function getDataShape(component: string): DataShape | null {
  return CHART_DATA_TYPES[component] ?? null;
}
