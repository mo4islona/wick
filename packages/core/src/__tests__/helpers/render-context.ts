import type { BitmapCoordinateSpace } from '../../canvas-manager';
import { TimeScale } from '../../scales/time-scale';
import { YScale } from '../../scales/y-scale';
import type { OverlayRenderContext, SeriesRenderContext } from '../../series/types';
import { catppuccin } from '../../theme/themes/catppuccin';
import type { ChartTheme } from '../../theme/types';
import { type CanvasRecorder, createRecordingContext } from './recording-context';

export interface BuildContextOptions {
  /** Viewport X range in data units. Defaults to [0, 100]. */
  timeRange?: { from: number; to: number };
  /** Viewport Y range. Defaults to [0, 100]. */
  yRange?: { min: number; max: number };
  /** CSS pixel size. Defaults to 800x400. */
  mediaWidth?: number;
  mediaHeight?: number;
  /** Device pixel ratio. Defaults to 1 (keeps assertions in a single coordinate space). */
  pixelRatio?: number;
  /** Spacing between data points (ms-equivalent units). Defaults to 1. */
  dataInterval?: number;
  /** Theme override. Defaults to catppuccin.theme. */
  theme?: ChartTheme;
  /** Top/bottom padding in CSS pixels. Defaults to {top:0, bottom:0}. */
  padding?: { top: number; bottom: number };
}

export interface BuiltRenderContext {
  ctx: SeriesRenderContext;
  overlayCtx: (crosshair?: OverlayRenderContext['crosshair']) => OverlayRenderContext;
  spy: CanvasRecorder;
  timeScale: TimeScale;
  yScale: YScale;
}

/**
 * Build a fully-wired {@link SeriesRenderContext} around a recording canvas.
 * Tests call `renderer.render(ctx)` and assert against `spy.calls`. Scales are
 * real — `timeToBitmapX` / `valueToBitmapY` produce real coordinates — so
 * assertions about where primitives land are meaningful.
 */
export function buildRenderContext(opts: BuildContextOptions = {}): BuiltRenderContext {
  const {
    timeRange = { from: 0, to: 100 },
    yRange = { min: 0, max: 100 },
    mediaWidth = 800,
    mediaHeight = 400,
    pixelRatio = 1,
    dataInterval = 1,
    theme = catppuccin.theme,
    padding = { top: 0, bottom: 0 },
  } = opts;

  const { ctx: recordingCtx, spy } = createRecordingContext();

  const bitmapSize = { width: Math.round(mediaWidth * pixelRatio), height: Math.round(mediaHeight * pixelRatio) };
  const mediaSize = { width: mediaWidth, height: mediaHeight };
  const scope: BitmapCoordinateSpace = {
    context: recordingCtx,
    bitmapSize,
    mediaSize,
    horizontalPixelRatio: pixelRatio,
    verticalPixelRatio: pixelRatio,
  };

  const timeScale = new TimeScale();
  timeScale.update(timeRange, mediaWidth, pixelRatio);

  const yScale = new YScale();
  yScale.update(yRange, mediaHeight, pixelRatio);

  const ctx: SeriesRenderContext = {
    scope,
    timeScale,
    yScale,
    theme,
    dataInterval,
    padding,
  };

  const overlayCtx: BuiltRenderContext['overlayCtx'] = (crosshair = null) => ({
    ...ctx,
    crosshair: crosshair ?? null,
  });

  return { ctx, overlayCtx, spy, timeScale, yScale };
}
