import { useEffect, useLayoutEffect, useRef } from 'react';

import { type LineSeriesOptions, type TimePoint, normalizeTime } from '@wick-charts/core';

import { useChartInstance } from './context';

export interface LineSeriesProps {
  /** Array of datasets — one per layer. A single line uses `[data]`. */
  data: TimePoint[][];
  /** Visual options override — colours per layer, stroke width, area fill, stacking, entrance animation, smoothing. */
  options?: Partial<LineSeriesOptions>;
  /** Stable series ID — same value across remounts. */
  id?: string;
}

/** Only fall back to a full `setSeriesData` replace when more than this many new
 * points appear in a single tick — otherwise streamed updates would always look
 * like bulk loads and the renderer would clear its entrance-animation entries. */
const BULK_THRESHOLD = 20;

export function LineSeries({ data, options, id: idProp }: LineSeriesProps) {
  const chart = useChartInstance();
  const seriesRef = useRef<string | null>(null);
  const prevLensRef = useRef<number[]>([]);
  const prevFirstTimesRef = useRef<(number | null)[]>([]);
  const prevLastTimesRef = useRef<(number | null)[]>([]);

  useLayoutEffect(() => {
    const id = chart.addLineSeries({ ...options, layers: data.length, id: idProp });
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
        // length unchanged. Append the new tail then trim the head — this
        // path goes through `keepLast` (no Y snap) instead of `setSeriesData`
        // (which would force a per-tick Y snap, visible on wild-value feeds).
        if (shifted && added === 0 && hasNewLast) {
          chart.appendData(id, layer[layer.length - 1], i);
          chart.keepLast(id, layer.length, i);
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
    options?.strokeWidth,
    options?.area?.visible,
    (options as { areaFill?: boolean } | undefined)?.areaFill,
    options?.pulse,
    options?.stacking,
    options?.entryAnimation,
    options?.entryMs,
    options?.smoothMs,
  ]);

  return null;
}
