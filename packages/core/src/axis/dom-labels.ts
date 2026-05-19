/**
 * Framework-agnostic DOM axis-label manager.
 *
 * Owns the `<span>` elements rendered inside a framework-provided container
 * and updates their position / opacity imperatively on every chart event
 * that can affect layout — bypassing the framework's render loop so the
 * labels stay in lockstep with the canvas paint instead of lagging behind
 * an async commit.
 *
 * The helper plugs into the chart's existing `AxisTickTracker` so DOM-label
 * fade-in / fade-out advances frame-for-frame with the canvas grid lines.
 * Container layout (size, anchoring) stays with the caller — the helper
 * only mutates child `<span>`s.
 */

import type { ChartInstance } from '../chart';
import { resolveAxisFontSize, resolveAxisTextColor } from '../theme/resolve';
import { formatTime } from '../utils/time';

export interface MountAxisLabelsOptions {
  readonly chart: ChartInstance;
  /**
   * Caller-owned container. The helper appends `<span>`s as direct children
   * and removes them on cleanup. The container's own layout (positioning,
   * dimensions) is the framework component's responsibility — typically a
   * `position: absolute` rectangle covering one axis strip.
   */
  readonly container: HTMLElement;
  readonly axis: 'x' | 'y';
}

/** Below this opacity the span is removed from the DOM (matches React's prior `opacity <= 0.01` cutoff). */
const VISIBLE_OPACITY_EPS = 0.01;

/**
 * Append axis-label `<span>` children to `container`, keep them positioned
 * and faded in step with the chart's animation. Returns a cleanup function
 * that unsubscribes and removes all created spans.
 */
export function mountAxisLabels(opts: MountAxisLabelsOptions): () => void {
  const { chart, container, axis } = opts;
  const spans = new Map<number, HTMLSpanElement>();
  const tracker = axis === 'x' ? chart.timeScale.tickTracker : chart.yScale.tickTracker;

  function currentTicks(): { ticks: readonly number[]; tickInterval: number } {
    if (axis === 'x') {
      return chart.timeScale.niceTickValues(chart.getDataInterval());
    }

    return { ticks: chart.yScale.niceTickValues(), tickInterval: 0 };
  }

  function formatLabel(value: number, tickInterval: number): string {
    if (axis === 'x') return formatTime(value, tickInterval);

    return chart.yScale.formatY(value);
  }

  function positionSpan(el: HTMLSpanElement, value: number): void {
    if (axis === 'x') {
      el.style.left = `${chart.timeScale.timeToX(value)}px`;

      return;
    }

    el.style.top = `${chart.yScale.valueToY(value)}px`;
  }

  function createSpan(value: number, tickInterval: number): HTMLSpanElement {
    const theme = chart.getTheme();
    const el = document.createElement('span');
    el.textContent = formatLabel(value, tickInterval);
    el.style.position = 'absolute';
    el.style.userSelect = 'none';
    el.style.color = resolveAxisTextColor(theme, axis);
    el.style.fontSize = `${resolveAxisFontSize(theme, axis)}px`;
    el.style.fontFamily = theme.typography.fontFamily;
    el.style.willChange = 'opacity';

    if (axis === 'x') {
      el.style.transform = 'translateX(-50%)';
      el.style.whiteSpace = 'nowrap';
    } else {
      el.style.right = '8px';
      el.style.transform = 'translateY(-50%)';
      el.style.fontVariantNumeric = 'tabular-nums';
    }

    container.appendChild(el);

    return el;
  }

  function sync(): void {
    const { ticks, tickInterval } = currentTicks();
    tracker.setCurrentTicks(ticks);
    const { entries } = tracker.snapshot();

    const seen = new Set<number>();
    for (const { value, opacity } of entries) {
      if (opacity <= VISIBLE_OPACITY_EPS) continue;

      seen.add(value);
      let el = spans.get(value);
      if (el === undefined) {
        el = createSpan(value, tickInterval);
        spans.set(value, el);
      } else {
        const next = formatLabel(value, tickInterval);
        if (el.textContent !== next) el.textContent = next;
      }

      positionSpan(el, value);
      el.style.opacity = String(opacity);
    }

    for (const [value, el] of spans) {
      if (seen.has(value)) continue;
      el.remove();
      spans.delete(value);
    }
  }

  sync();

  chart.on('tickFrame', sync);
  chart.on('viewportChange', sync);
  chart.on('overlayChange', sync);

  return () => {
    chart.off('tickFrame', sync);
    chart.off('viewportChange', sync);
    chart.off('overlayChange', sync);
    for (const el of spans.values()) el.remove();
    spans.clear();
  };
}
