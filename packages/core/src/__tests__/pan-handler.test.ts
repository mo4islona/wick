// @vitest-environment happy-dom
// Needs a DOM because PanHandler mutates `canvas.style.cursor`.
import { describe, expect, it, vi } from 'vitest';

import { PanHandler } from '../interactions/pan';
import type { PanZoomTarget } from '../interactions/pan-zoom-target';
import type { TimeScale } from '../scales/time-scale';

/**
 * Unit test for the mouse-driven pan path. Mocks the PanZoomTarget +
 * TimeScale and uses a real HTMLCanvasElement (for cursor-style assertions).
 *
 * Behaviors guarded:
 *  - mousedown with left button starts a drag; non-zero button does not
 *  - mousemove during drag calls target.pan with a time delta (sign inverted from pixel delta)
 *  - mouseup stops the drag; subsequent mousemoves are ignored
 *  - cursor toggles between 'grabbing' (while dragging) and 'crosshair' (idle)
 */
describe('PanHandler', () => {
  function setup() {
    const target = { pan: vi.fn(), zoomAt: vi.fn() } as unknown as PanZoomTarget & {
      pan: ReturnType<typeof vi.fn>;
    };
    const timeScale = {
      pixelDeltaToTimeDelta: vi.fn((px: number) => px * 100), // 1 px = 100 ms
      getMediaWidth: vi.fn(() => 800),
    } as unknown as TimeScale;
    const canvas = document.createElement('canvas');
    const handler = new PanHandler(target, timeScale, canvas);
    return { target, timeScale, canvas, handler };
  }

  const mouse = (type: 'mousedown' | 'mousemove' | 'mouseup', init: MouseEventInit = {}): MouseEvent =>
    new MouseEvent(type, init);

  it('mousedown with left button starts a drag and flips cursor to grabbing', () => {
    const { canvas, handler } = setup();
    expect(handler.isDragging()).toBe(false);

    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 100 }));

    expect(handler.isDragging()).toBe(true);
    expect(canvas.style.cursor).toBe('grabbing');
  });

  it('mousedown with non-left button is ignored', () => {
    const { canvas, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 2, clientX: 100 }));

    expect(handler.isDragging()).toBe(false);
    // Cursor unchanged — default value remains.
    expect(canvas.style.cursor).not.toBe('grabbing');
  });

  it('mousemove during drag calls target.pan with the sign-inverted pixel delta', () => {
    const { target, timeScale, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 200 }));

    // Drag right by 50 px — user wants to pull data rightward, so the viewport
    // should shift LEFT (negative time delta). The handler negates the pixel
    // delta before converting.
    handler.handleMouseMove(mouse('mousemove', { clientX: 250 }));

    expect(timeScale.pixelDeltaToTimeDelta).toHaveBeenCalledWith(-50);
    expect(target.pan).toHaveBeenCalledWith(-50 * 100, 800);
  });

  it('mousemove without an active drag is a no-op', () => {
    const { target, handler } = setup();
    handler.handleMouseMove(mouse('mousemove', { clientX: 100 }));

    expect(target.pan).not.toHaveBeenCalled();
  });

  it('mouseup clears dragging state and restores crosshair cursor', () => {
    const { canvas, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 100 }));
    expect(handler.isDragging()).toBe(true);

    handler.handleMouseUp();

    expect(handler.isDragging()).toBe(false);
    expect(canvas.style.cursor).toBe('crosshair');
  });

  it('mousemove after mouseup does not pan (drag fully released)', () => {
    const { target, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 100 }));
    handler.handleMouseMove(mouse('mousemove', { clientX: 120 })); // pan 1
    handler.handleMouseUp();
    target.pan.mockClear();

    handler.handleMouseMove(mouse('mousemove', { clientX: 150 })); // must be ignored

    expect(target.pan).not.toHaveBeenCalled();
  });

  it('mouseup after a drag does not trigger rebound (rebound removed in Phase 2 step 2)', () => {
    const { target, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 100 }));
    handler.handleMouseMove(mouse('mousemove', { clientX: 120 }));
    handler.handleMouseUp();

    // Viewport stays where the user left it — `pan` was called during the
    // drag, but mouseup no longer schedules a snap-back. The engine eases
    // the visual to the committed logical via the chart-side gesture emit.
    expect((target as unknown as Record<string, unknown>).startRebound).toBeUndefined();
  });
});
