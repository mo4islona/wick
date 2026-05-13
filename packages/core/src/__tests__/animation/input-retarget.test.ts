/**
 * Input animation contract.
 *
 * Pin the rule that user pan/zoom commits split into two:
 *   - Logical state (animator.target) advances synchronously per event so
 *     the next event's gesture math (rubber-band, autoscroll, edgeReached)
 *     reads the latest committed position.
 *   - Visual state (animator.current) eases over `inputResponseMs` so a
 *     single mouse event isn't a teleport and back-to-back wheel/trackpad
 *     events interpolate through the same animator without restarting the
 *     curve from scratch.
 *
 * Also covers the opt-out: `animations.viewport.inputResponseMs: 0` (or
 * `false`) collapses pan/zoom to instant apply. Navigator drag (calls
 * `chart.setVisibleRange`) is a public-API commit and must always snap
 * regardless of the option.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Viewport } from '../../viewport';

const INTERVAL = 60_000;
const CHART_WIDTH = 800;
const INPUT_MS = 60;

describe('input animation', () => {
  let now = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    now = 0;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function makeViewport(): Viewport {
    const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(100 * INTERVAL);
    v.fitToData(0, 100 * INTERVAL, { chartWidth: CHART_WIDTH });

    return v;
  }

  describe('eased path (inputResponseMs > 0)', () => {
    it('pan retargets visual but commits logical synchronously', () => {
      const v = makeViewport();
      const logicalBefore = { ...v.logicalRange };
      const visualBefore = { ...v.visualRange };

      v.pan(INTERVAL, CHART_WIDTH, INPUT_MS);

      // Logical jumped by INTERVAL immediately (sync gesture math contract).
      expect(v.logicalRange.from).toBeCloseTo(logicalBefore.from + INTERVAL, 5);
      expect(v.logicalRange.to).toBeCloseTo(logicalBefore.to + INTERVAL, 5);

      // Visual hasn't moved yet — animation just retargeted at t=0.
      expect(v.visualRange.from).toBeCloseTo(visualBefore.from, 5);
      expect(v.visualRange.to).toBeCloseTo(visualBefore.to, 5);
      expect(v.animating).toBe(true);
    });

    it('zoom retargets visual but commits logical synchronously', () => {
      const v = makeViewport();
      const widthBefore = v.logicalRange.to - v.logicalRange.from;

      // Zoom in by 0.7× (no soft-bound clamp at this scale).
      const center = (v.logicalRange.from + v.logicalRange.to) / 2;
      v.zoomAt(center, 0.7, CHART_WIDTH, INPUT_MS);

      const widthAfter = v.logicalRange.to - v.logicalRange.from;
      expect(widthAfter).toBeCloseTo(widthBefore * 0.7, 5);

      // Visual width unchanged at t=0 — eases over INPUT_MS.
      const visualWidth = v.visualRange.to - v.visualRange.from;
      expect(visualWidth).toBeCloseTo(widthBefore, 5);
      expect(v.animating).toBe(true);
    });

    it('back-to-back pans interpolate through one animator (visual continuity)', () => {
      const v = makeViewport();
      const logicalBefore = v.logicalRange.to;

      now = 0;
      v.pan(INTERVAL, CHART_WIDTH, INPUT_MS);
      // Halfway through the 60ms ease.
      now = 30;
      v.tick(now);
      const midVisual = { ...v.visualRange };

      // Second pan event arrives mid-flight. Visual must not jump.
      v.pan(INTERVAL, CHART_WIDTH, INPUT_MS);

      expect(v.visualRange.from).toBeCloseTo(midVisual.from, 5);
      expect(v.visualRange.to).toBeCloseTo(midVisual.to, 5);

      // Logical advanced by ~2 INTERVALs forward (rubber-band near the right
      // soft bound shaves a tiny fraction off the second event — the contract
      // here is "two pan events were applied to logical, both into the
      // animator", not the exact soft-bound math).
      expect(v.logicalRange.to).toBeGreaterThan(logicalBefore + 1.5 * INTERVAL);
    });

    it('settles to the latest target after the ease completes', () => {
      const v = makeViewport();
      now = 0;

      v.pan(INTERVAL, CHART_WIDTH, INPUT_MS);
      // Drain past the 60ms ease.
      for (let i = 0; i < 10; i++) {
        now += 16;
        v.tick(now);
      }

      expect(v.visualRange).toEqual(v.logicalRange);
      expect(v.animating).toBe(false);
    });

    it('autoscroll-on-tail-visible decision uses logical, not visual', () => {
      const v = makeViewport();
      // Tail at logicalRange.to (= dataEnd + 3*interval) — autoScroll true.
      expect(v.autoScroll).toBe(true);

      // Pan forward by 0.1*INTERVAL — tail still inside logical range.
      v.pan(INTERVAL * 0.1, CHART_WIDTH, INPUT_MS);
      expect(v.autoScroll).toBe(true);
    });
  });

  describe('opt-out (inputResponseMs === 0)', () => {
    it('pan with durationMs=0 snaps both logical and visual immediately', () => {
      const v = makeViewport();

      v.pan(INTERVAL, CHART_WIDTH, 0);

      expect(v.visualRange).toEqual(v.logicalRange);
      expect(v.animating).toBe(false);
    });

    it('zoom with durationMs=0 snaps immediately', () => {
      const v = makeViewport();
      const center = (v.logicalRange.from + v.logicalRange.to) / 2;

      v.zoomAt(center, 0.7, CHART_WIDTH, 0);

      expect(v.visualRange).toEqual(v.logicalRange);
      expect(v.animating).toBe(false);
    });

    it('omitted durationMs defaults to 0 (legacy snap behaviour)', () => {
      const v = makeViewport();

      v.pan(INTERVAL, CHART_WIDTH);

      expect(v.visualRange).toEqual(v.logicalRange);
      expect(v.animating).toBe(false);
    });
  });

  describe('navigator-style snap (programmatic API)', () => {
    it('setRange snaps regardless of any input animation in flight', () => {
      const v = makeViewport();

      // Start an in-flight input animation.
      v.pan(INTERVAL, CHART_WIDTH, INPUT_MS);
      now = 30;
      v.tick(now);
      expect(v.animating).toBe(true);

      // Programmatic setVisibleRange-style commit (what NavigatorController calls).
      v.setRange({ from: 50 * INTERVAL, to: 80 * INTERVAL });

      // Snapped — visual === logical, no animation.
      expect(v.visualRange).toEqual({ from: 50 * INTERVAL, to: 80 * INTERVAL });
      expect(v.logicalRange).toEqual({ from: 50 * INTERVAL, to: 80 * INTERVAL });
      expect(v.animating).toBe(false);
    });
  });
});
