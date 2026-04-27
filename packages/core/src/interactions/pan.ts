import type { TimeScale } from '../scales/time-scale';
import type { Viewport } from '../viewport';

export class PanHandler {
  private dragging = false;
  private lastX = 0;

  constructor(
    private viewport: Viewport,
    private timeScale: TimeScale,
    private canvas: HTMLCanvasElement,
    /**
     * Per-event ease duration for the visual side of pan commits. `0` keeps
     * the legacy instant-apply behaviour. See `ChartOptions.animations.viewport.inputResponseMs`.
     */
    private inputResponseMs = 0,
  ) {}

  /** Update the input-response duration without recreating the handler. */
  setInputResponseMs(ms: number): void {
    this.inputResponseMs = Math.max(0, ms);
  }

  handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.canvas.style.cursor = 'grabbing';
  }

  handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const deltaX = e.clientX - this.lastX;
    this.lastX = e.clientX;
    const timeDelta = this.timeScale.pixelDeltaToTimeDelta(-deltaX);
    this.viewport.pan(timeDelta, this.timeScale.getMediaWidth(), this.inputResponseMs);
  }

  handleMouseUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = 'crosshair';
    // Snap the viewport back into soft bounds if the drag ended past an edge.
    // No-op when the gesture stayed inside bounds.
    this.viewport.startRebound(this.timeScale.getMediaWidth());
  }

  isDragging(): boolean {
    return this.dragging;
  }
}
