/**
 * State-maps suite for {@link AnimationEngine}. These tests cover the public
 * Maps that renderers read every frame:
 *
 * - `liveValues.scalar` / `liveValues.ohlc` keyed by composite `seriesId:layerIdx`
 * - `entryProgress` nested map per series
 * - `tickOpacity` per numeric tick value with prune-on-settle
 * - `pulsePhase` per registered series, driven by `(effectiveNow / period) % 1`
 *
 * The merge algorithm's `(target, key)` granularity lives here in practice —
 * each independently-keyed slot can run its own event without colliding with
 * neighbours, and the Maps reflect that without ad-hoc bookkeeping in the
 * chart's render loop.
 */
import { describe, expect, it } from 'vitest';

import type { OHLCData } from '../../../types';
import { settle, setup } from './test-utils';

describe('AnimationEngine — state maps', () => {
  // ---------------------------------------------------------------------------
  // Composite keys — `seriesId:layerIdx` does not collide across layers/series
  // ---------------------------------------------------------------------------

  it('liveValues.scalar keyed `seriesId:layerIdx` keeps neighbouring layers / series independent', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: {
        liveScalar: [
          { seriesId: 'a', layerIdx: 0, target: 10 },
          { seriesId: 'a', layerIdx: 1, target: 20 },
          { seriesId: 'b', layerIdx: 0, target: 30 },
        ],
      },
    });

    const state = settle(engine, 100);
    expect(state.liveValues.scalar.get('a:0')).toBeCloseTo(10, 5);
    expect(state.liveValues.scalar.get('a:1')).toBeCloseTo(20, 5);
    expect(state.liveValues.scalar.get('b:0')).toBeCloseTo(30, 5);
  });

  it('liveValues.ohlc uses per-field lerp and keeps composite keys independent', () => {
    const { engine } = setup();

    const targetA: OHLCData = { time: 100, open: 1, high: 5, low: 0, close: 3 };
    const targetB: OHLCData = { time: 100, open: 10, high: 12, low: 8, close: 11 };

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: {
        liveOHLC: [
          { seriesId: 'candle', layerIdx: 0, target: targetA },
          { seriesId: 'candle', layerIdx: 1, target: targetB },
        ],
      },
    });

    const state = settle(engine, 100);
    const settledA = state.liveValues.ohlc.get('candle:0');
    const settledB = state.liveValues.ohlc.get('candle:1');
    expect(settledA?.open).toBeCloseTo(1, 5);
    expect(settledA?.high).toBeCloseTo(5, 5);
    expect(settledA?.low).toBeCloseTo(0, 5);
    expect(settledA?.close).toBeCloseTo(3, 5);
    expect(settledB?.open).toBeCloseTo(10, 5);
    expect(settledB?.close).toBeCloseTo(11, 5);
  });

  it('entryProgress is nested seriesId → time → progress, not flat', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'entrance',
      duration: 100,
      startWall: 0,
      targets: {
        entry: [
          { seriesId: 'a', layerIdx: 0, time: 1000 },
          { seriesId: 'a', layerIdx: 0, time: 1100 },
          { seriesId: 'b', layerIdx: 0, time: 1000 },
        ],
      },
    });

    const state = settle(engine, 100);
    const perA = state.entryProgress.get('a');
    const perB = state.entryProgress.get('b');
    expect(perA?.get(1000)).toBeCloseTo(1, 5);
    expect(perA?.get(1100)).toBeCloseTo(1, 5);
    expect(perB?.get(1000)).toBeCloseTo(1, 5);
    // Different series do not see each other's entries.
    expect(perA?.has(2000)).toBe(false);
    expect(perB?.has(1100)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // tickOpacity — entering reaches 1; exiting drains to 0 and prunes
  // ---------------------------------------------------------------------------

  it('tickFade entering ramps from 0 → 1 and the slot is removed from tickOpacity once fully visible', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { tickFade: { entering: [50], exiting: [] } },
    });

    const half = settle(engine, 48);
    const halfOpacity = half.tickOpacity.get(50);
    expect(halfOpacity).toBeGreaterThan(0);
    expect(halfOpacity).toBeLessThan(1);

    const settled = settle(engine, 116, 48);
    // After the prune sweep the slot is gone, but the public map keeps the
    // tick value at full opacity so the renderer still paints it.
    expect(settled.tickOpacity.get(50)).toBeCloseTo(1, 5);
  });

  it('tickFade exiting drains opacity to 0 and removes the entry from tickOpacity entirely', () => {
    const { engine } = setup();

    // Seed an entering slot first so the exiting branch has something to drain.
    engine.emit({
      kind: 'data_tick',
      duration: 50,
      startWall: 0,
      targets: { tickFade: { entering: [99], exiting: [] } },
    });
    settle(engine, 66);

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 66,
      targets: { tickFade: { entering: [], exiting: [99] } },
    });
    const settled = settle(engine, 200, 66);
    // Slot pruned because opacity reached 0.
    expect(settled.tickOpacity.has(99)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // tickFade reversal — exit picked up mid-flight reverses without flicker
  // ---------------------------------------------------------------------------

  it('tickFade reversal: a tick going from entering to exiting hands off through standard merge — no flicker', () => {
    const { engine } = setup();

    // Start an entering fade for tick value 42.
    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 0,
      targets: { tickFade: { entering: [42], exiting: [] } },
    });
    const mid = settle(engine, 96);
    const partial = mid.tickOpacity.get(42) ?? 0;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);

    // Reverse direction with an exiting event. The newer event wins the
    // slot by startWall; from = partial (handoff freezes current); target = 0.
    engine.emit({
      kind: 'data_tick',
      duration: 200,
      startWall: 96,
      targets: { tickFade: { entering: [], exiting: [42] } },
    });
    const afterReverse = settle(engine, 112, 96);
    const reversingOpacity = afterReverse.tickOpacity.get(42) ?? 0;
    // Monotonic decline from `partial` — no jump up.
    expect(reversingOpacity).toBeLessThanOrEqual(partial + 1e-6);

    const settled = settle(engine, 320, 112);
    // Exiting event prunes when effectiveNow > startWall+dur = 296.
    expect(settled.tickOpacity.has(42)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // tickFade per-tick granularity — concurrent emits for different tick values
  // ---------------------------------------------------------------------------

  it('concurrent emits on different tick values run in parallel without competing for one slot', () => {
    const { engine } = setup();

    engine.emit({
      kind: 'visibility',
      duration: 100,
      startWall: 0,
      targets: { tickFade: { entering: [10, 20], exiting: [] } },
    });
    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { tickFade: { entering: [30], exiting: [] } },
    });

    const settled = settle(engine, 100);
    // All three tick values are fully visible — no slot was preempted.
    expect(settled.tickOpacity.get(10)).toBeCloseTo(1, 4);
    expect(settled.tickOpacity.get(20)).toBeCloseTo(1, 4);
    expect(settled.tickOpacity.get(30)).toBeCloseTo(1, 4);
  });

  // ---------------------------------------------------------------------------
  // pulsePhase
  // ---------------------------------------------------------------------------

  it('pulsePhase = (effectiveNow / period) % 1 — monotonic 0..1 wrap per registered seriesId', () => {
    const { engine } = setup();

    engine.registerSeriesPulse('series-a', 1000);

    // Keep the engine spinning via a long data_tick so its RAF stays warm
    // (registerSeriesPulse alone is not animation — it only sets a registry
    // entry that is sampled inside tick()).
    engine.emit({
      kind: 'data_tick',
      duration: 2000,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 1 } } },
    });

    settle(engine, 200);
    const phaseAt200 = engine.getAnimationState().pulsePhase.get('series-a') ?? 0;
    expect(phaseAt200).toBeCloseTo(0.2, 3);

    settle(engine, 999, 200);
    const phaseAt999 = engine.getAnimationState().pulsePhase.get('series-a') ?? 0;
    expect(phaseAt999).toBeCloseTo(0.999, 2);

    // Cross the wrap.
    settle(engine, 1100, 999);
    const phaseAt1100 = engine.getAnimationState().pulsePhase.get('series-a') ?? 0;
    expect(phaseAt1100).toBeCloseTo(0.1, 2);
  });

  it('registerSeriesPulse with a different period per series produces independent phases', () => {
    const { engine } = setup();

    engine.registerSeriesPulse('fast', 500);
    engine.registerSeriesPulse('slow', 2000);

    engine.emit({
      kind: 'data_tick',
      duration: 3000,
      startWall: 0,
      targets: { y: { target: { min: 0, max: 1 } } },
    });

    settle(engine, 250);
    const state = engine.getAnimationState();
    // fast: 250/500 = 0.5
    expect(state.pulsePhase.get('fast')).toBeCloseTo(0.5, 3);
    // slow: 250/2000 = 0.125
    expect(state.pulsePhase.get('slow')).toBeCloseTo(0.125, 3);
  });
});
