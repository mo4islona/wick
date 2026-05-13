/**
 * Initial-mount frame audit — regression coverage for the "canvas paints,
 * then axes appear, then everything shifts" sequence.
 *
 * The Overview pattern is: data starts empty, then `setData(history)` fires
 * after a delay. The visible contract this test pins:
 *   1. Empty-data mount paints no YLabel and no YAxis tick spans.
 *   2. The first paint after history loads brings YLabel **and** YAxis
 *      labels up together (no 1-RAF gap where one is in DOM but the
 *      other isn't).
 *   3. Once that paint lands, subsequent RAFs leave the DOM alone — no
 *      "everything moves down" reflow on the next frame.
 */
import { CandlestickSeries, ChartContainer, TimeAxis, YAxis, YLabel } from '@wick-charts/react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { flushRaf, installRaf, pendingRaf, uninstallRaf } from '../helpers/raf';

afterEach(() => {
  try {
    uninstallRaf();
  } catch {
    /* not installed */
  }
});

const INTERVAL = 60_000;
const buildOhlc = (count: number, startTime = 1_000_000) =>
  Array.from({ length: count }, (_, i) => {
    const open = 50 + Math.sin(i / 3) * 10;
    const close = open + Math.cos(i / 4) * 5;
    const high = Math.max(open, close) + 2;
    const low = Math.min(open, close) - 2;
    return { time: startTime + i * INTERVAL, open, high, low, close };
  });

function mockBoundingRect(el: HTMLElement, w: number, h: number): void {
  el.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: h,
    right: w,
    width: w,
    height: h,
    toJSON: () => ({}),
  });
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
}

interface FrameState {
  ylabelTop: string | null;
  yAxisLabels: string[];
}

function readFrame(host: HTMLElement): FrameState {
  let ylabelTop: string | null = null;
  for (const div of host.querySelectorAll('div')) {
    const style = (div as HTMLElement).style;
    if (style.right === '4px' && style.transform.includes('translateY')) {
      ylabelTop = style.top;
      break;
    }
  }
  const yAxisHost = host.querySelector('div[style*="right: 0px"][style*="width: 55px"]');
  const yAxisLabels = Array.from(yAxisHost?.querySelectorAll('span') ?? []).map(
    (span) => `${span.textContent}@${(span as HTMLElement).style.top}`,
  );

  return { ylabelTop, yAxisLabels };
}

describe('initial mount — frame-by-frame DOM stability', () => {
  it('YLabel and YAxis labels surface in the same paint when history arrives', () => {
    const history = buildOhlc(50);

    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '400px';
    mockBoundingRect(host, 800, 400);
    document.body.appendChild(host);

    const origRect = HTMLDivElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = function patched() {
      const r = origRect.call(this);
      if (r.width > 0 && r.height > 0) return r;
      if (this === host || host.contains(this)) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 400,
          right: 800,
          width: 800,
          height: 400,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return r;
    };

    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true, writable: true });
    installRaf();

    try {
      const Wrapper = ({ data }: { data: typeof history }) => (
        <ChartContainer>
          <CandlestickSeries id="c" data={data} />
          <YLabel seriesId="c" />
          <YAxis />
          <TimeAxis />
        </ChartContainer>
      );

      let rerender: (ui: React.ReactElement) => void;

      // Mount with empty data — no series-driven overlays should render.
      act(() => {
        const r = render(<Wrapper data={[]} />, { container: host });
        rerender = r.rerender;
      });
      const emptyFrame = readFrame(host);
      expect(emptyFrame.ylabelTop).toBeNull();
      expect(emptyFrame.yAxisLabels).toEqual([]);

      // Drain whatever RAFs the empty mount queued.
      while (pendingRaf() > 0) act(() => flushRaf(1));

      // History arrives. After the React commit (BEFORE the next RAF) YLabel
      // *and* the YAxis tick labels must both be present — this pins the
      // "first-paint sync" contract. Without the sync render the YAxis spans
      // would only show up on the next RAF, producing the visible jump.
      act(() => rerender!(<Wrapper data={history} />));
      const postCommit = readFrame(host);
      expect(postCommit.ylabelTop).not.toBeNull();
      expect(postCommit.yAxisLabels.length).toBeGreaterThan(0);

      // After the very next RAF (which is what the chart's render scheduler
      // would have queued anyway), the DOM must be stable — no follow-up
      // reflow that shifts positions.
      const beforeRaf = postCommit;
      while (pendingRaf() > 0) act(() => flushRaf(1));
      const settled = readFrame(host);

      expect(settled.ylabelTop).toBe(beforeRaf.ylabelTop);
      expect(settled.yAxisLabels).toEqual(beforeRaf.yAxisLabels);
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = origRect;
      host.remove();
      uninstallRaf();
    }
  });
});
