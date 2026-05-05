import { type ReactNode, useCallback, useEffect, useState } from 'react';

import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  type ChartInstance,
  type ChartTheme,
  Crosshair,
  type LineData,
  LineSeries,
  type OHLCData,
  Title,
  Tooltip,
  XAxis,
  YAxis,
  useChartInstance,
} from '@wick-charts/react';

// Lifts the inner ChartInstance out to the parent via a setter. State (not a
// ref) so the parent re-renders when each chart is ready and the sync hooks
// can rebind — ref mutations wouldn't trigger that.
function RegisterChart({ onReady }: { onReady: (chart: ChartInstance | null) => void }) {
  const chart = useChartInstance();

  useEffect(() => {
    onReady(chart);

    return () => onReady(null);
  }, [chart, onReady]);

  return null;
}

// Rounded card wrapper around each ChartContainer — gives the multi-pane
// layout visual separation. `overflow: hidden` clips the chart's gradient
// background to the rounded corners; `flex` lets the parent control height
// per pane.
function ChartCard({ flex, theme, children }: { flex: number; theme: ChartTheme; children: ReactNode }) {
  return (
    <div
      style={{
        flex,
        minHeight: 0,
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${theme.tooltip.borderColor}`,
      }}
    >
      {children}
    </div>
  );
}

type SyncEvent = 'viewportChange' | 'crosshairMove';
type Apply = (source: ChartInstance, target: ChartInstance) => void;

// Module-level — stable identity, fed straight into the useBroadcast deps
// array without useCallback. Both functions only use their src/dst args,
// no closure over render-scope state.
const applyViewport: Apply = (src, dst) => {
  dst.setVisibleRange(src.getVisibleRange());
};

const applyCrosshair: Apply = (src, dst) => {
  const pos = src.getCrosshairPosition();
  dst.setCrosshair(pos ? { time: pos.time } : null);
};

// Generic peer-to-peer broadcast across N charts. Each chart's `event`
// fans out to every other via `apply`. A re-entrancy `broadcasting` flag
// shorts cascade emits — when peer.setX inside the loop emits its own
// `event`, the receiver's handler sees the flag set and bails before
// iterating peers. Cost per gesture is O(N): N−1 real applies plus N−1
// short-circuited handler invocations. Without the guard, idempotency
// alone would still terminate the loop but at O(N²) calls.
function useBroadcast(charts: ReadonlyArray<ChartInstance | null>, event: SyncEvent, apply: Apply) {
  useEffect(() => {
    const ready = charts.filter((c): c is ChartInstance => c !== null);
    let broadcasting = false;

    const handlers = ready.map((source) => {
      const onEvent = () => {
        if (broadcasting) return;
        broadcasting = true;

        try {
          for (const other of ready) {
            if (other !== source) apply(source, other);
          }
        } finally {
          // Reset even if `apply` throws — a stuck flag would silently
          // kill all future syncs. Cheap safety belt.
          broadcasting = false;
        }
      };

      source.on(event, onEvent);

      return { source, onEvent };
    });

    return () => {
      for (const { source, onEvent } of handlers) {
        source.off(event, onEvent);
      }
    };
    // Spread the array into deps so React rebinds only when an actual chart
    // instance changes (mount/unmount), not on every parent render.
  }, [...charts, event, apply]);
}

// Sync visible time range across N charts: pan/zoom on one moves the rest.
function useSyncViewport(charts: ReadonlyArray<ChartInstance | null>) {
  useBroadcast(charts, 'viewportChange', applyViewport);
}

// Sync crosshair across N charts: hovering any pane drives every pane's
// native <Crosshair> + <Tooltip> at the same time x — as if the cursor
// were on all of them at once.
function useSyncCrosshair(charts: ReadonlyArray<ChartInstance | null>) {
  useBroadcast(charts, 'crosshairMove', applyCrosshair);
}

export function MultiChartSyncDemo({
  theme,
  candles,
  volume,
  rsi,
}: {
  theme: ChartTheme;
  candles: OHLCData[];
  volume: LineData[];
  rsi: LineData[];
}) {
  const [priceChart, setPriceChart] = useState<ChartInstance | null>(null);
  const [volumeChart, setVolumeChart] = useState<ChartInstance | null>(null);
  const [rsiChart, setRsiChart] = useState<ChartInstance | null>(null);

  // Stable identities so RegisterChart's effect doesn't fire on every render.
  const onPriceReady = useCallback((c: ChartInstance | null) => setPriceChart(c), []);
  const onVolumeReady = useCallback((c: ChartInstance | null) => setVolumeChart(c), []);
  const onRsiReady = useCallback((c: ChartInstance | null) => setRsiChart(c), []);

  const charts = [priceChart, volumeChart, rsiChart];

  useSyncViewport(charts);
  useSyncCrosshair(charts);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
      <ChartCard flex={2} theme={theme}>
        <ChartContainer theme={theme}>
          <Title sub="Price">BTC/USD</Title>
          <CandlestickSeries id="candle" data={candles} />
          <RegisterChart onReady={onPriceReady} />
          <Crosshair />
          <Tooltip />
          <YAxis />
          <XAxis />
        </ChartContainer>
      </ChartCard>
      <ChartCard flex={1} theme={theme}>
        <ChartContainer theme={theme}>
          <Title sub="Volume">Volume</Title>
          <BarSeries id="volume" data={[volume]} />
          <RegisterChart onReady={onVolumeReady} />
          <Crosshair />
          <Tooltip />
          <YAxis />
          <XAxis />
        </ChartContainer>
      </ChartCard>
      <ChartCard flex={1} theme={theme}>
        <ChartContainer theme={theme}>
          <Title sub="14-period">RSI</Title>
          <LineSeries id="rsi" data={[rsi]} />
          <RegisterChart onReady={onRsiReady} />
          <Crosshair />
          <Tooltip />
          <YAxis />
          <XAxis />
        </ChartContainer>
      </ChartCard>
    </div>
  );
}
