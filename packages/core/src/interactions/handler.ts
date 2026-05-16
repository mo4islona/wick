import { EventEmitter } from '../events';
import type { TimeScale } from '../scales/time-scale';
import type { YScale } from '../scales/y-scale';
import type { CrosshairPosition } from '../types';
import type { Viewport } from '../viewport';
import { PanHandler } from './pan';
import { ZoomHandler } from './zoom';

interface InteractionEvents {
  crosshairMove: (pos: CrosshairPosition | null) => void;
  click: (pos: CrosshairPosition) => void;
}

export class InteractionHandler extends EventEmitter<InteractionEvents> {
  private zoom: ZoomHandler;
  private pan: PanHandler;
  private canvas: HTMLCanvasElement;
  private timeScale: TimeScale;
  private yScale: YScale;
  private viewport: Viewport;

  constructor(canvas: HTMLCanvasElement, viewport: Viewport, timeScale: TimeScale, yScale: YScale) {
    super();
    this.canvas = canvas;
    this.viewport = viewport;
    this.timeScale = timeScale;
    this.yScale = yScale;
    this.zoom = new ZoomHandler(viewport, timeScale);
    this.pan = new PanHandler(viewport, timeScale, canvas);

    canvas.style.cursor = 'crosshair';
    canvas.style.touchAction = 'none';

    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
    canvas.addEventListener('dblclick', this.onDblClick);

    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
  }

  private onWheel = (e: WheelEvent): void => {
    this.zoom.handleWheel(e);
  };

  private onMouseDown = (e: MouseEvent): void => {
    // A drag takes over from any pending wheel-idle rebound — otherwise the
    // timer would fire mid-drag and snap the viewport back (potentially
    // emitting a bogus edgeReached along the way).
    this.zoom.cancelPendingRebound();
    this.pan.handleMouseDown(e);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.pan.isDragging()) {
      this.pan.handleMouseMove(e);
    }
    this.emitCrosshair(e.offsetX, e.offsetY);
  };

  private onMouseUp = (): void => {
    this.pan.handleMouseUp();
  };

  private onMouseLeave = (): void => {
    this.pan.handleMouseUp();
    this.emit('crosshairMove', null);
  };

  private onDblClick = (): void => {
    // Handled externally via chart.fitContent()
  };

  // Touch handling
  private lastTouchDist = 0;
  private touchCount = 0;

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    // Touch gesture takes over from any pending wheel-idle rebound — see
    // onMouseDown for the same reasoning.
    this.zoom.cancelPendingRebound();
    this.touchCount = e.touches.length;
    if (e.touches.length === 1) {
      this.pan.handleMouseDown({
        button: 0,
        clientX: e.touches[0].clientX,
      } as MouseEvent);
    } else if (e.touches.length === 2) {
      this.lastTouchDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 1 && this.touchCount === 1) {
      this.pan.handleMouseMove({
        clientX: e.touches[0].clientX,
      } as MouseEvent);
    } else if (e.touches.length === 2) {
      const dist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      const center = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const rect = this.canvas.getBoundingClientRect();

      if (this.lastTouchDist > 0) {
        const factor = this.lastTouchDist / dist;
        const centerTime = this.timeScale.xToTime(center - rect.left);
        this.viewport.zoomAt(centerTime, factor, this.timeScale.getMediaWidth());
      }

      this.lastTouchDist = dist;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0) {
      this.pan.handleMouseUp();
      this.touchCount = 0;
      this.lastTouchDist = 0;
      this.emit('crosshairMove', null);
    }
  };

  private emitCrosshair(offsetX: number, offsetY: number): void {
    const time = this.timeScale.xToTime(offsetX);
    const y = this.yScale.yToValue(offsetY);
    this.emit('crosshairMove', {
      mediaX: offsetX,
      mediaY: offsetY,
      time,
      y,
    });
  }

  destroy(): void {
    this.zoom.cancelPendingRebound();
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.removeAllListeners();
  }
}
