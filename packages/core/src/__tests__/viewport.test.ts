import { describe, expect, it } from 'vitest';

import { Viewport } from '../viewport';

const INTERVAL = 60_000; // 1 minute in ms

describe('Viewport', () => {
  it('setYRange adds pixel-based padding', () => {
    const v = new Viewport({ padding: { top: 20, bottom: 20 } });
    // chartHeight=200, range=100, so 20px = 10% of range = 10 data units
    v.setYRange(100, 200, 200);
    const r = v.yRange;
    expect(r.min).toBeLessThan(100);
    expect(r.max).toBeGreaterThan(200);
    expect(r.min).toBeCloseTo(90);
    expect(r.max).toBeCloseTo(210);
  });

  it('setYRange skips padding when fixed', () => {
    const v = new Viewport({ padding: { top: 20, bottom: 20 } });
    v.setYRange(0, 100, 200, true, false);
    expect(v.yRange.min).toBe(0); // fixed, no padding
    expect(v.yRange.max).toBeGreaterThan(100); // not fixed, padded
  });

  it('fitToData sets visible range', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(1_000_000, 19_000_000, 800);
    const r = v.visibleRange;
    expect(r.from).toBeLessThanOrEqual(1_000_000);
    expect(r.to).toBeGreaterThanOrEqual(19_000_000);
  });

  it('fitToData with zero padding places last time exactly at right edge', () => {
    const v = new Viewport({ padding: { right: { intervals: 0 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    expect(v.visibleRange.to).toBe(18_000_000);
    expect(v.visibleRange.from).toBe(0);
  });

  it('fitToData right padding as pixels is proportional to chart width', () => {
    // right: 80px on 800px wide chart = 10% of dataSpan → pr = (80/800)*18_000_000 = 1_800_000
    const v = new Viewport({ padding: { right: 80, left: 0 } });
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    expect(v.visibleRange.to).toBeCloseTo(18_000_000 + 1_800_000, 0);
  });

  it('fitToData right padding as intervals adds N*dataInterval', () => {
    const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    expect(v.visibleRange.to).toBeCloseTo(18_000_000 + 3 * INTERVAL, 0);
  });

  it('zoomAt changes range', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    const before = { ...v.visibleRange };

    v.zoomAt(9_000_000, 0.5); // zoom in
    expect(v.visibleRange.to - v.visibleRange.from).toBeLessThan(before.to - before.from);
  });

  it('pan shifts range', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    // Zoom in so there is room to pan without hitting the right-edge clamp.
    v.zoomAt(9_000_000, 0.3);
    const before = { ...v.visibleRange };

    v.pan(INTERVAL); // shift by 1 bar — well inside bounds
    expect(v.visibleRange.from).toBeGreaterThan(before.from);
    expect(v.visibleRange.to).toBeGreaterThan(before.to);
    // range width should be preserved
    const widthBefore = before.to - before.from;
    const widthAfter = v.visibleRange.to - v.visibleRange.from;
    expect(widthAfter).toBeCloseTo(widthBefore);
  });

  it('pan past right edge overshoots with rubber-band resistance, capped at 30% of range', () => {
    const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    const widthBefore = v.visibleRange.to - v.visibleRange.from;
    const rightLimit = 18_000_000 + 3 * INTERVAL;
    const maxOvershoot = widthBefore * 0.3;

    // Huge delta — rubber-band damping + the hard overshoot cap keep us inside the soft allowance.
    v.pan(100_000_000);

    expect(v.visibleRange.to).toBeGreaterThan(rightLimit);
    expect(v.visibleRange.to).toBeLessThanOrEqual(rightLimit + maxOvershoot + 1e-6);
    // Width must be preserved — overshoot shifts both edges by the same delta.
    expect(v.visibleRange.to - v.visibleRange.from).toBeCloseTo(widthBefore);
  });

  it('pan past right edge respects pixel-based padding', () => {
    // right: 80px on 800px wide chart ≈ 10% of the current range
    const v = new Viewport({ padding: { right: 80, left: 0 } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    const widthBefore = v.visibleRange.to - v.visibleRange.from;
    const expectedPr = (80 / 800) * widthBefore;
    const rightLimit = 18_000_000 + expectedPr;
    const maxOvershoot = widthBefore * 0.3;

    v.pan(100_000_000, 800);

    expect(v.visibleRange.to).toBeGreaterThan(rightLimit);
    expect(v.visibleRange.to).toBeLessThanOrEqual(rightLimit + maxOvershoot + 1e-6);
    expect(v.visibleRange.to - v.visibleRange.from).toBeCloseTo(widthBefore);
  });

  it('successive pans past the right edge keep shrinking per-step overshoot (rubber feel)', () => {
    const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    const rightLimit = 18_000_000 + 3 * INTERVAL;

    // First pan: not overshooting yet, should accept full delta.
    v.pan(rightLimit - v.visibleRange.to + 100);
    const toAfter1 = v.visibleRange.to;

    // Next pans push further past the edge — each step should produce less movement than the last.
    v.pan(200_000);
    const step1 = v.visibleRange.to - toAfter1;
    v.pan(200_000);
    const step2 = v.visibleRange.to - (toAfter1 + step1);

    expect(step1).toBeGreaterThan(0);
    expect(step2).toBeGreaterThan(0);
    expect(step2).toBeLessThan(step1);
  });

  it('pan below the right limit is not clamped', () => {
    const v = new Viewport({ padding: { right: { intervals: 3 }, left: { intervals: 0 } } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    const before = { ...v.visibleRange };
    // Shift that still leaves us inside the allowed range.
    v.pan(INTERVAL * 2);
    expect(v.visibleRange.to).toBeCloseTo(before.to + 2 * INTERVAL);
    expect(v.visibleRange.from).toBeCloseTo(before.from + 2 * INTERVAL);
  });

  it('pan skips the clamp when right padding is pixel-based and chartWidth is not supplied', () => {
    // resolveHPad collapses pixel padding to 0 when chartWidth <= 0; clamping under
    // that resolution would sit at dataEnd (tighter than configured). The skip keeps
    // pan lenient in that edge case instead of over-clamping.
    const v = new Viewport({ padding: { right: 80, left: 0 } });
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    const before = { ...v.visibleRange };
    // No chartWidth passed — the pan must not collapse to `dataEnd`.
    v.pan(100_000_000);
    expect(v.visibleRange.to).toBeGreaterThan(18_000_000);
    expect(v.visibleRange.to - v.visibleRange.from).toBeCloseTo(before.to - before.from);
  });

  it('pan does not clamp when dataEnd is unset', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    const before = { ...v.visibleRange };
    // No setDataEnd — panning must still work without any known right limit.
    v.pan(5_000_000);
    expect(v.visibleRange.to).toBeCloseTo(before.to + 5_000_000);
    expect(v.visibleRange.from).toBeCloseTo(before.from + 5_000_000);
  });

  it('scrollToEnd pins right edge after animation', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    v.scrollToEnd(20_000_000, 800);
    // Tick past the animation duration (150ms)
    v.tick(performance.now() + 200);
    expect(v.visibleRange.to).toBeGreaterThanOrEqual(20_000_000);
  });

  it('applyRange accepts small datasets (< 10 bars)', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    // 5 bars = 300_000ms range — should be accepted (was rejected before fix)
    v.fitToData(0, 300_000, 800);
    const r = v.visibleRange;
    expect(r.to - r.from).toBeGreaterThan(0);
  });

  it('zoomAt past 10-bar minimum overshoots with rubber-band resistance (never fully rejects)', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    const before = { ...v.visibleRange };
    const softMin = 10 * INTERVAL;
    const minOvershoot = softMin * 0.4; // ZOOM_MIN_OVERSHOOT_FRACTION

    // Zoom in well beyond the 10-bar floor in one shot.
    v.zoomAt(9_000_000, 0.01);

    const newRange = v.visibleRange.to - v.visibleRange.from;
    // Range should have shrunk — zoom is no longer rejected outright.
    expect(newRange).toBeLessThan(before.to - before.from);
    // Hard cap: range never drops below softMin - minOvershoot (the asymptote).
    expect(newRange).toBeGreaterThanOrEqual(softMin - minOvershoot - 1e-6);
    // And it never fully reaches softMin (we're deliberately in overshoot).
    expect(newRange).toBeLessThan(softMin);
  });

  it('successive zoom-in ticks while in overshoot shrink monotonically and never snap back', () => {
    // Regression: earlier implementation recomputed overshoot from the raw
    // `range * factor` each tick, which could make newRange LARGER than the
    // current range when already in overshoot — the "jittery pop-back" bug.
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);

    // Push into overshoot in one tick.
    v.zoomAt(9_000_000, 0.02);
    let prev = v.visibleRange.to - v.visibleRange.from;

    // Continue scrolling the wheel — each tick must keep shrinking (or at
    // worst hold at the asymptote). It must NEVER grow.
    for (let i = 0; i < 10; i++) {
      v.zoomAt(9_000_000, 0.8);
      const cur = v.visibleRange.to - v.visibleRange.from;
      expect(cur).toBeLessThanOrEqual(prev + 1e-6);
      prev = cur;
    }
  });

  it('zoom-out in overshoot snaps back immediately (no resistance on the return path)', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);

    // Zoom deep into overshoot.
    v.zoomAt(9_000_000, 0.01);
    const overshootRange = v.visibleRange.to - v.visibleRange.from;
    const softMin = 10 * INTERVAL;
    expect(overshootRange).toBeLessThan(softMin); // sanity: we are in overshoot

    // User reverses. First zoom-out tick should move us toward softMin, not
    // be dampened by the overshoot-resistance path.
    v.zoomAt(9_000_000, 2.0);
    const afterReverse = v.visibleRange.to - v.visibleRange.from;
    // Range should have roughly doubled (full factor applied).
    expect(afterReverse).toBeCloseTo(overshootRange * 2, -3);
  });

  it('scrollToEnd mid-animation retargets without restarting animStartTime', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    // Set a non-zero initial range so fitToData animated branch triggers
    v.fitToData(1_000_000, 18_000_000, 800);
    // Start a 450ms animation via animated fitToData
    v.fitToData(1_000_000, 20_000_000, 800, true);
    expect(v.animating).toBe(true);
    const startTime = performance.now();

    // Retarget: continues the in-flight ease-out (no fresh 150ms beat).
    v.scrollToEnd(22_000_000, 800);
    // Tick past the original 450ms horizon — animation finishes along that
    // trajectory, with the retargeted end point.
    v.tick(startTime + 500);
    expect(v.animating).toBe(false);
    expect(v.visibleRange.to).toBeGreaterThanOrEqual(22_000_000 - 1);
  });

  it('scrollToEnd with sub-threshold delta is a no-op while idle', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    expect(v.animating).toBe(false);
    // scrollToEnd re-applies padding; target shift matches (lastTime - prevLast).
    // Pending of ~1ms — well below the half-bar / 4px threshold.
    v.scrollToEnd(18_000_000 + 1, 800);
    expect(v.animating).toBe(false);
  });

  it('scrollToEnd with sub-threshold retarget lets the in-flight animation finish', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    // Start a real auto-scroll animation with a visible delta.
    v.scrollToEnd(20_000_000, 800);
    expect(v.animating).toBe(true);
    const animStart = performance.now();

    // Retarget with sub-threshold delta — should NOT kick animStartTime.
    // We detect this by confirming the animation still finishes in roughly
    // ANIM.streamTick (250 ms) from the ORIGINAL start.
    v.scrollToEnd(20_000_000 + INTERVAL * 0.1, 800);
    v.tick(animStart + 260);
    expect(v.animating).toBe(false);
  });

  it('getVisibleBarsCount returns correct count', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    const bars = v.getVisibleBarsCount();
    expect(bars).toBeGreaterThan(0);
  });

  it('pan emits interact event', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    let interacts = 0;
    v.on('interact', () => {
      interacts++;
    });
    v.pan(INTERVAL);
    expect(interacts).toBe(1);
  });

  it('zoomAt emits interact event', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.fitToData(0, 18_000_000, 800);
    let interacts = 0;
    v.on('interact', () => {
      interacts++;
    });
    v.zoomAt(9_000_000, 0.5);
    expect(interacts).toBe(1);
  });

  it('zoomAt on zoom-in pins the right edge of the visible range', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    const rightBefore = v.visibleRange.to;

    // Zoom-in at a cursor mid-range — right edge must stay pinned even though
    // a pure cursor-anchored zoom would have pulled the window left.
    const cursor = v.visibleRange.from + (v.visibleRange.to - v.visibleRange.from) * 0.5;
    v.zoomAt(cursor, 0.5);

    expect(v.visibleRange.to).toBeCloseTo(rightBefore, -1);
    // Range shrank (actual zoom happened).
    expect(v.visibleRange.to - v.visibleRange.from).toBeLessThan(rightBefore);
  });

  it('zoom-in never moves the right edge left past the current right edge (auto-scroll guardrail)', () => {
    // Regression: partial dataEnd-bias (max 0.7) could land newTo slightly left
    // of the current right edge when the cursor was in the middle of the visible
    // range. That dropped the last candle out of view, which broke
    // isLastPointVisible() and stopped live auto-scroll on candlestick charts.
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    const { to: rightBefore } = v.visibleRange;

    // Zoom-in at a cursor in the middle of the visible range.
    const cursor = v.visibleRange.from + (v.visibleRange.to - v.visibleRange.from) * 0.5;
    v.zoomAt(cursor, 0.5);

    // Right edge must never move left — otherwise the last point falls outside
    // the visible range and streaming updates stop tracking it.
    expect(v.visibleRange.to).toBeGreaterThanOrEqual(rightBefore - 1e-6);
    // And the data-end point must still be inside the new visible range.
    expect(v.visibleRange.to).toBeGreaterThanOrEqual(18_000_000);
  });

  it('zoom-out keeps the cursor anchored when the result stays inside soft bounds', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.2); // zoom-in — pins right edge to softRight
    // Pan left far enough that a 1.2x zoom-out stays inside soft bounds and no clamping fires.
    v.pan(-15 * INTERVAL, 800);
    const rangeBefore = v.visibleRange.to - v.visibleRange.from;
    const fromBefore = v.visibleRange.from;
    const cursor = fromBefore + rangeBefore * 0.3;

    // Gentle zoom-out — new right edge stays below softRight, so no clamp fires
    // and the cursor's relative position is preserved.
    v.zoomAt(cursor, 1.2);

    const rangeAfter = v.visibleRange.to - v.visibleRange.from;
    const cursorRatioAfter = (cursor - v.visibleRange.from) / rangeAfter;
    expect(cursorRatioAfter).toBeCloseTo(0.3, 5);
    expect(rangeAfter).toBeGreaterThan(rangeBefore);
  });

  it('zoom-out clamps the right edge into soft bounds (no empty space beyond dataEnd)', () => {
    // Regression: without clamping, a zoom-out with cursor near the left pushed
    // newTo far past dataEnd + rightPad, revealing empty space. startRebound
    // then snapped it back, producing a jarring "zoom then force-scroll".
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3); // zoom-in
    // Cursor near the left so cursor-anchored zoom-out would blow up the right edge.
    const cursor = v.visibleRange.from + (v.visibleRange.to - v.visibleRange.from) * 0.05;

    v.zoomAt(cursor, 2.0);

    // Right edge never extends past softRight (= dataEnd + 3*INTERVAL).
    expect(v.visibleRange.to).toBeLessThanOrEqual(18_000_000 + 3 * INTERVAL + 1e-6);
  });

  it('zoom-out is hard-capped at the padded data span (no infinite zoom-out)', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);

    // Aggressive zoom-out factor — must cap at (dataSpan + leftPad + rightPad).
    v.zoomAt(9_000_000, 100);

    const range = v.visibleRange.to - v.visibleRange.from;
    const maxAllowed = 18_000_000 + 3 * INTERVAL; // dataSpan + rightPad (leftPad=0)
    expect(range).toBeCloseTo(maxAllowed, -1);
    // Further zoom-out is a no-op at the cap.
    v.zoomAt(9_000_000, 10);
    const rangeAfter = v.visibleRange.to - v.visibleRange.from;
    expect(rangeAfter).toBeCloseTo(maxAllowed, -1);
  });

  it('zoom does NOT disable auto-scroll (it is reserved for pan / scrollToEnd)', () => {
    // Regression: earlier zoomAt flipped _autoScroll to false on every tick.
    // Result: a wheel zoom during streaming silently broke the live-tail pin.
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    expect(v.autoScroll).toBe(true);

    v.zoomAt(9_000_000, 0.5); // zoom-in — must not touch autoScroll
    expect(v.autoScroll).toBe(true);

    v.zoomAt(9_000_000, 1.5); // zoom-out — same
    expect(v.autoScroll).toBe(true);

    // A pan large enough to push the last point off screen disables
    // auto-scroll. Separate coverage in viewport-autoscroll-pan.test.ts
    // confirms small pans that keep the last point in view leave it on.
    v.pan(-100 * INTERVAL, 800);
    expect(v.autoScroll).toBe(false);
  });

  it('startRebound is a no-op when already inside soft bounds', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.startRebound(800);
    expect(v.animating).toBe(false);
  });

  it('startRebound animates back to right soft bound after pan overshoot', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3); // zoom in so we have pan headroom
    v.pan(50_000_000, 800); // overshoot right

    expect(v.visibleRange.to).toBeGreaterThan(18_000_000 + 3 * INTERVAL);
    v.startRebound(800);
    expect(v.animating).toBe(true);

    // Tick past rebound duration — final range should sit inside soft bounds.
    v.tick(performance.now() + REBOUND_DURATION_MS + 50);
    expect(v.animating).toBe(false);
    expect(v.visibleRange.to).toBeLessThanOrEqual(18_000_000 + 3 * INTERVAL + 1e-6);
  });

  it('pan during rebound cancels the animation (user keeps interacting)', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    v.pan(50_000_000, 800);
    v.startRebound(800);
    expect(v.animating).toBe(true);

    // New user gesture — rebound must yield immediately.
    v.pan(-INTERVAL, 800);
    expect(v.animating).toBe(false);
  });

  it('zoom during rebound cancels the animation', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.01); // massive overzoom-in → rubber band active
    v.startRebound(800);
    expect(v.animating).toBe(true);

    v.zoomAt(9_000_000, 0.5);
    expect(v.animating).toBe(false);
  });

  it('startRebound emits edgeReached when overshoot exceeds 10% of range', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    v.pan(50_000_000, 800); // large right overshoot

    const events: Array<{ side: string; overshoot: number; boundaryTime: number }> = [];
    v.on('edgeReached', (info) => events.push(info));
    v.startRebound(800);
    expect(events).toHaveLength(1);
    expect(events[0].side).toBe('right');
    expect(events[0].overshoot).toBeGreaterThan(0);
    expect(events[0].boundaryTime).toBe(18_000_000 + 3 * INTERVAL);
  });

  it('startRebound does not emit edgeReached for sub-threshold overshoot', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.3);
    // Tiny overshoot — well below 10% of visible range.
    v.pan(INTERVAL * 0.05, 800);
    const overshootBefore = v.visibleRange.to - (18_000_000 + 3 * INTERVAL);

    const events: Array<{ side: string }> = [];
    v.on('edgeReached', (info) => events.push(info));
    v.startRebound(800);
    // Either no overshoot or overshoot is sub-threshold — either way: no event.
    expect(events).toHaveLength(0);
    // Sanity: we did not actually exceed 10% — otherwise the test premise is wrong.
    expect(Math.max(0, overshootBefore)).toBeLessThan((v.visibleRange.to - v.visibleRange.from) * 0.1);
  });

  it('startRebound after zoom-in overshoot clamps range to softMin', () => {
    const v = new Viewport();
    v.setDataInterval(INTERVAL);
    v.setDataStart(0);
    v.setDataEnd(18_000_000);
    v.fitToData(0, 18_000_000, 800);
    v.zoomAt(9_000_000, 0.01); // zoom in past the 10-bar floor
    const rangeAfterZoom = v.visibleRange.to - v.visibleRange.from;
    expect(rangeAfterZoom).toBeLessThan(10 * INTERVAL);

    v.startRebound(800);
    v.tick(performance.now() + REBOUND_DURATION_MS + 50);
    const rangeAfterRebound = v.visibleRange.to - v.visibleRange.from;
    expect(rangeAfterRebound).toBeCloseTo(10 * INTERVAL, 0);
  });
});

const REBOUND_DURATION_MS = 350;
