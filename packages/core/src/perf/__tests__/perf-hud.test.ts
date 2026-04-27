// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { PerfHud } from '../perf-hud';
import { PerfMonitor } from '../perf-monitor';

describe('PerfHud', () => {
  let container: HTMLElement;

  afterEach(() => {
    container?.remove();
  });

  it('mounts a single overlay element in the container', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const monitor = new PerfMonitor();

    const hud = new PerfHud(container, monitor);

    expect(container.querySelectorAll('[data-chart-perf-hud]')).toHaveLength(1);

    hud.destroy();
    monitor.destroy();
  });

  /**
   * Regression: React StrictMode mounts `ChartContainer`'s useLayoutEffect
   * twice. The existing ChartInstance-orphan pattern leaves the first chart's
   * DOM artifacts attached to the container so chart state survives the
   * remount — which meant the first HUD also stayed, and the second HUD
   * rendered on top of it, visibly double-printing text like "FPS: 101".
   * PerfHud now strips any stale `[data-chart-perf-hud]` before appending.
   */
  it('does not stack when a second HUD is mounted into the same container', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const firstMonitor = new PerfMonitor();
    const secondMonitor = new PerfMonitor();

    // Simulate StrictMode: first HUD mounts, the orphan pattern leaves it
    // attached, then a second HUD mounts into the same container.
    new PerfHud(container, firstMonitor);
    const second = new PerfHud(container, secondMonitor);

    expect(container.querySelectorAll('[data-chart-perf-hud]')).toHaveLength(1);

    second.destroy();
    firstMonitor.destroy();
    secondMonitor.destroy();
  });

  it('removes its element on destroy', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const monitor = new PerfMonitor();

    const hud = new PerfHud(container, monitor);
    hud.destroy();

    expect(container.querySelectorAll('[data-chart-perf-hud]')).toHaveLength(0);
    monitor.destroy();
  });

  it('shows "idle" rows for layers that have not drawn yet', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const monitor = new PerfMonitor();

    // updateIntervalMs=0 so the first frame writes to the DOM immediately.
    const hud = new PerfHud(container, monitor, 0);

    monitor.recordFrame('main', 8, 100);
    monitor.recordFrame('main', 8, 116);

    const text = container.querySelector('[data-chart-perf-hud]')!.textContent ?? '';
    // Header + main row are populated; overlay never drew, so it falls back
    // to `idleRow` (placeholder dashes + "idle" calls/s).
    expect(text).toMatch(/FPS/);
    expect(text).toMatch(/^Main\b/m);
    expect(text).toMatch(/Overlay.*idle/);

    hud.destroy();
    monitor.destroy();
  });

  it('formats live rows for both layers and includes a per-series breakdown when >1 series', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const monitor = new PerfMonitor();
    const hud = new PerfHud(container, monitor, 0);

    // Two main frames so FPS can be derived from the inter-stamp delta.
    monitor.drawCallsMain.set('candlestick', 120);
    monitor.recordSeries('candlestick', 4, 100);
    monitor.recordSeries('line', 2, 100);
    monitor.recordFrame('main', 6, 100);
    monitor.drawCallsMain.set('candlestick', 80);
    monitor.recordSeries('candlestick', 4, 116);
    monitor.recordSeries('line', 2, 116);
    monitor.recordFrame('main', 5, 116);

    monitor.drawCallsOverlay.set('crosshair', 30);
    monitor.recordFrame('overlay', 1, 105);
    monitor.recordFrame('overlay', 1, 121);

    const text = container.querySelector('[data-chart-perf-hud]')!.textContent ?? '';
    // No "idle" markers — both layers have real numbers now.
    expect(text).not.toMatch(/idle/);
    // Per-series breakdown only renders for >1 series and lists each id.
    expect(text).toContain('Per series (main pass)');
    expect(text).toContain('candlestick');
    expect(text).toContain('line');

    hud.destroy();
    monitor.destroy();
  });

  it('throttles DOM writes to updateIntervalMs', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const monitor = new PerfMonitor();

    // 10 s update interval — every recorded frame after the first should be
    // suppressed because no clock time has elapsed inside the test.
    const hud = new PerfHud(container, monitor, 10_000);
    const el = container.querySelector('[data-chart-perf-hud]') as HTMLElement;
    const placeholder = el.textContent;

    monitor.recordFrame('main', 8, 100);
    // First frame may or may not pass the throttle gate depending on
    // performance.now() at construction time. The point of the test is the
    // *second* frame: even though stats changed, the DOM must not be rewritten.
    const afterFirst = el.textContent;
    monitor.recordFrame('main', 8, 116);
    const afterSecond = el.textContent;

    expect(afterSecond).toBe(afterFirst);
    // Sanity: at least one of the two writes should still be either the
    // placeholder or a populated string — never undefined.
    expect(afterSecond === placeholder || (afterSecond?.includes('FPS') ?? false)).toBe(true);

    hud.destroy();
    monitor.destroy();
  });
});
