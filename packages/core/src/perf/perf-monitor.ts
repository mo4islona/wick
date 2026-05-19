export type FrameKind = 'main' | 'overlay';

export interface FrameTimingSample {
  /** Wall-clock ms for the most recent frame. */
  last: number;
  /** Median frame time over the rolling window. */
  p50: number;
  /** Tail frame time (worst 5%) — useful for spotting stutter. */
  p95: number;
}

/** Kept for source compatibility; prefer {@link FrameTimingSample}. */
export type PercentileSample = FrameTimingSample;

export interface PerfStats {
  /**
   * Main-layer renders per second, derived from the interval between recent main
   * frames. Charts render on demand (data change, pan, zoom, resize, streaming
   * tick), so `0` during an idle chart is normal — not a stutter. `0` until two
   * frames have been recorded.
   */
  mainRendersPerSec: number;
  /** Same as {@link mainRendersPerSec} but for the overlay (crosshair + pulse) layer. */
  overlayRendersPerSec: number;
  mainFrameMs: FrameTimingSample;
  overlayFrameMs: FrameTimingSample;
  /** Total frames recorded per layer. Lets consumers distinguish "no data yet" from "drew once and ms is 0". */
  frameCount: { main: number; overlay: number };
  drawCalls: {
    main: Record<string, number>;
    overlay: Record<string, number>;
  };
  perSeries: Record<string, FrameTimingSample>;
  /** `null` on browsers without `performance.memory` (Firefox, Safari). */
  heapMb: number | null;
}

export interface PerfMonitorOptions {
  /**
   * Age of the rolling window in milliseconds. Samples older than this are
   * dropped from FPS / percentile calculations. Defaults to 5000 (5 seconds).
   *
   * Tradeoff: smaller windows react faster to load changes but are noisier;
   * larger windows smooth spikes but lag. 5 s is a balance — it's long
   * enough that p95 is meaningful and short enough that numbers visibly
   * settle when you stop interacting.
   */
  windowMs?: number;
  /**
   * Hard cap on retained samples per layer. Belt-and-suspenders against a
   * runaway high-FPS layer growing the buffer unbounded. Defaults to 2000.
   */
  maxSamples?: number;
  /** Sample `performance.memory` every Nth main frame. Defaults to 30 (~0.5s at 60fps). */
  heapSampleEveryNFrames?: number;
}

const DEFAULT_WINDOW_MS = 5000;
const DEFAULT_MAX_SAMPLES = 2000;
const DEFAULT_HEAP_INTERVAL = 30;

/**
 * Drop samples whose stamp is older than `minStamp`. `values` and `stamps`
 * are kept in lockstep — same length, same index points to the same event.
 * Stamps array is monotonically non-decreasing (frames timestamp in order),
 * so a single front-trim is correct.
 */
function trimByAge(values: number[], stamps: number[], minStamp: number): void {
  let drop = 0;
  while (drop < stamps.length && stamps[drop] < minStamp) drop++;
  if (drop > 0) {
    values.splice(0, drop);
    stamps.splice(0, drop);
  }
}

function capSize(values: number[], stamps: number[], cap: number): void {
  const excess = values.length - cap;
  if (excess > 0) {
    values.splice(0, excess);
    stamps.splice(0, excess);
  }
}

function percentiles(samples: readonly number[]): FrameTimingSample {
  if (samples.length === 0) return { last: 0, p50: 0, p95: 0 };

  const sorted = [...samples].sort((a, b) => a - b);

  return {
    last: samples[samples.length - 1],
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
  };
}

function fpsFromStamps(stamps: readonly number[]): number {
  if (stamps.length < 2) return 0;

  const span = stamps[stamps.length - 1] - stamps[0];
  if (span <= 0) return 0;

  return ((stamps.length - 1) * 1000) / span;
}

function mapToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) out[k] = v;

  return out;
}

/**
 * Collects per-frame timing, draw-call counts, per-series render ms, and heap
 * usage. All collection sites short-circuit to no-ops when no monitor is
 * attached to the chart, so the zero-perf path remains byte-identical to a
 * monitorless build.
 *
 * Not thread-safe (there are no threads) — a single chart writes to a single
 * monitor. Multiple charts may share a monitor, but `perSeries` keys must be
 * unique across charts or samples will collide.
 */
export class PerfMonitor {
  /** Draw-call tally map for the main layer. Mutated in place by the counting context; cleared at the start of each frame. */
  readonly drawCallsMain = new Map<string, number>();
  /** Draw-call tally map for the overlay layer. Same contract as `drawCallsMain`. */
  readonly drawCallsOverlay = new Map<string, number>();

  private readonly mainMs: number[] = [];
  private readonly overlayMs: number[] = [];
  private readonly mainStamps: number[] = [];
  private readonly overlayStamps: number[] = [];
  private readonly perSeriesMs = new Map<string, number[]>();
  private readonly perSeriesStamps = new Map<string, number[]>();
  private readonly listeners = new Set<(stats: PerfStats) => void>();

