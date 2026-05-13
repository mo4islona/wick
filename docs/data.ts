import type { LineData, OHLCData } from '@wick-charts/react';

// ── Sampler protocol ─────────────────────────────────────────
//
// A sampler is a pure function that returns the next point given an index,
// a boundary timestamp, and the previous point. Historical data generators
// and live streaming sources share the same samplers, so live data looks
// statistically identical to history.
//
// `boundary` — emitted once per interval (a new bar / candle).
// `intra`    — emitted on each tick within the current bar (optional,
//              used for "still forming" effects on candles and drift lines).

export interface SamplerCtx<T> {
  index: number;
  time: number;
  prev: T | null;
}

export type LineSampler = (ctx: SamplerCtx<LineData>) => LineData;
export type OHLCSampler = (ctx: SamplerCtx<OHLCData>) => OHLCData;

export interface LineStrategy {
  boundary: LineSampler;
  intra?: LineSampler;
}

export interface OHLCStrategy {
  boundary: OHLCSampler;
  intra?: OHLCSampler;
}

const round = (n: number): number => Math.round(n * 100) / 100;

// ── OHLC strategy ────────────────────────────────────────────

export function ohlcStrategy(startPrice: number): OHLCStrategy {
  return {
    boundary: ({ index, time, prev }) => {
      const price = prev?.close ?? startPrice;
      const volatility = 0.005 + Math.random() * 0.01;
      const trend = Math.sin(index / 50) * 0.001;
      const change = (Math.random() - 0.48 + trend) * volatility * price;
      const open = price;
      const close = price + change;
      const highExtra = Math.random() * volatility * price * 0.5;
      const lowExtra = Math.random() * volatility * price * 0.5;
      const high = Math.max(open, close) + highExtra;
      const low = Math.min(open, close) - lowExtra;
      const volume = Math.round(1000 + Math.random() * 50000 + Math.abs(change) * 10000);
      return { time, open: round(open), high: round(high), low: round(low), close: round(close), volume };
    },
    intra: ({ time, prev }) => {
      if (!prev) throw new Error('ohlc intra sampler requires prev');
      const change = (Math.random() - 0.5) * 0.002 * prev.close;
      const close = round(prev.close + change);
      return {
        time,
        open: prev.open,
        high: Math.max(prev.high, close),
        low: Math.min(prev.low, close),
        close,
        volume: (prev.volume ?? 0) + Math.round(Math.random() * 100),
      };
    },
  };
}

// ── Monotonic ramp strategy ─────────────────────────────────
//
// Each tick adds `step + small noise` to the previous value. Used as a
// Y-axis stability test fixture: with strictly growing values, Y MAX
// extends on every tick while Y MIN stays put. Even a perfectly smooth
// auto-Y chase visibly slides all already-drawn points downward — the
// monotonic case is the cleanest way to see the default auto-Y behaviour
// before any sticky-bound fix.

export function monotonicStrategy(step: number, noise = 0.2): LineStrategy {
  return {
    boundary: ({ time, prev }) => {
      const jitter = (Math.random() - 0.5) * 2 * step * noise;
      const value = (prev?.value ?? 0) + step + jitter;
      return { time, value: round(value) };
    },
  };
}

// ── Line drift strategy (accumulating random walk) ──────────

export function lineDriftStrategy(startValue: number): LineStrategy {
  return {
    boundary: ({ index, time, prev }) => {
      const base = prev?.value ?? startValue;
      const volatility = 0.003 + Math.random() * 0.007;
      const trend = Math.sin(index / 80) * 0.0015 + Math.cos(index / 30) * 0.0005;
      const value = base + (Math.random() - 0.48 + trend) * volatility * base;
      return { time, value: round(value) };
    },
    intra: ({ time, prev }) => {
      if (!prev) throw new Error('line intra sampler requires prev');
      const change = (Math.random() - 0.5) * 0.002 * prev.value;
      return { time, value: round(prev.value + change) };
    },
  };
}

// ── Bar strategy (independent samples with sine trend) ──────

export function barStrategy(amplitude = 100): LineStrategy {
  return {
    boundary: ({ index, time }) => {
      const trend = Math.sin(index / 40) * 0.3;
      return { time, value: round((Math.random() - 0.45 + trend) * amplitude) };
    },
  };
}

// ── Layer strategy (always-positive jitter around a base) ──

export function layerStrategy(base: number): LineStrategy {
  return {
    boundary: ({ time }) => ({ time, value: Math.round(base + Math.random() * base * 0.8) }),
  };
}

