import type { TimeScale } from '../scales/time-scale';
import type { Viewport } from '../viewport';

export class ZoomHandler {
  constructor(
    private viewport: Viewport,
    private timeScale: TimeScale,
  ) {}

  handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const delta = normalizeWheelDelta(e.deltaY, e.deltaMode);

    // Smooth proportional zoom: small trackpad gestures = small zoom.
    const sensitivity = 0.005;
    const factor = Math.exp(delta * sensitivity);

    // Clamp offsetX to chart area (exclude Y axis).
    const chartWidth = this.timeScale.getMediaWidth();
    const x = Math.min(e.offsetX, chartWidth);
    const cursorTime = this.timeScale.xToTime(x);

    this.viewport.zoomAt(cursorTime, factor, chartWidth);
  }

  /** Kept for API parity with InteractionHandler.destroy. Phase 2 step 2
   *  removed the wheel-idle rebound timer alongside the rest of the
   *  rebound feature; this is now a no-op. */
  cancelPendingRebound(): void {}
}

function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return deltaY * 8;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return deltaY * 24;
  // DOM_DELTA_PIXEL — already in pixels, just dampen large values.
  return deltaY;
}
