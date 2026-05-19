import { useMemo } from 'react';

import type { ChartTheme, OHLCData, TimePoint } from '@wick-charts/react';

import { AdvancedLayout, type Step } from '../../components/AdvancedLayout';
import { generateOHLCData } from '../../data';
import { MultiChartSyncDemo } from './multi-chart-sync.example';
import source from './multi-chart-sync.example.tsx?raw';

const COUNT = 200;
const INTERVAL = 60_000 * 60;

function deriveVolume(candles: OHLCData[]): TimePoint[] {
  // Synthetic volume: scale the candle's intra-bar range by a noisy multiplier
  // so spikes correlate with bigger candles, like real markets. Always positive.
  return candles.map((c) => {
    const range = Math.abs(c.high - c.low);
    const noise = 0.4 + Math.random() * 1.2;

    return {
      time: c.time,
      value: Math.max(1, range * 8000 * noise),
    };
  });
}

const RSI_PERIOD = 14;

function deriveRSI(candles: OHLCData[]): TimePoint[] {
  // Wilder's RSI: exponential smoothing of gains/losses across `RSI_PERIOD`
  // bars. Output is 0..100, oscillating around 50.
  const out: TimePoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (i <= RSI_PERIOD) {
      avgGain += gain / RSI_PERIOD;
      avgLoss += loss / RSI_PERIOD;
    } else {
      avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
      avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
    }

    if (i >= RSI_PERIOD) {
      const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss;
      const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
      out.push({ time: candles[i].time, value: rsi });
    }
  }

  return out;
}

const STEPS: Step[] = [
  {
    heading: '01 — REGISTER EACH CHART',
    body: (
      <>
        Every <code>&lt;ChartContainer&gt;</code> mounts its own <code>ChartInstance</code>. Capture each one with a
        small helper inside the container that reads <code>useChartInstance()</code> and lifts it to parent state — refs
        won't trigger the rerender that lets the sync effect rebind.
      </>
    ),
    code: `function RegisterChart({ onReady }) {\n  const chart = useChartInstance();\n  useEffect(() => {\n    onReady(chart);\n    return () => onReady(null);\n  }, [chart, onReady]);\n  return null;\n}\n\n// Parent: state, not refs — so this component re-renders when\n// each chart mounts and the sync effect can rebind.\nconst [priceChart, setPriceChart] = useState(null);\nconst [volumeChart, setVolumeChart] = useState(null);\nconst [rsiChart, setRsiChart] = useState(null);`,
  },
  {
    heading: '02 — BROADCAST WITH RE-ENTRANCY GUARD',
    body: (
      <>
        Every chart's event fans out to peers via <code>apply(src, dst)</code>. A <code>broadcasting</code> flag in the
        effect closure shorts cascade emits: when <code>peer.setX</code> inside the loop fires its own event, the
        receiver's handler sees the flag set and returns before iterating peers. Per-gesture cost is O(n) — n − 1 real
        applies plus n − 1 short-circuited invocations. No idempotency dependency; <code>setVisibleRange</code> /{' '}
        <code>setCrosshair</code> stay idempotent as defense in depth.
      </>
    ),
    code: `function useBroadcast(charts, event, apply) {\n  useEffect(() => {\n    const ready = charts.filter(Boolean);\n    let broadcasting = false;\n\n    const handlers = ready.map((source) => {\n      const onEvent = () => {\n        if (broadcasting) return;\n        broadcasting = true;\n        try {\n          for (const other of ready) {\n            if (other !== source) apply(source, other);\n          }\n        } finally {\n          broadcasting = false;\n        }\n      };\n      source.on(event, onEvent);\n      return { source, onEvent };\n    });\n\n    return () => {\n      for (const { source, onEvent } of handlers) {\n        source.off(event, onEvent);\n      }\n    };\n  }, [...charts, event, apply]);\n}`,
  },
  {
    heading: '03 — VIEWPORT + CROSSHAIR WRAPPERS',
    body: (
      <>
        Two thin wrappers around <code>useBroadcast</code>. <code>apply</code> functions live as module-level constants
        — stable identity, no <code>useCallback</code> dance, no listener re-binds on parent re-renders. Pan/zoom any
        chart and the rest follow; hover any pane and every pane's native <code>&lt;Crosshair&gt;</code> +{' '}
        <code>&lt;Tooltip&gt;</code> tracks the same time x.
      </>
    ),
    code: `// Module scope:\nconst applyViewport = (src, dst) => {\n  dst.setVisibleRange(src.getVisibleRange());\n};\n\nconst applyCrosshair = (src, dst) => {\n  const pos = src.getCrosshairPosition();\n  dst.setCrosshair(pos ? { time: pos.time } : null);\n};\n\nfunction useSyncViewport(charts) {\n  useBroadcast(charts, 'viewportChange', applyViewport);\n}\n\nfunction useSyncCrosshair(charts) {\n  useBroadcast(charts, 'crosshairMove', applyCrosshair);\n}\n\n// Parent:\nuseSyncViewport(charts);\nuseSyncCrosshair(charts);`,
  },
];

export function MultiChartSyncPage({ theme }: { theme: ChartTheme }) {
  const candles = useMemo(() => generateOHLCData(COUNT, 100, INTERVAL), []);
  const volume = useMemo(() => deriveVolume(candles), [candles]);
  const rsi = useMemo(() => deriveRSI(candles), [candles]);

  return (
    <AdvancedLayout
      theme={theme}
      source={source}
      framedChart={false}
      lead={
        <>
          Three charts — price, volume, and RSI — sharing one visible time range. Hover any pane and all three show
          their own tooltip + crosshair at the same time x, as if the cursor were on all of them at once. Pan or zoom
          any chart and the other two follow. A re-entrancy guard inside the broadcast hook keeps per-gesture cost at
          O(n), so the pattern scales to many charts.
        </>
      }
      chart={<MultiChartSyncDemo theme={theme} candles={candles} volume={volume} rsi={rsi} />}
      steps={STEPS}
    />
  );
}