  private readonly windowMs: number;
  private readonly maxSamples: number;
  private readonly heapInterval: number;
  private heapCounter = 0;
  private heapMb: number | null = null;
  private mainFrameCount = 0;
  private overlayFrameCount = 0;
  /** Most recent frame timestamp across either layer — anchor for age-based trimming. */
  private lastStamp = 0;

  constructor(options: PerfMonitorOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.heapInterval = options.heapSampleEveryNFrames ?? DEFAULT_HEAP_INTERVAL;
  }

  /** Clear the draw-call tally for the given layer. Call at the start of each frame. */
  resetDrawCalls(kind: FrameKind): void {
    (kind === 'main' ? this.drawCallsMain : this.drawCallsOverlay).clear();
  }

  /** Record a completed frame's wall-clock duration and emit stats to subscribers. */
  recordFrame(kind: FrameKind, ms: number, timestamp: number): void {
    this.lastStamp = timestamp;

    if (kind === 'main') {
      this.mainMs.push(ms);
      this.mainStamps.push(timestamp);
      this.mainFrameCount++;
      this.sampleHeap();
    } else {
      this.overlayMs.push(ms);
      this.overlayStamps.push(timestamp);
      this.overlayFrameCount++;
    }

    this.trimAll(timestamp);

    if (this.listeners.size > 0) {
      const stats = this.getStats();
      for (const cb of this.listeners) cb(stats);
    }
  }

  /** Record one series renderer's time slice inside the main pass. Called from inside `renderMain`, so the enclosing `recordFrame('main', …)` trim takes care of age. */
  recordSeries(id: string, ms: number, timestamp: number = this.lastStamp): void {
    let values = this.perSeriesMs.get(id);
    let stamps = this.perSeriesStamps.get(id);
    if (!values || !stamps) {
      values = [];
      stamps = [];
      this.perSeriesMs.set(id, values);
      this.perSeriesStamps.set(id, stamps);
    }
    values.push(ms);
    stamps.push(timestamp);
  }

  /** Drop samples older than `windowMs` behind the newest recorded stamp, and enforce the hard per-layer cap. */
  private trimAll(now: number): void {
    const minStamp = now - this.windowMs;
    trimByAge(this.mainMs, this.mainStamps, minStamp);
    trimByAge(this.overlayMs, this.overlayStamps, minStamp);
    capSize(this.mainMs, this.mainStamps, this.maxSamples);
    capSize(this.overlayMs, this.overlayStamps, this.maxSamples);
    for (const id of this.perSeriesMs.keys()) {
      const values = this.perSeriesMs.get(id);
      const stamps = this.perSeriesStamps.get(id);
      if (!values || !stamps) continue;
      trimByAge(values, stamps, minStamp);
      capSize(values, stamps, this.maxSamples);
    }
  }

  /** Subscribe to per-frame stat snapshots. Returns an unsubscribe function. */
  onFrame(cb: (stats: PerfStats) => void): () => void {
    this.listeners.add(cb);

    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Snapshot current stats. Safe to call outside frames. */
  getStats(): PerfStats {
    const perSeries: Record<string, FrameTimingSample> = {};
    for (const [id, arr] of this.perSeriesMs) perSeries[id] = percentiles(arr);

    const mainRendersPerSec = fpsFromStamps(this.mainStamps);

    return {
      mainRendersPerSec,
      overlayRendersPerSec: fpsFromStamps(this.overlayStamps),
      mainFrameMs: percentiles(this.mainMs),
      overlayFrameMs: percentiles(this.overlayMs),
      frameCount: { main: this.mainFrameCount, overlay: this.overlayFrameCount },
      drawCalls: {
        main: mapToRecord(this.drawCallsMain),
        overlay: mapToRecord(this.drawCallsOverlay),
      },
      perSeries,
      heapMb: this.heapMb,
    };
  }

  destroy(): void {
    this.listeners.clear();
    this.mainMs.length = 0;
    this.overlayMs.length = 0;
    this.mainStamps.length = 0;
    this.overlayStamps.length = 0;
    this.perSeriesMs.clear();
    this.perSeriesStamps.clear();
    this.drawCallsMain.clear();
    this.drawCallsOverlay.clear();
    this.mainFrameCount = 0;
    this.overlayFrameCount = 0;
    this.lastStamp = 0;
    this.heapCounter = 0;
    this.heapMb = null;
  }

  private sampleHeap(): void {
    this.heapCounter++;
    if (this.heapCounter < this.heapInterval) return;

    this.heapCounter = 0;
    // `performance.memory` is a Chrome-only, non-standard extension — feature-detect.
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.heapMb = mem ? mem.usedJSHeapSize / (1024 * 1024) : null;
  }
}
