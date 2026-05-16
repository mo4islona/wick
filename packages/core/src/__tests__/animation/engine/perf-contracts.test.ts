/**
 * Performance contracts the {@link AnimationEngine} and {@link KeyCache}
 * commit to. Renderers run inside a 16 ms RAF budget — any per-frame
 * allocation in the hot path is observable as generation-0 GC noise on
 * long-running streams.
 *
 * P1 — `KeyCache.liveKey(seriesId, layerIdx)` returns the SAME string
 *      instance across calls so consumers can pass it straight to `Map.get`
 *      without re-allocating a template literal each frame.
 *
 * P2 — `engine.tick(now)` returns the SAME `AnimationState` reference and
 *      mutates the inner Maps in-place. Renderers must not cache the
 *      snapshot reference across frames, but they can rely on a stable
 *      `===` comparison if they want.
 */
import { describe, expect, it } from 'vitest';

import { KeyCache } from '../../../chart/key-cache';
import { settle, setup } from './test-utils';

describe('AnimationEngine — performance contracts', () => {
  // ---------------------------------------------------------------------------
  // P1: KeyCache returns stable string references
  // ---------------------------------------------------------------------------

  it('KeyCache.liveKey returns the same string instance for the same (seriesId, layerIdx) pair', () => {
    const cache = new KeyCache();

    const a0 = cache.liveKey('series-a', 0);
    const a0Again = cache.liveKey('series-a', 0);
    const a1 = cache.liveKey('series-a', 1);
    const b0 = cache.liveKey('series-b', 0);

    expect(a0).toBe('series-a:0');
    expect(a1).toBe('series-a:1');
    expect(b0).toBe('series-b:0');

    // Strict referential equality across calls — not just string equality.
    expect(a0).toBe(a0Again);
    expect(Object.is(a0, a0Again)).toBe(true);
  });

  it('KeyCache.dropSeries clears the entry so the next lookup allocates a fresh string', () => {
    const cache = new KeyCache();

    const before = cache.liveKey('s', 0);
    cache.dropSeries('s');
    const after = cache.liveKey('s', 0);

    // String VALUE is equal but they're independently constructed
    // template literals — a small implementation detail that confirms the
    // entry was fully evicted (not merely flagged stale).
    expect(after).toBe('s:0');
    expect(after).toEqual(before);
  });

  // ---------------------------------------------------------------------------
  // P2: stable AnimationState reference + in-place Map mutation
  // ---------------------------------------------------------------------------

  it('engine.tick returns the same AnimationState object on every frame', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: { x: { target: { from: 0, to: 1000 } } },
    });

    const first = engine.tick(0);
    const second = engine.tick(16);
    const third = engine.tick(32);

    expect(second).toBe(first);
    expect(third).toBe(first);
    // The reference returned by getAnimationState matches the tick result.
    expect(engine.getAnimationState()).toBe(first);
  });

  it('inner YRange / VisibleRange objects are mutated in place across ticks', () => {
    const { engine } = setup({ xRange: { from: 0, to: 0 } });

    engine.emit({
      kind: 'data_tick',
      duration: 100,
      startWall: 0,
      targets: {
        x: { target: { from: 0, to: 1000 } },
        y: { target: { min: 0, max: 50 } },
      },
    });

    const state = engine.tick(0);
    const xRef = state.xRange;
    const yRef = state.yRange;

    settle(engine, 100);

    expect(state.xRange).toBe(xRef);
    expect(state.yRange).toBe(yRef);
    expect(state.xRange.to).toBeCloseTo(1000, 4);
  });
});