// ── Wave strategy (deterministic smooth wave) ──────────────

export interface WaveOpts {
  base?: number;
  amplitude?: number;
  period?: number;
  phase?: number;
  onset?: number;
  /** Normalizer for the onset envelope. Defaults to the historical count. */
  totalHint?: number;
}

export function waveStrategy(opts: WaveOpts = {}): LineStrategy {
  const { base = 0, amplitude = 100, period = 80, phase = 0, onset = 0, totalHint = 300 } = opts;
  return {
    boundary: ({ index, time }) => {
      const t = totalHint > 0 ? index / totalHint : 0;
      const onsetFactor = onset > 0 ? Math.max(0, Math.min(1, (t - onset) / 0.15)) : 1;
      const wave = Math.sin((index / period + phase) * Math.PI * 2);
      const harmonic = Math.sin((index / (period * 0.4) + phase * 1.7) * Math.PI * 2) * 0.3;
      const value = base + Math.max(0, (wave + harmonic) * 0.5 + 0.5) * amplitude * onsetFactor;
      return { time, value: round(value) };
    },
  };
}

// ── Band strategy (derived from OHLC) ─────────────────────

export function bandStrategy(ohlc: OHLCData[], offset: number, noiseScale = 0.003): LineStrategy {
  return {
    boundary: ({ index, time }) => {
      const c = ohlc[index] ?? ohlc[ohlc.length - 1];
      const base = (c.high + c.low) / 2;
      const spread = c.high - c.low;
      const noise = Math.sin(index / 7) * noiseScale * base + (Math.random() - 0.5) * spread * 0.3;
      return { time, value: round(base + offset * spread * 1.5 + noise) };
    },
  };
}

// ── Historical generators (walk the sampler N times) ──────

function walkLine(count: number, interval: number, strategy: LineStrategy): LineData[] {
  const now = Math.floor(Date.now() / interval) * interval;
  const startTime = now - count * interval;
  const out: LineData[] = [];
  let prev: LineData | null = null;
  for (let i = 0; i < count; i++) {
    const next = strategy.boundary({ index: i, time: startTime + i * interval, prev });
    out.push(next);
    prev = next;
  }
  return out;
}

function walkOHLC(count: number, interval: number, strategy: OHLCStrategy): OHLCData[] {
  const now = Math.floor(Date.now() / interval) * interval;
  const startTime = now - count * interval;
  const out: OHLCData[] = [];
  let prev: OHLCData | null = null;
  for (let i = 0; i < count; i++) {
    const next = strategy.boundary({ index: i, time: startTime + i * interval, prev });
    out.push(next);
    prev = next;
  }
  return out;
}

/** Single source of truth for the docs' bar interval. Generators, hooks, and
 * every page that builds OHLC / line history read this so history and live
 * samplers always land on the same time grid. `data/demo.ts` re-exports it
 * under its public name (`DEMO_INTERVAL`). */
export const DEMO_INTERVAL = 5_000;

export function generateOHLCData(count: number, startPrice = 100, interval = DEMO_INTERVAL): OHLCData[] {
  return walkOHLC(count, interval, ohlcStrategy(startPrice));
}

export function generateLineData(count: number, startValue = 100, interval = DEMO_INTERVAL): LineData[] {
  return walkLine(count, interval, lineDriftStrategy(startValue));
}

export function generateBarData(count: number, interval = DEMO_INTERVAL): LineData[] {
  return walkLine(count, interval, barStrategy(100));
}

export function generateLayerData(count: number, base: number, interval = DEMO_INTERVAL): LineData[] {
  return walkLine(count, interval, layerStrategy(base));
}

export function generateWaveData(count: number, opts: WaveOpts & { interval?: number } = {}): LineData[] {
  const { interval = DEMO_INTERVAL, ...rest } = opts;
  return walkLine(count, interval, waveStrategy({ ...rest, totalHint: rest.totalHint ?? count }));
}

export function generateMonotonicData(
  count: number,
  startValue: number,
  step: number,
  interval = DEMO_INTERVAL,
): LineData[] {
  const out = walkLine(count, interval, monotonicStrategy(step));

  // walkLine starts from `prev = null` → first point is just step+noise. Shift
  // everything up by `startValue` so the seed sits at a recognisable base.
  for (const p of out) {
    p.value = round(p.value + startValue);
  }

  return out;
}

export function generateBandLine(ohlc: OHLCData[], offset: number, noiseScale = 0.003): LineData[] {
  const interval = ohlc.length > 1 ? (ohlc[1].time as number) - (ohlc[0].time as number) : 60_000;
  return walkLine(ohlc.length, interval, bandStrategy(ohlc, offset, noiseScale));
}

