import { useEffect, useLayoutEffect, useRef } from 'react';

import type { CandlestickSeriesOptions, OHLCInput } from '@wick-charts/core';
import { normalizeTime } from '@wick-charts/core';

import { useChartInstance } from './context';

/** Only fall back to a full `setSeriesData` replace when more than this many new
 * candles appear in a single tick. Streamed bursts (OHLCStream emits up to ~8
 * per 500ms) must stay under this so their appendData path still fires entrance
 * animations; history loads (50/batch) deliberately exceed it. */
const BULK_THRESHOLD = 20;

export interface CandlestickSeriesProps {
  /** OHLC candles to render. Each element carries `time/open/high/low/close` and an optional `volume`. */
  data: OHLCInput[];
  /** Visual options override — colours, body width, entrance animation, smoothing. Merged onto theme defaults. */
  options?: Partial<CandlestickSeriesOptions>;
  /** Stable series ID — same value across remounts. */
  id?: string;
}

export function CandlestickSeries({ data, options, id: idProp }: CandlestickSeriesProps) {
  const chart = useChartInstance();
  const seriesRef = useRef<string | null>(null);
  const prevLenRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);
  const prevLastTimeRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const id = chart.addCandlestickSeries({ ...options, id: idProp });
    seriesRef.current = id;
    return () => {
      chart.removeSeries(id);
      seriesRef.current = null;
      prevLenRef.current = 0;
      prevFirstTimeRef.current = null;
      prevLastTimeRef.current = null;
    };
  }, [chart, idProp]);

  useLayoutEffect(() => {
    const id = seriesRef.current;
    if (!id) return;

    if (data.length === 0) {
      // Explicit clear
      chart.setSeriesData(id, []);
      prevLenRef.current = 0;
      prevFirstTimeRef.current = null;
      prevLastTimeRef.current = null;
      return;
    }

    const prevLen = prevLenRef.current;
    const prevFirst = prevFirstTimeRef.current;
    const prevLast = prevLastTimeRef.current;
    const firstTime = normalizeTime(data[0].time);
    const lastTime = normalizeTime(data[data.length - 1].time);
    const shifted = prevFirst !== null && prevFirst !== firstTime;
    const added = data.length - prevLen;
    const hasNewLast = prevLast !== null && prevLast !== lastTime;

    // Rolling-window slide: same array length but first AND last timestamps
    // advanced (old point dropped, new point appended). Append the new tail
    // then trim the head — `keepLast` keeps the streaming Y chase smooth,
    // unlike `setSeriesData` which would snap Y on every tick.
    if (shifted && added === 0 && hasNewLast) {
      chart.appendData(id, data[data.length - 1]);
      chart.keepLast(id, data.length);
    } else if (prevLen === 0 || data.length < prevLen || added > BULK_THRESHOLD || shifted) {
      chart.setSeriesData(id, data);
    } else if (data.length === prevLen) {
      // Same length, same timestamps — last candle updated in place.
      chart.updateData(id, data[data.length - 1]);
    } else {
      for (let i = prevLen; i < data.length; i++) {
        chart.appendData(id, data[i]);
      }
    }

    prevLenRef.current = data.length;
    prevFirstTimeRef.current = firstTime;
    prevLastTimeRef.current = lastTime;
  }, [chart, data]);

  useEffect(() => {
    if (seriesRef.current && options) {
      chart.updateSeriesOptions(seriesRef.current, options);
    }
  }, [
    chart,
    // Tuple bodies are new array refs on every render (preset `autoGradient()`
    // output, inline literals, etc.) and would misfire `Object.is`. Collapse
    // to a stable string the same way BarSeries/LineSeries handle `colors`.
    Array.isArray(options?.up?.body) ? options.up.body.join(',') : options?.up?.body,
    Array.isArray(options?.down?.body) ? options.down.body.join(',') : options?.down?.body,
    options?.up?.wick,
    options?.down?.wick,
    options?.bodyWidthRatio,
    options?.entryAnimation,
    options?.entryMs,
    options?.smoothMs,
  ]);

  return null;
}
