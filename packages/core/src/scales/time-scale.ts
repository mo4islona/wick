import type { VisibleRange } from '../types';
import { niceTimeIntervals } from '../utils/time';
import { AxisTickTracker } from './tick-tracker';

/** Hard cap on generated ticks — defence-in-depth against pathological inputs. */
const MAX_TICKS = 50;

/** Default minimum pixel gap between adjacent X labels when no config is supplied. */
const DEFAULT_MIN_LABEL_SPACING = 80;

export class TimeScale {
  /**
   * Shared fade state for time ticks. Grid lines (canvas) and DOM tick labels
   * read opacity from the same tracker, so a tick fading in/out looks
   * identical on both surfaces.
   */
  readonly tickTracker = new AxisTickTracker();

  private from = 0;
  private to = 0;
  private width = 1;
  private pixelRatio = 1;
  private dataInterval: number | null = null;

  // Label density knobs — written by <TimeAxis labelCount=… minLabelSpacing=…>.
  private labelCountHintValue: number | null = null;
  private minSpacingValue: number | null = null;

  private resolvedInterval: number | null = null;
  private lastInterval: number | null = null;
  /**
   * "want" (desired interval post-floor) at the time lastInterval was snapped.
   * Hysteresis band anchors to this so micro range drift back across a tier
   * boundary doesn't flip the label density — mirrors YScale, see there for
   * the full reasoning.
   */
  private lastWant: number | null = null;
  /** Identifies the dataInterval bucket whose tier list drove lastInterval. */
  private lastBucketKey: number | null = null;

  private get labelCountHint(): number | null {
    return this.labelCountHintValue;
  }

  private get minLabelSpacing(): number {
    return this.minSpacingValue ?? DEFAULT_MIN_LABEL_SPACING;
  }

  update(range: VisibleRange, mediaWidth: number, pixelRatio: number, dataInterval?: number): void {
    this.from = range.from;
    this.to = range.to;
    this.width = mediaWidth;
    this.pixelRatio = pixelRatio;

    if (dataInterval !== undefined && dataInterval > 0) {
      const newBucket = bucketKey(dataInterval);
      if (this.lastBucketKey !== null && this.lastBucketKey !== newBucket) {
        // Data granularity shifted tier — discard cached interval so next
        // resolve can re-select from the new niceTimeIntervals() list.
        this.resetHysteresis();
      }
      this.lastBucketKey = newBucket;
      this.dataInterval = dataInterval;
    }

    this.resolveInterval();
  }

  setLabelCount(n: number | null | undefined): void {
    this.labelCountHintValue = normalizeLabelCount(n);
    this.resetHysteresis();
    this.resolveInterval();
  }

  setMinSpacing(px: number | null | undefined): void {
    this.minSpacingValue = normalizeSpacing(px);
    this.resetHysteresis();
    this.resolveInterval();
  }

  private resetHysteresis(): void {
    this.lastInterval = null;
    this.lastWant = null;
  }

  timeToX(time: number): number {
    if (this.to <= this.from) return 0;

    return ((time - this.from) / (this.to - this.from)) * this.width;
  }

  timeToBitmapX(time: number): number {
    return Math.round(this.timeToX(time) * this.pixelRatio);
  }

  xToTime(x: number): number {
    if (this.to <= this.from) return this.from;

    return this.from + (x / this.width) * (this.to - this.from);
  }

  pixelDeltaToTimeDelta(pixelDelta: number): number {
    if (this.to <= this.from) return 0;

    return (pixelDelta / this.width) * (this.to - this.from);
  }

  barWidthMedia(dataInterval: number): number {
    if (this.to <= this.from) return 0;

    return (dataInterval / (this.to - this.from)) * this.width;
  }

  barWidthBitmap(dataInterval: number): number {
    return Math.max(1, Math.round(this.barWidthMedia(dataInterval) * this.pixelRatio));
  }

