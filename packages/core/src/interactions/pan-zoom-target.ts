/**
 * Narrow interface the interaction handlers expect from their host. Lets
 * `InteractionHandler` / `PanHandler` / `ZoomHandler` drive pan / zoom
 * without depending on the full ChartInstance surface.
 */
export interface PanZoomTarget {
  /**
   * Shift the visible time range by `timeDelta` ms. `chartWidth` is used
   * by pixel-padding resolution; passing the current canvas width yields
   * correct rubber-band clamps.
   */
  pan(timeDelta: number, chartWidth?: number): void;
  /**
   * Zoom around a time anchor. `factor < 1` zooms in, `> 1` zooms out.
   * `chartWidth` participates in soft-bound math the same way as in `pan`.
   */
  zoomAt(centerTime: number, factor: number, chartWidth?: number): void;
}
