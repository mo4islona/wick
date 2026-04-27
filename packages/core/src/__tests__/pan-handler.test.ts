// @vitest-environment happy-dom
// Needs a DOM because PanHandler mutates `canvas.style.cursor`.
import { describe, expect, it, vi } from 'vitest';

import { PanHandler } from '../interactions/pan';
import type { TimeScale } from '../scales/time-scale';
import type { Viewport } from '../viewport';

/**
 * Unit test for the mouse-driven pan path. Mocks viewport/timeScale and uses
 * a real HTMLCanvasElement (for cursor-style assertions).
 *
 * Behaviors guarded:
 *  - mousedown with left button starts a drag; non-zero button does not
 *  - mousemove during drag calls viewport.pan with a time delta (sign inverted from pixel delta)
 *  - mouseup stops the drag; subsequent mousemoves are ignored
 *  - cursor toggles between 'grabbing' (while dragging) and 'crosshair' (idle)
 */
describe('PanHandler', () => {
  function setup() {
    const viewport = { pan: vi.fn(), startRebound: vi.fn() } as unknown as Viewport & {
      pan: ReturnType<typeof vi.fn>;
      startRebound: ReturnType<typeof vi.fn>;
    };
    const timeScale = {
      pixelDeltaToTimeDelta: vi.fn((px: number) => px * 100), // 1 px = 100 ms
      getMediaWidth: vi.fn(() => 800),
    } as unknown as TimeScale;
    const canvas = document.createElement('canvas');
    const handler = new PanHandler(viewport, timeScale, canvas);
    return { viewport, timeScale, canvas, handler };
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

  it('mousemove during drag calls viewport.pan with the sign-inverted pixel delta', () => {
    const { viewport, timeScale, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 200 }));

    // Drag right by 50 px — user wants to pull data rightward, so the viewport
    // should shift LEFT (negative time delta). The handler negates the pixel
    // delta before converting.
    handler.handleMouseMove(mouse('mousemove', { clientX: 250 }));

    expect(timeScale.pixelDeltaToTimeDelta).toHaveBeenCalledWith(-50);
    // Trailing 0 is the default `inputResponseMs` for the handler when the
    // chart hasn't opted into input animation.
    expect(viewport.pan).toHaveBeenCalledWith(-50 * 100, 800, 0);
  });

  it('mousemove without an active drag is a no-op', () => {
    const { viewport, handler } = setup();
    handler.handleMouseMove(mouse('mousemove', { clientX: 100 }));

    expect(viewport.pan).not.toHaveBeenCalled();
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
    const { viewport, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 100 }));
    handler.handleMouseMove(mouse('mousemove', { clientX: 120 })); // pan 1
    handler.handleMouseUp();
    viewport.pan.mockClear();

    handler.handleMouseMove(mouse('mousemove', { clientX: 150 })); // must be ignored

    expect(viewport.pan).not.toHaveBeenCalled();
  });

  it('mouseup after a drag triggers viewport rebound', () => {
    const { viewport, handler } = setup();
    handler.handleMouseDown(mouse('mousedown', { button: 0, clientX: 100 }));
    handler.handleMouseMove(mouse('mousemove', { clientX: 120 }));

    handler.handleMouseUp();

    expect(viewport.startRebound).toHaveBeenCalledTimes(1);
    expect(viewport.startRebound).toHaveBeenCalledWith(800); // chartWidth
  });

  it('mouseup without an active drag does not trigger rebound', () => {
    // Happens on mouseleave when the cursor was never pressed, or after a failed
    // non-left-button mousedown. Firing rebound here would be a needless no-op
    // but also risks cancelling an in-flight programmatic animation.
    const { viewport, handler } = setup();
    handler.handleMouseUp();
    expect(viewport.startRebound).not.toHaveBeenCalled();
  });
});
