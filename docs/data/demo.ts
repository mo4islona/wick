/**
 * Shared demo datasets used across dashboard, playground, and individual pages.
 * Generated once at module load — deterministic per session.
 */
import type { TimePoint } from '@wick-charts/react';

import {
  DEMO_INTERVAL,
  generateBandLine,
  generateBarData,
  generateLineData,
  generateOHLCData,
  generateWaveData,
} from '../data';

// ── Interval (milliseconds) ─────────────────────────────────
/** Canonical bar interval, re-exported from `../data` so pages and hooks can
 *  import it from a stable `data/demo` path. The actual constant lives in
 *  `data.ts` to avoid a circular dependency (generators need it too). */
export { DEMO_INTERVAL };

// ── OHLC ─────────────────────────────────────────────────────
export const ohlcBTC = generateOHLCData(300, 42000, DEMO_INTERVAL);
export const ohlcETH = generateOHLCData(300, 3200, DEMO_INTERVAL);
export const ohlcVolatile = generateOHLCData(300, 100, DEMO_INTERVAL);
export const ohlcTrending = generateOHLCData(300, 1500, DEMO_INTERVAL);

// ── Lines ────────────────────────────────────────────────────
export const areaLine: TimePoint[] = ohlcETH.map((c) => ({ time: c.time, value: c.close }));
export const upperBand = generateBandLine(ohlcETH, 1.0);
export const lowerBand = generateBandLine(ohlcETH, -1.0);

export const multiLines = Array.from({ length: 10 }, () =>
  generateLineData(300, 100 + Math.random() * 200, DEMO_INTERVAL),
);

// ── Waves ────────────────────────────────────────────────────
export function makeWaves(count: number, layerCount: number, interval = DEMO_INTERVAL): TimePoint[][] {
  return Array.from({ length: layerCount }, (_, i) =>
    generateWaveData(count, {
      base: 5,
      amplitude: 100 + i * 40,
      period: 50 + i * 15,
      phase: i * 0.12,
      onset: i * 0.06,
      interval,
    }),
  );
}

// ── Bars ─────────────────────────────────────────────────────
export const barSingle = generateBarData(100, DEMO_INTERVAL);
