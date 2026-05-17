/**
 * Pure helper: derive the next streaming X target after data appended.
 *
 * Extracted out of `Viewport.computeStreamingTargetX` so the math can be
 * unit-tested in isolation and so a follow-up refactor can move the data-anchor state (prevDataEnd, holdUntilFilled, dataEnd) onto the chart
 * without dragging the viewport class along.
 *
 * Note: the result carries the new logical range to commit (or `null`), but
 * the caller is responsible for actually committing it — this function
 * pure, no state mutation.
 */

import type { VisibleRange } from '../types';
import type { HorizontalPadding } from '../viewport';

/** Minimum pending shift (expressed via dataInterval) before streaming X retargets. */
const AUTOSCROLL_MIN_DELTA_BARS = 0.5;
/** Minimum pending shift in pixels (whichever is smaller vs bars-based). */
const AUTOSCROLL_MIN_DELTA_PX = 4;

export interface StreamingTargetInput {
  /** Current logical X range. */
  currentLogical: VisibleRange;
  /** Latest data timestamp. */
  lastTime: number;
  /** Previous `dataEnd` value (or `null` on the first call) for offset preservation. */
  prevDataEnd: number | null;
  /** Time-between-bars. */
  dataInterval: number;
  /** Right-side padding (pixels or `{ intervals: N }`). */
  paddingRight: HorizontalPadding;
  /** Canvas pixel width. Used both for pixel-padding resolution and for the px-threshold floor. */
  chartWidth: number;
  /**
   * Warm-up hold (`setVisibleRange({ from, bars })` arms this) — suppresses
   * the streaming pan while the data hasn't reached the right edge yet.
   */
  holdUntilFilled: boolean;
}

export interface StreamingTargetResult {
  /** New logical X to commit, or `null` to keep the current one (held / sub-threshold). */
  newLogical: VisibleRange | null;
  /** When `true`, caller should release the `holdUntilFilled` flag. */
  releaseHold: boolean;
  /** When `true`, caller should set `autoScroll = true`. */
  reengageAutoScroll: boolean;
}

export function computeStreamingTarget(input: StreamingTargetInput): StreamingTargetResult {
  const { currentLogical, lastTime, prevDataEnd, dataInterval, paddingRight, chartWidth, holdUntilFilled } = input;
  const { from: lFrom, to: lTo } = currentLogical;
  const range = lTo - lFrom;
  if (range <= 0) {
    return { newLogical: null, releaseHold: false, reengageAutoScroll: false };
  }

  const pr = resolvePaddingTime(paddingRight, range, dataInterval, chartWidth);

  if (holdUntilFilled) {
    const tolerance = dataInterval * 0.01;
    // Data still fits — hold active, autoscroll re-engages without committing.
    if (lastTime + pr <= lTo + tolerance) {
      return { newLogical: null, releaseHold: false, reengageAutoScroll: true };
    }
    // Data has reached the right edge — release the hold and fall through to slide.
  }

  const rawOffset = prevDataEnd !== null ? lTo - prevDataEnd : pr;
  const offset = Math.max(0, Math.min(pr, rawOffset));
  const targetTo = lastTime + offset;
  const targetFrom = targetTo - range;

  // Sub-threshold: whichever is smaller — half a bar, or 4 px in time units.
  const barsThreshold = AUTOSCROLL_MIN_DELTA_BARS * dataInterval;
  const pxThreshold = chartWidth > 0 ? (AUTOSCROLL_MIN_DELTA_PX / chartWidth) * range : barsThreshold;
  const threshold = Math.min(barsThreshold, pxThreshold);

  const pending = Math.abs(targetTo - lTo);
  if (pending < threshold) {
    return { newLogical: null, releaseHold: holdUntilFilled, reengageAutoScroll: true };
  }

  return {
    newLogical: { from: targetFrom, to: targetTo },
    releaseHold: holdUntilFilled,
    reengageAutoScroll: true,
  };
}

function resolvePaddingTime(pad: HorizontalPadding, range: number, dataInterval: number, chartWidth: number): number {
  if (typeof pad === 'object') return pad.intervals * dataInterval;
  if (chartWidth <= 0) return 0;

  return (pad / chartWidth) * range;
}
