/**
 * Regression on the Phase 1 breaking renames. Exercises the public surface
 * via dynamic import so the test fails if a barrel forgets to re-export
 * (or, conversely, leaks one of the old names).
 */
import { describe, expect, it } from 'vitest';

describe('Phase 1 API rename', () => {
  it('exports the new factory names', async () => {
    const mod = await import('../../animation');
    expect(typeof mod.hermite).toBe('function');
    expect(typeof mod.spring).toBe('function');
    expect(typeof mod.snap).toBe('function');
    expect(typeof mod.parseAnimationTime).toBe('function');
  });

  it('does NOT export the legacy factory names', async () => {
    const mod = (await import('../../animation')) as Record<string, unknown>;
    expect(mod.hermiteAnimator).toBeUndefined();
    expect(mod.springAnimator).toBeUndefined();
    expect(mod.snapAnimator).toBeUndefined();
  });

  it('factories return a Transition with the expected shape', async () => {
    const { hermite, spring, snap } = await import('../../animation');
    for (const factory of [hermite, spring, snap]) {
      const t = factory()({ initial: { min: 0, max: 1 } });
      expect(t.current).toEqual({ min: 0, max: 1 });
      expect(t.target).toEqual({ min: 0, max: 1 });
      expect(typeof t.retarget).toBe('function');
      expect(typeof t.snap).toBe('function');
      expect(typeof t.tick).toBe('function');
      expect(typeof t.animating).toBe('boolean');
    }
  });

  it('hermite accepts string time inputs in options', async () => {
    const { hermite } = await import('../../animation');
    // Smoke — would throw inside parseAnimationTime if string parsing was broken.
    expect(() => hermite({ expand: '500ms', contract: '2.5s' })).not.toThrow();
  });

  it('spring accepts string time inputs in options', async () => {
    const { spring } = await import('../../animation');
    expect(() => spring({ expandSpeed: '250ms', contractSpeed: '5s' })).not.toThrow();
  });
});
