/**
 * AutoscrollController — wires the viewport's tail-follow reengagement check
 * into the chart's RAF loop, feeding the *logical* X target sourced from
 * the engine (not the visual `state.xRange`).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AutoscrollController,
  type AutoscrollViewport,
  type XTargetSource,
} from '../../../chart/autoscroll-controller';
import type { VisibleRange } from '../../../types';

interface MockViewport extends AutoscrollViewport {
  calls: Array<{ dataEnd: number; logicalTarget: VisibleRange }>;
}

function makeViewport(logical: VisibleRange): MockViewport {
  const calls: MockViewport['calls'] = [];

  return {
    logicalRange: logical,
    checkAutoScrollReengagement(dataEnd, logicalTarget) {
      calls.push({ dataEnd, logicalTarget: { ...logicalTarget } });
    },
    calls,
  };
}

function makeEngineSource(lastXTarget: VisibleRange | null = null): XTargetSource {
  return { lastXTarget };
}

describe('AutoscrollController', () => {
  it('forwards `engine.lastXTarget` (LOGICAL) to the viewport when present', () => {
    const viewport = makeViewport({ from: 0, to: 100 });
    const engine = makeEngineSource({ from: 50, to: 150 });

    const controller = new AutoscrollController({ viewport, engine });
    controller.tick(200);

    expect(viewport.calls).toHaveLength(1);
    expect(viewport.calls[0]).toEqual({
      dataEnd: 200,
      logicalTarget: { from: 50, to: 150 },
    });
  });

  it('falls back to viewport.logicalRange when the engine has not seen an X emit yet', () => {
    const viewport = makeViewport({ from: 100, to: 200 });
    const engine = makeEngineSource(null);

    const controller = new AutoscrollController({ viewport, engine });
    controller.tick(220);

    expect(viewport.calls[0].logicalTarget).toEqual({ from: 100, to: 200 });
  });

  it('skips the call entirely when dataEnd is null', () => {
    const viewport = makeViewport({ from: 0, to: 100 });
    const engine = makeEngineSource(null);
    const spy = vi.spyOn(viewport, 'checkAutoScrollReengagement');

    const controller = new AutoscrollController({ viewport, engine });
    controller.tick(null);

    expect(spy).not.toHaveBeenCalled();
  });
});