// ── Streaming sources ─────────────────────────────────────
//
// Both sources share the same control logic:
//  - a *virtual* clock advances at `speed() * realDt`, so raising speed
//    makes new bars appear faster without changing their time spacing;
//  - boundary sampler fires whenever the virtual clock crosses the next
//    `interval` step, advancing `index` and emitting a fresh point;
//  - intra sampler (if any) fires on every tick to refresh the in-progress
//    bar/candle, giving the "still forming" effect.

export interface StreamConfig<T, S> {
  last: T;
  startIndex: number;
  interval: number;
  strategy: S;
  /** Getter so the slider can update speed live without restarting the source. */
  speed?: () => number;
}

type AnyStrategy<T> = {
  boundary: (ctx: SamplerCtx<T>) => T;
  intra?: (ctx: SamplerCtx<T>) => T;
};

class BaseStream<T extends { time: number }, S extends AnyStrategy<T>> {
  protected timer: ReturnType<typeof setInterval> | null = null;
  protected last: T;
  protected index: number;
  protected readonly interval: number;
  protected readonly strategy: S;
  protected readonly speed: () => number;
  protected virtualNow: number;
  protected lastReal = 0;
  protected listeners: Array<(point: T) => void> = [];
  /** `intra` represents the in-progress update of whatever bar the stream is
   * currently forming. Until we cross the first boundary, the "current" bar is
   * the historical tail — flickering it would look like history is being
   * rewritten. Once we've emitted at least one boundary of our own, it's safe. */
  protected boundaryCrossed = false;
  /** Wall-clock timestamp of the last intra emission. We tick every 100ms so
   * the candle body can move smoothly, but emitting intra every tick pushes
   * 10 new "last value" events per second, which makes `YLabel`'s NumberFlow
   * (spinDuration=350ms) stutter. Throttle intras to ~2Hz so the label has
   * time to settle between updates while the boundary sampler keeps firing
   * promptly on every new bar. */
  protected lastIntraEmit = 0;
  protected static readonly INTRA_EMIT_MS = 500;
  constructor(cfg: StreamConfig<T, S>) {
    this.last = { ...cfg.last };
    this.index = cfg.startIndex;
    this.interval = cfg.interval;
    this.strategy = cfg.strategy;
    this.speed = cfg.speed ?? (() => 1);
    // First bar fires after a full `interval / speed` wait. Previous versions
    // granted a 500ms virtual-time head start to make the first bar appear
    // ~immediately, but that produced a visible "fast first tick → 1s pause
    // → steady cadence" rhythm. Equal spacing across every bar reads as
    // smoother panning, even at the cost of a one-interval cold start.
    this.virtualNow = cfg.last.time;
  }

  onTick(listener: (point: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  start(tickMs = 100): void {
    // 100ms tick → at the canonical 5_000ms bar interval we emit ~50 intra
    // updates per bar (smooth wobble) and cross at most one boundary per tick
    // even at 10× dashboard speed. Keeping tickMs small avoids the visible
    // "5-at-a-time" batching that happens when tickMs >> interval / speed.
    this.lastReal = Date.now();
    this.timer = setInterval(() => this.tick(), tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  protected emit(point: T): void {
    for (const l of this.listeners) l({ ...point });
  }

  protected tick(): void {
    const realNow = Date.now();
    const dt = realNow - this.lastReal;
    this.lastReal = realNow;
    this.virtualNow += dt * this.speed();

    const boundary = Math.floor(this.virtualNow / this.interval) * this.interval;
    while (boundary > this.last.time) {
      this.index++;
      const time = this.last.time + this.interval;
      this.last = this.strategy.boundary({ index: this.index, time, prev: this.last });
      this.emit(this.last);
      this.boundaryCrossed = true;
      this.lastIntraEmit = realNow;
    }

    if (
      this.boundaryCrossed &&
      this.strategy.intra &&
      realNow - this.lastIntraEmit >= BaseStream.INTRA_EMIT_MS
    ) {
      this.last = this.strategy.intra({ index: this.index, time: this.last.time, prev: this.last });
      this.emit(this.last);
      this.lastIntraEmit = realNow;
    }
  }
}

export class LineStream extends BaseStream<LineData, LineStrategy> {}
export class OHLCStream extends BaseStream<OHLCData, OHLCStrategy> {}

// ── Legacy aliases ────────────────────────────────────────

export const StreamingSource = OHLCStream;
export const LineStreamingSource = LineStream;
