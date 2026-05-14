/**
 * AutoscrollController — wires the viewport's tail-follow reengagement check
 * into the chart's RAF loop, feeding the *logical* X target sourced from
 * the bridge (not the visual `state.xRange`).
 */
import { describe, expect, it, vi } from 'vitest';

import { createAnimationEngine } from '../../../animation/engine';
import type { Transition } from '../../../animation/transition';
import { AnimationBridge } from '../../../chart/animation-bridge';
import { AutoscrollController, type AutoscrollViewport } from '../../../chart/autoscroll-controller';
import type { VisibleRange } from '../../../types';

function makeNoopTransition(): Transition {
  return {
    get current() {
      return { min: 0, max: 0 };
    },
    get target() {
      return { min: 0, max: 0 };
    },
    get animating() {
      return false;
    },
    retarget() {},
    snap() {},
    tick() {
      return false;
    },
  };
}

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

function makeBridge(): AnimationBridge {
  const engine = createAnimationEngine({
    initial: { yRange: { min: 0, max: 0 }, xRange: { from: 0, to: 0 } },
    yTransition: makeNoopTransition(),
  });

  return new AnimationBridge({ engine });
}

describe('AutoscrollController', () => {
  it('forwards `bridge.lastXTarget` (LOGICAL) to the viewport when present', () => {
    const viewport = makeViewport({ from: 0, to: 100 });
    const bridge = makeBridge();
    bridge.lastXTarget = { from: 50, to: 150 };

    const controller = new AutoscrollController({ viewport, bridge });
    controller.tick(200);

    expect(viewport.calls).toHaveLength(1);
    expect(viewport.calls[0]).toEqual({
      dataEnd: 200,
      logicalTarget: { from: 50, to: 150 },
    });
  });

  it('falls back to viewport.logicalRange when the bridge has not seen an X emit yet', () => {
    const viewport = makeViewport({ from: 100, to: 200 });
    const bridge = makeBridge();
    // bridge.lastXTarget is null by default.

    const controller = new AutoscrollController({ viewport, bridge });
    controller.tick(220);

    expect(viewport.calls[0].logicalTarget).toEqual({ from: 100, to: 200 });
  });

  it('skips the call entirely when dataEnd is null', () => {
    const viewport = makeViewport({ from: 0, to: 100 });
    const bridge = makeBridge();
    const spy = vi.spyOn(viewport, 'checkAutoScrollReengagement');

    const controller = new AutoscrollController({ viewport, bridge });
    controller.tick(null);

    expect(spy).not.toHaveBeenCalled();
  });
});
