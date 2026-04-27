import type { TimeScale } from '../scales/time-scale';
import type { Viewport } from '../viewport';

/** Delay between the last wheel tick and the rebound animation kicking in.
 * Long enough to bridge successive scroll-wheel clicks and trackpad inertia,
 * short enough not to feel laggy after the gesture actually stops. */
const WHEEL_IDLE_REBOUND_MS = 150;

export class ZoomHandler {
  private reboundTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private viewport: Viewport,
    private timeScale: TimeScale,
    /** Per-event ease duration for the visual side of zoom commits. `0` keeps
     * the legacy instant-apply behaviour. */
    private inputResponseMs = 0,
  ) {}

  /** Update the input-response duration without recreating the handler. */
  setInputResponseMs(ms: number): void {
    this.inputResponseMs = Math.max(0, ms);
  }

  /** Read the current input-response duration. Used by sibling gesture paths
   * (touch pinch) so there is one source of truth for the value. */
  getInputResponseMs(): number {
    return this.inputResponseMs;
  }

  handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const delta = normalizeWheelDelta(e.deltaY, e.deltaMode);

    // Smooth proportional zoom: small trackpad gestures = small zoom
    const sensitivity = 0.005;
    const factor = Math.exp(delta * sensitivity);

    // Clamp offsetX to chart area (exclude Y axis)
    const chartWidth = this.timeScale.getMediaWidth();
    const x = Math.min(e.offsetX, chartWidth);
    const cursorTime = this.timeScale.xToTime(x);

    this.viewport.zoomAt(cursorTime, factor, chartWidth, this.inputResponseMs);

    // Debounce: each new wheel tick resets the rebound timer; it fires once the
    // user has been idle for WHEEL_IDLE_REBOUND_MS. Rebound is a no-op when the
    // gesture stayed inside soft bounds.
    if (this.reboundTimer !== null) clearTimeout(this.reboundTimer);
    this.reboundTimer = setTimeout(() => {
      this.reboundTimer = null;
      this.viewport.startRebound(chartWidth);
    }, WHEEL_IDLE_REBOUND_MS);
  }

  /** Cancel any pending rebound — called by InteractionHandler.destroy and when
   * a competing gesture (mousedown, touchstart) takes over. */
  cancelPendingRebound(): void {
    if (this.reboundTimer !== null) {
      clearTimeout(this.reboundTimer);
      this.reboundTimer = null;
    }
  }
}

function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return deltaY * 8;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return deltaY * 24;
  // DOM_DELTA_PIXEL — already in pixels, just dampen large values
  return deltaY;
}
