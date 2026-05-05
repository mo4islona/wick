import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { EdgeSide } from '@wick-charts/core';

import { useChartInstance } from './context';

/** Argument shape passed to the {@link EdgeLoader} render-prop. */
export interface EdgeLoaderRenderArgs {
  /**
   * CSS pixels in the chart's overlay coordinate space, anchored at the data
   * edge (`data.from` for `side='left'`, `data.to` for `side='right'`).
   * The overlay div is positioned with `inset: 0`, so this value can be used
   * directly as `style={{ left: x }}` or `transform: translateX(...)`.
   */
  x: number;
  side: EdgeSide;
  /** True between {@link EdgeLoaderProps.onTrigger} firing and its Promise resolving. */
  isLoading: boolean;
  /** Time coordinate (ms) of the data edge — convenient for "fetch history before T" requests. */
  boundaryTime: number;
  /** Becomes `false` after `onTrigger` resolves with the literal value `false`. */
  hasMore: boolean;
}

export interface EdgeLoaderProps {
  /** Which edge to watch. */
  side: EdgeSide;
  /**
   * Bars from the edge that arms the trigger. Multiplied by the chart's data
   * interval. Default `5`.
   */
  threshold?: number;
  /**
   * Called when the visible range moves within {@link EdgeLoaderProps.threshold}
   * bars of the data edge. Returning a Promise toggles `isLoading` for its
   * lifetime. **Resolve with `false`** to signal "no more data" — the loader
   * stops watching and switches the optional canvas indicator to its
   * `'no-data'` state. Any other resolve value (including `undefined`) means
   * "keep watching for the next near-edge event".
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: void allows callers to write `() => fetch()` without an explicit return
  onTrigger: () => void | Promise<unknown>;
  /**
   * - `'canvas'` (default): drive the chart's built-in canvas spinner via
   *   {@link ChartInstance.setEdgeState}. Renders inside the chart area at
   *   the data boundary.
   * - `'custom'`: skip the canvas indicator. Use the render-prop `children`
   *   to draw your own DOM/SVG loader.
   */
  indicator?: 'canvas' | 'custom';
  /**
   * Optional render-prop. Receives the live edge state — render whatever
   * positioned overlay you want, or return `null`.
   */
  children?: (args: EdgeLoaderRenderArgs) => ReactNode;
}

/**
 * Subscribes to the chart's viewport and triggers a fetch when the visible
 * range nears the chosen data edge. Handles the boilerplate every load-on-scroll
 * site otherwise has to re-implement: arming after first user pan, deduping
 * via Promise tracking, and exposing the boundary's pixel coordinate so a
 * loader can be anchored to "the wall of available history".
 *
 * Place as a child of `<ChartContainer>`.
 */
export function EdgeLoader({ side, threshold = 5, onTrigger, indicator = 'canvas', children }: EdgeLoaderProps) {
  const chart = useChartInstance();
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Bump on viewportChange / overlayChange so the render-prop re-runs with
  // the latest pixel x. State, not ref, because we want the re-render.
  const [, setTick] = useState(0);

  const triggerRef = useRef(onTrigger);
  triggerRef.current = onTrigger;
  // Stash `children` in a ref so the effect doesn't have to rebind listeners
  // on every render-prop identity change, and so the bump-on-change gate can
  // read the latest value without putting `children` in deps.
  const hasChildrenRef = useRef(children !== undefined);
  hasChildrenRef.current = children !== undefined;
  const inflight = useRef(false);
  // Largest "distance from edge" (in time units) seen so far — gate the
  // trigger on it crossing the threshold once, so the initial fit-to-data
  // (where visible === data) doesn't fire the loader on mount.
  const armed = useRef(false);

  useEffect(() => {
    if (!hasMore) return;

    const distanceFromEdge = (): number | null => {
      const visible = chart.getVisibleRange();
      const data = chart.getDataRange();
      if (!data) return null;

      return side === 'left' ? visible.from - data.from : data.to - visible.to;
    };

    const fire = () => {
      if (inflight.current || !hasMore) return;

      inflight.current = true;
      setIsLoading(true);
      if (indicator === 'canvas') chart.setEdgeState(side, 'loading');

      // biome-ignore lint/suspicious/noConfusingVoidType: matches onTrigger's return type exactly
      let result: void | Promise<unknown>;
      try {
        result = triggerRef.current();
      } catch (err) {
        inflight.current = false;
        setIsLoading(false);
        if (indicator === 'canvas') chart.setEdgeState(side, 'idle');
        throw err;
      }

      const finish = (value: unknown) => {
        inflight.current = false;
        setIsLoading(false);
        if (value === false) {
          setHasMore(false);
          if (indicator === 'canvas') chart.setEdgeState(side, 'no-data');
        } else if (indicator === 'canvas') {
          chart.setEdgeState(side, 'idle');
        }
      };

      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(finish, () => finish(undefined));
      } else {
        finish(undefined);
      }
    };

    const onChange = () => {
      const interval = chart.getDataInterval();
      const distance = distanceFromEdge();
      if (distance === null) return;

      if (!armed.current) {
        // Wait until the visible range has moved away from the edge once —
        // then we know the chart isn't in its mount-time fit-to-data state.
        if (distance > threshold * interval) {
          armed.current = true;
        }

        return;
      }

      if (distance <= threshold * interval) {
        fire();
      }

      // Bump only when a render-prop is consuming the live pixel-x — the
      // canvas-indicator path is driven entirely by chart.setEdgeState and
      // doesn't need a React re-render on every pan/zoom frame.
      if (hasChildrenRef.current) setTick((n) => n + 1);
    };

    chart.on('viewportChange', onChange);
    chart.on('overlayChange', onChange);
    onChange();

    return () => {
      chart.off('viewportChange', onChange);
      chart.off('overlayChange', onChange);
    };
  }, [chart, side, threshold, indicator, hasMore]);

  // Reset the canvas indicator when this loader unmounts so a remount with a
  // fresh side / threshold doesn't inherit stale state.
  useEffect(() => {
    return () => {
      if (indicator === 'canvas') chart.setEdgeState(side, 'idle');
    };
  }, [chart, side, indicator]);

  if (!children) return null;

  const data = chart.getDataRange();
  if (!data) return null;

  const boundaryTime = side === 'left' ? data.from : data.to;
  const x = chart.timeScale.timeToX(boundaryTime);

  return <>{children({ x, side, isLoading, boundaryTime, hasMore })}</>;
}
