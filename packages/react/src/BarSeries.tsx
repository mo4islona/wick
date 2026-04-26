import { useEffect, useLayoutEffect, useRef } from 'react';

import { type BarSeriesOptions, type TimePoint, normalizeTime } from '@wick-charts/core';

import { useChartInstance } from './context';

export interface BarSeriesProps {
  /** Array of datasets — one per layer. A single-layer bar chart uses `[data]`. */
  data: TimePoint[][];
  /** Visual options override — colours per layer, bar-width ratio, stacking, entrance animation, smoothing. */
  options?: Partial<BarSeriesOptions>;
  /** Stable series ID — same value across remounts. */
  id?: string;
}

/** Only fall back to a full `setSeriesData` replace when more than this many new
 * points appear in a single tick — otherwise streamed updates would always look
 * like bulk loads and the renderer would clear its entrance-animation entries. */
const BULK_THRESHOLD = 20;

export function BarSeries({ data, options, id: idProp }: BarSeriesProps) {
  const chart = useChartInstance();
  const seriesRef = useRef<string | null>(null);
  const prevLensRef = useRef<number[]>([]);
  const prevFirstTimesRef = useRef<(number | null)[]>([]);
  const prevLastTimesRef = useRef<(number | null)[]>([]);

  useLayoutEffect(() => {
    const id = chart.addBarSeries({ ...options, layers: data.length, id: idProp });
    seriesRef.current = id;
    prevLensRef.current = new Array(data.length).fill(0);
    prevFirstTimesRef.current = new Array(data.length).fill(null);
    prevLastTimesRef.current = new Array(data.length).fill(null);
    return () => {
      chart.removeSeries(id);
      seriesRef.current = null;
      prevLensRef.current = [];
      prevFirstTimesRef.current = [];
      prevLastTimesRef.current = [];
    };
  }, [chart, data.length, idProp]);

  useLayoutEffect(() => {
    const id = seriesRef.current;
    if (!id) return;

    chart.batch(() => {
      for (let i = 0; i < data.length; i++) {
        const layer = data[i];
        const prevLen = prevLensRef.current[i] ?? 0;
        const prevFirst = prevFirstTimesRef.current[i] ?? null;

        if (layer.length === 0) {
          chart.setSeriesData(id, [], i);
          prevLensRef.current[i] = 0;
          prevFirstTimesRef.current[i] = null;
          prevLastTimesRef.current[i] = null;
          continue;
        }

        const firstTime = normalizeTime(layer[0].time);
        const lastTime = normalizeTime(layer[layer.length - 1].time);
        const prevLast = prevLastTimesRef.current[i] ?? null;
        const shifted = prevFirst !== null && prevFirst !== firstTime;
        const added = layer.length - prevLen;
        const hasNewLast = prevLast !== null && prevLast !== lastTime;

        // Rolling-window slide (maxPoints cap): drop oldest, append newest,
        // length unchanged. Sync prefix then appendData the new tail so the
        // entrance animation fires instead of getting wiped by setSeriesData.
        if (shifted && added === 0 && hasNewLast) {
          chart.setSeriesData(id, layer.slice(0, -1), i);
          chart.appendData(id, layer[layer.length - 1], i);
        } else if (prevLen === 0 || layer.length < prevLen || added > BULK_THRESHOLD || shifted) {
          chart.setSeriesData(id, layer, i);
        } else if (layer.length === prevLen) {
          chart.updateData(id, layer[layer.length - 1], i);
        } else {
          for (let j = prevLen; j < layer.length; j++) {
            chart.appendData(id, layer[j], i);
          }
        }

        prevLensRef.current[i] = layer.length;
        prevFirstTimesRef.current[i] = firstTime;
        prevLastTimesRef.current[i] = lastTime;
      }
    });
  }, [chart, data]);

  useEffect(() => {
    if (seriesRef.current && options) {
      chart.updateSeriesOptions(seriesRef.current, options);
    }
  }, [
    chart,
    options?.colors?.join(','),
    options?.barWidthRatio,
    options?.stacking,
    options?.entryAnimation,
    options?.enterAnimation,
    options?.entryMs,
    options?.enterMs,
    options?.smoothMs,
  ]);

  return null;
}