  /**
   * Evenly spaced "nice" tick times. Resolution uses the cached
   * `dataInterval` set by `update()`; callers that bypass `update()` can
   * still pass it here for back-compat.
   */
  niceTickValues(dataInterval: number): { ticks: number[]; tickInterval: number } {
    if (this.to <= this.from) return { ticks: [], tickInterval: 0 };

    // Back-compat: if a caller hands a different dataInterval than was cached
    // via update(), re-resolve rather than returning a stale tick list.
    if (this.dataInterval !== dataInterval) {
      const newBucket = bucketKey(dataInterval);
      if (this.lastBucketKey !== null && this.lastBucketKey !== newBucket) {
        this.resetHysteresis();
      }
      this.lastBucketKey = newBucket;
      this.dataInterval = dataInterval;
      this.resolveInterval();
    }

    if (this.resolvedInterval == null) return { ticks: [], tickInterval: 0 };

    const interval = this.resolvedInterval;
    const start = Math.ceil(this.from / interval) * interval;
    const count = Math.max(0, Math.min(MAX_TICKS, Math.floor((this.to - start) / interval) + 1));

    const ticks: number[] = [];
    for (let i = 0; i < count; i++) ticks.push(start + i * interval);

    return { ticks, tickInterval: interval };
  }

  getRange(): VisibleRange {
    return { from: this.from, to: this.to };
  }

  getMediaWidth(): number {
    return this.width;
  }

  /**
   * Resolve the next tick interval. Walks `niceTimeIntervals(dataInterval)`
   * looking for the smallest tier ≥ desired spacing; retains the previous
   * tier inside a ratio band so micro pan/zoom doesn't flip label density.
   */
  private resolveInterval(): void {
    if (this.to <= this.from || this.width <= 0 || this.dataInterval == null || this.dataInterval <= 0) {
      this.resolvedInterval = null;
      return;
    }

    const intervals = niceTimeIntervals(this.dataInterval);
    const range = this.to - this.from;
    const timePerPixel = range / this.width;
    const floor = timePerPixel * this.minLabelSpacing;

    let want: number;
    if (this.labelCountHint != null) {
      // Bias gaps up by one so the ceiling snap onto `niceTimeIntervals`
      // doesn't regularly swallow a tick — mirrors YScale's hint semantics.
      const targetGaps = Math.max(1, this.labelCountHint);
      want = Math.max(range / targetGaps, floor);
    } else {
      want = floor;
    }

    if (this.lastInterval != null && this.lastWant != null && intervals.includes(this.lastInterval)) {
      const within = want >= this.lastWant * 0.8 && want <= this.lastWant * 1.25;
      // Resize guard: a width change shifts `floor` without touching
      // `lastWant`. Reusing a cached interval that no longer clears the
      // pixel floor would silently violate `minLabelSpacing`.
      const satisfiesFloor = this.lastInterval >= floor;
      if (within && satisfiesFloor) {
        this.resolvedInterval = this.lastInterval;
        return;
      }
    }

    let candidate = intervals[intervals.length - 1];
    let candidateIdx = intervals.length - 1;
    for (let i = 0; i < intervals.length; i++) {
      if (intervals[i] >= want) {
        candidate = intervals[i];
        candidateIdx = i;
        break;
      }
    }

    // If the ceiling snap leaves fewer than labelCount ticks visible, step
    // one tier down — as long as it still satisfies the pixel floor.
    if (this.labelCountHint != null && candidateIdx > 0 && this.countTicks(candidate) < this.labelCountHint) {
      const prev = intervals[candidateIdx - 1];
      if (prev >= floor) candidate = prev;
    }

    this.resolvedInterval = candidate;
    this.lastInterval = candidate;
    this.lastWant = want;
  }

  private countTicks(interval: number): number {
    if (!(interval > 0)) return 0;
    const start = Math.ceil(this.from / interval) * interval;

    return Math.max(0, Math.floor((this.to - start) / interval) + 1);
  }
}

/** Cheap cache key — dataInterval values that yield the same niceTimeIntervals() list. */
function bucketKey(dataInterval: number): number {
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  if (dataInterval < MINUTE) return 0;
  if (dataInterval < HOUR) return 1;
  if (dataInterval < DAY) return 2;

  return 3;
}

function normalizeLabelCount(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 2 ? Math.floor(n) : null;
}

function normalizeSpacing(px: number | null | undefined): number | null {
  return typeof px === 'number' && Number.isFinite(px) && px > 0 ? px : null;
}
