import type { TimeScale } from '../scales/time-scale';
import type { PanZoomTarget } from './pan-zoom-target';

export class PanHandler {
  private dragging = false;
  private lastX = 0;

  constructor(
    private target: PanZoomTarget,
    private timeScale: TimeScale,
    private canvas: HTMLCanvasElement,
  ) {}

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
    this.target.pan(timeDelta, this.timeScale.getMediaWidth());
  }

  handleMouseUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = 'crosshair';
    // Pan release no longer snaps the viewport back. Phase 2 step 2 removes
    // rebound entirely — the viewport stays where the user left it; the
    // engine's gesture event already eased the visual to the committed
    // logical, and streaming returns to tail-tracking via
    // `AutoscrollController.tick`.
  }

  isDragging(): boolean {
    return this.dragging;
  }
}
