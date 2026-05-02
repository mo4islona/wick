import { Crosshair, LineSeries } from '@wick-charts/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mountChart } from '../helpers/mount-chart';

const DATA: [Array<{ time: number; value: number }>] = [
  [
    { time: 1, value: 10 },
    { time: 2, value: 30 },
    { time: 3, value: 50 },
    { time: 4, value: 70 },
    { time: 5, value: 90 },
  ],
];

function getCrosshairBadges(mounted: ReturnType<typeof mountChart>): HTMLElement[] {
  const overlay = mounted.container.querySelector('[data-chart-series-overlay]') as HTMLElement | null;
  if (!overlay) return [];

  return Array.from(overlay.querySelectorAll<HTMLElement>('div')).filter(
    (el) => el.style.transform === 'translateY(-50%)' || el.style.transform === 'translateX(-50%)',
  );
}

describe('<Crosshair>', () => {
  let mounted: ReturnType<typeof mountChart> | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('renders nothing before any pointer interaction (null position branch)', () => {
    mounted = mountChart(
      <>
        <LineSeries data={DATA} />
        <Crosshair />
      </>,
      { width: 400, height: 240 },
    );

    expect(getCrosshairBadges(mounted)).toHaveLength(0);
  });

  it('mounts the Y- and time-axis labels after a mousemove', () => {
    mounted = mountChart(
      <>
        <LineSeries data={DATA} />
        <Crosshair />
      </>,
      { width: 400, height: 240 },
    );

    mounted.dispatchMouse('mousemove', { clientX: 200, clientY: 120 }, mounted.overlayCanvas);
    mounted.flushScheduler();

    const badges = getCrosshairBadges(mounted);
    expect(badges).toHaveLength(2);

    const yLabel = badges.find((el) => el.style.transform === 'translateY(-50%)');
    const timeLabel = badges.find((el) => el.style.transform === 'translateX(-50%)');
    expect(yLabel, 'Y-axis label badge').toBeDefined();
    expect(timeLabel, 'time-axis label badge').toBeDefined();

    expect(yLabel!.style.position).toBe('absolute');
    expect(yLabel!.style.right).toBe('0px');
    expect(timeLabel!.style.position).toBe('absolute');
    expect(timeLabel!.style.bottom).toBe('0px');
  });

  it('positions labels at the crosshair coordinates from the chart', () => {
    mounted = mountChart(
      <>
        <LineSeries data={DATA} />
        <Crosshair />
      </>,
      { width: 400, height: 240 },
    );

    mounted.dispatchMouse('mousemove', { clientX: 250, clientY: 100 }, mounted.overlayCanvas);
    mounted.flushScheduler();

    const pos = mounted.chart.getCrosshairPosition();
    expect(pos).not.toBeNull();

    const badges = getCrosshairBadges(mounted);
    const yLabel = badges.find((el) => el.style.transform === 'translateY(-50%)')!;
    const timeLabel = badges.find((el) => el.style.transform === 'translateX(-50%)')!;

    expect(Number.parseFloat(yLabel.style.top)).toBeCloseTo(pos!.mediaY, 0);
    expect(Number.parseFloat(timeLabel.style.left)).toBeCloseTo(pos!.mediaX, 0);
  });

  it('inherits typography + theme tokens for label styling', () => {
    mounted = mountChart(
      <>
        <LineSeries data={DATA} />
        <Crosshair />
      </>,
      { width: 400, height: 240 },
    );

    mounted.dispatchMouse('mousemove', { clientX: 200, clientY: 120 }, mounted.overlayCanvas);
    mounted.flushScheduler();

    const theme = mounted.chart.getTheme();
    const yLabel = getCrosshairBadges(mounted).find((el) => el.style.transform === 'translateY(-50%)')!;

    expect(yLabel.style.color).toBe(theme.crosshair.labelTextColor);
    // happy-dom re-quotes font-family tokens — assert presence of the first
    // family name rather than comparing whole strings byte-for-byte.
    const firstFamily = theme.typography.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    expect(yLabel.style.fontFamily).toContain(firstFamily);
    expect(yLabel.style.fontSize).toBe(`${theme.axis.fontSize}px`);
    expect(yLabel.style.pointerEvents).toBe('none');
    expect(yLabel.style.zIndex).toBe('2');
  });
});
