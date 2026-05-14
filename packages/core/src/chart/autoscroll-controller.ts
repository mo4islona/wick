import type { VisibleRange } from '../types';
import type { AnimationBridge } from './animation-bridge';

/**
 * Minimal contract the autoscroll controller needs from a viewport-like
 * object. Lets us tick the controller in tests without spinning up a full
 * {@link Viewport}; the real chart passes its `Viewport` instance directly.
 */
export interface AutoscrollViewport {
  readonly logicalRange: VisibleRange;
  /**
   * Decide whether tail-following should re-engage now that the user-pan
   * window has caught up with `dataEnd`. Called once per frame from the
   * chart's render loop.
   */
  checkAutoScrollReengagement(dataEnd: number, logicalTarget: VisibleRange): void;
}

/**
 * Wires the viewport's tail-follow reengagement check into the chart's RAF
 * loop, supplying the *logical* X target (the engine's slot.target) instead
 * of the visual `state.xRange`.
 *
 * The visual range can dip back into the data zone one or two frames ahead
 * of the logical target during streaming — if the viewport used the visual
 * value to decide reengagement it would preempt an in-flight animation and
 * the chart would visibly jump. Reading the bridge's `lastXTarget` keeps
 * the decision tied to the source of truth.
 */
export class AutoscrollController {
  readonly #viewport: AutoscrollViewport;
  readonly #bridge: AnimationBridge;

  constructor(opts: { viewport: AutoscrollViewport; bridge: AnimationBridge }) {
    this.#viewport = opts.viewport;
    this.#bridge = opts.bridge;
  }

  /** Run once per chart RAF tick. `dataEnd` is the latest data timestamp. */
  tick(dataEnd: number | null): void {
    if (dataEnd === null) return;

    const logical = this.#bridge.lastXTarget ?? this.#viewport.logicalRange;
    this.#viewport.checkAutoScrollReengagement(dataEnd, logical);
  }
}
