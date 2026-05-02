import { act, render } from '@testing-library/react';
import { Sparkline, catppuccin } from '@wick-charts/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushAllRaf, installRaf, uninstallRaf } from '../helpers/raf';

/**
 * Sparkline composes its own ChartContainer internally, so these tests bypass
 * the `mountChart` helper (which wraps children in a fresh container) and use
 * plain RTL render against a sized host element.
 */
describe('Sparkline', () => {
  const data = [
    { time: 1, value: 10 },
    { time: 2, value: 14 },
    { time: 3, value: 12 },
    { time: 4, value: 18 },
    { time: 5, value: 16 },
  ];

  let host: HTMLElement;

  function mockSize(el: HTMLElement, width: number, height: number) {
    Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
    el.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: height,
        right: width,
        width,
        height,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  beforeEach(() => {
    installRaf();
    host = document.createElement('div');
    mockSize(host, 200, 60);
    document.body.appendChild(host);

    // Sparkline renders inner divs with width/height styles, not flex sizing —
    // patch descendants so CanvasManager reads non-zero dimensions on mount.
    const origRect = HTMLDivElement.prototype.getBoundingClientRect;
    (host as HTMLElement & { __origRect?: typeof origRect }).__origRect = origRect;
    HTMLDivElement.prototype.getBoundingClientRect = function patched() {
      const r = origRect.call(this);
      if (r.width > 0 && r.height > 0) return r;
      if (host.contains(this)) {
        // Chart wrapper in Sparkline is { width: 140, height: 48 } by default.
        const w = 140;
        const h = 48;
        return { x: 0, y: 0, top: 0, left: 0, bottom: h, right: w, width: w, height: h, toJSON: () => ({}) } as DOMRect;
      }
      return r;
    };
  });

  afterEach(() => {
    const origRect = (host as HTMLElement & { __origRect?: () => DOMRect }).__origRect;
    if (origRect)
      HTMLDivElement.prototype.getBoundingClientRect =
        origRect as typeof HTMLDivElement.prototype.getBoundingClientRect;
    host.remove();
    uninstallRaf();
  });

  it('renders a canvas and records draw calls for line variant', () => {
    act(() => {
      render(<Sparkline data={data} theme={catppuccin.theme} />, { container: host });
    });
    act(() => flushAllRaf());

    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    // getContext('2d') installs the spy; mountChart does this eagerly but we're bypassing it.
    canvas.getContext('2d');
    const spy = canvas.__spy!;
    expect(spy).toBeDefined();
    // Line draws use beginPath + lineTo; zero-axis sparkline skips text calls.
    expect(spy.countOf('lineTo')).toBeGreaterThan(0);
    expect(spy.countOf('fillText')).toBe(0);
    expect(spy.countOf('strokeText')).toBe(0);
  });

  it('renders bar variant with fillRect calls', () => {
    act(() => {
      render(<Sparkline data={data} theme={catppuccin.theme} variant="bar" />, { container: host });
    });
    act(() => flushAllRaf());

    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    canvas.getContext('2d');
    const spy = canvas.__spy!;
    expect(spy.countOf('fillRect')).toBeGreaterThanOrEqual(data.length);
  });

  it('applies custom color to the stroked line', () => {
    act(() => {
      render(<Sparkline data={data} theme={catppuccin.theme} color="#ff00aa" />, { container: host });
    });
    act(() => flushAllRaf());

    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    canvas.getContext('2d');
    const spy = canvas.__spy!;
    const strokes = spy.callsOf('stroke');
    expect(strokes.length).toBeGreaterThan(0);
    // At least one stroke carries the custom color (case-insensitive match).
    const matched = strokes.some((c) => c.strokeStyle.toLowerCase() === '#ff00aa');
    expect(matched).toBe(true);
  });

  it('renders value label when valuePosition is not "none"', () => {
    act(() => {
      render(<Sparkline data={data} theme={catppuccin.theme} label="BTC" valuePosition="right" />, { container: host });
    });
    act(() => flushAllRaf());

    // The label text is rendered in the DOM, not on the canvas.
    expect(host.textContent).toContain('BTC');
  });

  it('omits value block entirely when valuePosition="none"', () => {
    act(() => {
      render(<Sparkline data={data} theme={catppuccin.theme} label="BTC" valuePosition="none" />, { container: host });
    });
    act(() => flushAllRaf());

    expect(host.textContent).not.toContain('BTC');
  });
});
