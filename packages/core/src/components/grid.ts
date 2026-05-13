import type { BitmapCoordinateSpace } from '../canvas-manager';
import type { TickTrackerSnapshot } from '../scales/tick-tracker';
import type { TimeScale } from '../scales/time-scale';
import type { YScale } from '../scales/y-scale';
import type { ChartTheme } from '../theme/types';

export interface RenderGridArgs {
  scope: BitmapCoordinateSpace;
  timeScale: TimeScale;
  yScale: YScale;
  theme: ChartTheme;
  /** Faded tick state from `yScale.tickTracker`. */
  yTicks: TickTrackerSnapshot;
  /** Faded tick state from `timeScale.tickTracker`. */
  timeTicks: TickTrackerSnapshot;
}

/**
 * Draw the grid for both axes. Each tick is stroked individually so its
 * `opacity` (from the shared `AxisTickTracker`) can drive `globalAlpha` —
 * new ticks fade in and leaving ticks fade out in lockstep with the DOM
 * labels above them. The per-tick `beginPath`/`stroke` pair costs ≤ ~30
 * stroke calls per axis (typical 5-10 ticks, hard-capped at 50) which is
 * negligible compared to the rest of the main-layer draw.
 */
export function renderGrid({ scope, timeScale, yScale, theme, yTicks, timeTicks }: RenderGridArgs): void {
  const { context, bitmapSize, horizontalPixelRatio } = scope;

  context.save();
  context.strokeStyle = theme.grid.color;
  context.lineWidth = 1;

  if (theme.grid.style === 'dashed') {
    context.setLineDash([4 * horizontalPixelRatio, 4 * horizontalPixelRatio]);
  } else if (theme.grid.style === 'dotted') {
    context.setLineDash([1 * horizontalPixelRatio, 3 * horizontalPixelRatio]);
  }

  for (const { value, opacity } of yTicks.entries) {
    if (opacity <= 0.01) continue;

    const y = Math.round(yScale.valueToBitmapY(value)) + 0.5;
    context.globalAlpha = opacity;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(bitmapSize.width, y);
    context.stroke();
  }

  for (const { value, opacity } of timeTicks.entries) {
    if (opacity <= 0.01) continue;

    const x = Math.round(timeScale.timeToBitmapX(value)) + 0.5;
    context.globalAlpha = opacity;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, bitmapSize.height);
    context.stroke();
  }

  context.restore();
}
