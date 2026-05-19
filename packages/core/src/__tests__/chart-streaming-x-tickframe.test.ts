// @vitest-environment happy-dom
/**
 * Regression for "X axis labels (DOM `<span>`s) judder during a streaming
 * slide while the canvas slides smoothly".
 *
 * Root cause: `renderMain` only emits `tickFrame` (which DOM axis
 * components subscribe to as their per-frame re-render trigger) when one
 * of the tick trackers is mid-fade. During an X-only slide that doesn't
 * cross a tick boundary, no tick is fading, so `tickFrame` stays silent
 * for the entire slide window. Canvas paints every frame (driven by the
 * engine's RAF chain), but React-rendered axis labels hold whatever
 * `timeScale.timeToX(time)` value they computed at slide-start until the
 * next event lands — visible as labels frozen-then-snapping while the
 * canvas glides past them.
 *
 * The fix expands `tickFrame` to fire whenever the engine's animation
 * state is `animating`. This keeps the canvas-vs-DOM axes in lockstep
 * regardless of whether a tick happens to be fading.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartInstance } from '../chart';

const INTERVAL = 60_000;

function installRaf(): { flush: (frames?: number) => void; uninstall: () => void } {
  let nextId = 1;
  let now = 0;
  let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  const origRaf = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    queue = queue.filter((f) => f.id !== id);
  };
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);

  return {
    flush: (frames = 1) => {
      for (let i = 0; i < frames; i++) {
        if (queue.length === 0) return;
        const pending = queue;
        queue = [];
        now += 16;
        for (const f of pending) f.cb(now);
      }
    },
    uninstall: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancel;
      spy.mockRestore();
      queue = [];
    },
  };
}

function makeChart(): { chart: ChartInstance; container: HTMLElement } {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(container);
  const chart = new ChartInstance(container, { interactive: false });

  return { chart, container };
}

describe('streaming X slide — DOM re-render trigger fires per animating frame', () => {
  let raf: ReturnType<typeof installRaf>;
  let chart: ChartInstance;
  let container: HTMLElement;

  beforeEach(() => {
    raf = installRaf();
    ({ chart, container } = makeChart());
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
    raf.uninstall();
  });

  it('tickFrame fires once per RAF while the X animator is in flight (covers tick-non-fading windows)', () => {
    const id = chart.addLineSeries();
    // 30 bars at INTERVAL = 60_000 ms. Default ticksMs ~ 250 ms, so after
    // the initial-paint settle the tick trackers are not animating.
    chart.setSeriesData(
      id,
      Array.from({ length: 30 }, (_, i) => ({ time: 1_000_000 + i * INTERVAL, value: 50 + Math.sin(i) * 5 })),
    );
    raf.flush(60); // settle initial paint AND any tick-tracker fade-in

    let tickFrameCount = 0;
    chart.on('tickFrame', () => {
      tickFrameCount += 1;
    });

    // Append a single bar. The engine starts an X retarget; the slide rides
    // `animations.axis.x.settle` (200 ms by default) but is extended to the
    // EMA-smoothed producer cadence after a couple of observes — either way
    // the engine reports `animating = true` for many frames after this call.
    chart.appendData(id, { time: 1_000_000 + 30 * INTERVAL, value: 60 });

    // Flush frames one at a time; count how many of them ran with the engine
    // still in flight AND emitted a `tickFrame`. We don't bake in an exact
    // expected count because the engine's animator and the tick trackers
    // run independently — instead, the contract is: every animating frame
    // gets a `tickFrame` (within a couple frames of slack at the boundary).
    const FRAMES = 20;
    let animatingFrames = 0;
    for (let i = 0; i < FRAMES; i++) {
      const beforeAnimating = chart.getAnimationState().animating;
      raf.flush(1);
      if (beforeAnimating) animatingFrames += 1;
    }

    // Sanity: the slide is long enough that we observed a healthy number of
    // animating frames. Without this, the assertion below could silently
    // pass against a degenerate "no animation at all" path.
    expect(animatingFrames).toBeGreaterThan(FRAMES / 2);

    // Contract: re-render triggers land on every animating frame (within
    // a couple frames of slack for the start/end boundary). On HEAD the
    // count tracks tick-tracker fade activity instead — substantially
    // lower than `animatingFrames` once the initial tick-fade settles.
    expect(
      tickFrameCount,
      `tickFrameCount=${tickFrameCount} animatingFrames=${animatingFrames}`,
    ).toBeGreaterThanOrEqual(animatingFrames - 2);
  });
});
