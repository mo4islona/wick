import { useEffect, useMemo, useRef, useState } from 'react';

import type { LineData } from '@wick-charts/react';
import { ChartContainer, LineSeries, TimeAxis, Title, YAxis } from '@wick-charts/react';

import type { PanelCtx, StressPanel } from './panel';

const INTERVAL = 60_000;

function makeSeed(start: number, count: number, baseValue = 100): LineData[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * INTERVAL,
    value: baseValue + Math.sin(i / 4) * 5,
  }));
}

function ResetButton({ theme, onClick, label }: { theme: PanelCtx['theme']; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        background: theme.crosshair.labelBackground,
        color: theme.crosshair.labelTextColor,
        border: `1px solid ${theme.tooltip.borderColor}`,
        borderRadius: 4,
        cursor: 'pointer',
        justifySelf: 'start',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Side-by-side warm-up burst at two different window sizes. Each chart
 * gets the same stream of appended points and is initialised with
 * `setVisibleRange({ from: seed[0].time, bars: cap })` so seed points
 * sit on the left and incoming ticks fill the empty right side. Once
 * the window fills up, panning takes over.
 */
function WarmUpComparison({ theme, perfHud, yEngine }: PanelCtx) {
  const seed = useMemo(() => makeSeed(Date.now() - 5 * INTERVAL, 5), []);
  const [data, setData] = useState<LineData[]>(seed);
  const [running, setRunning] = useState(true);
  const seedRef = useRef(seed);
  const runningRef = useRef(running);
  runningRef.current = running;

  // Single interval for the lifetime of the panel — appends until the burst
  // length is reached, then no-ops. Depending on `data.length` here would
  // tear down and recreate the interval on every tick (~32ms), adding churn.
  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return;

      setData((prev) => {
        if (prev.length >= 250) return prev;

        const last = prev[prev.length - 1];
        const next: LineData = {
          time: last.time + INTERVAL,
          value: 100 + Math.sin(prev.length / 4) * 8 + (Math.random() - 0.5) * 1.5,
        };

        return [...prev, next];
      });
    }, 32);

    return () => clearInterval(id);
  }, []);

  const reset = () => {
    setData(seedRef.current);
    setRunning(true);
  };

  const chartCell = (cap: number, label: string) => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ChartContainer
        theme={theme}
        perf={perfHud}
        animations={{ y: { transition: yEngine } }}
        interactive={false}
        viewport={{ initialRange: { from: seedRef.current[0].time, bars: cap } }}
      >
        <Title sub={`${data.length} points`}>{label}</Title>
        <LineSeries data={[data]} options={{ pulse: false }} />
        <YAxis />
        <TimeAxis />
      </ChartContainer>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 6, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ResetButton theme={theme} onClick={reset} label="Restart burst" />
        <span style={{ fontSize: 12, color: theme.axis.textColor, opacity: 0.7 }}>
          {running && data.length < 250 ? `streaming · ${data.length}/250` : 'idle'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minHeight: 0 }}>
        {chartCell(50, 'cap = 50')}
        {chartCell(200, 'cap = 200 (default)')}
      </div>
    </div>
  );
}

/**
 * Y-axis "breathing" panel: a fast sine carrier modulated by a slow amplitude
 * envelope. The line shape stays coherent (recognizable wave) frame-to-frame
 * while the envelope smoothly grows and shrinks, so the Y axis visibly
 * compresses and expands on a steady rhythm without ever looking like a
 * different chart per tick. Deterministic — phase advances by a fixed step
 * each frame.
 */
function SharpJumps({ theme, perfHud, yEngine }: PanelCtx) {
  const VISIBLE_CAP = 60;
  // Carrier period in ticks — short enough that several oscillations are
  // visible inside the window at any time.
  const CARRIER_PERIOD = 8;
  // Envelope period in ticks — must be at least 2× VISIBLE_CAP so the entire
  // window cycles through low- and high-amplitude phases as it slides.
  const ENVELOPE_PERIOD = VISIBLE_CAP * 2;
  // Min/max amplitude for the carrier. The ratio (300×) is what produces the
  // visible axis expansion — at minimum the axis fits ~[-10, 110]; at maximum
  // it fits ~[-3000, 3100].
  const MIN_AMPLITUDE = 10;
  const MAX_AMPLITUDE = 3_000;

  const seed = useMemo(() => makeSeed(Date.now() - 30 * INTERVAL, 30), []);
  const [data, setData] = useState<LineData[]>(seed);
  const tickRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev[prev.length - 1];
        const t = tickRef.current;
        tickRef.current += 1;

        // Envelope in [0, 1]. Squared so the low-amplitude tail is wider —
        // axis spends meaningful time fully contracted between booms.
        const envRaw = (Math.sin((2 * Math.PI * t) / ENVELOPE_PERIOD) + 1) / 2;
        const env = envRaw * envRaw;
        const amplitude = MIN_AMPLITUDE + env * (MAX_AMPLITUDE - MIN_AMPLITUDE);

        const carrier = Math.sin((2 * Math.PI * t) / CARRIER_PERIOD);
        const value = 100 + amplitude * carrier;

        // Don't cap with `slice` — once `prev.length` matches the cap, every
        // tick triggers LineSeries' rolling-window path which calls
        // `setSeriesData` for the prefix and snaps the Y range, killing the
        // breathing animation. The chart only ever renders the visible window
        // (maxVisibleBars points), so unbounded `prev` growth is harmless.
        return [...prev, { time: last.time + INTERVAL, value }];
      });
    }, 120);
    return () => clearInterval(id);
  }, [CARRIER_PERIOD, ENVELOPE_PERIOD, MIN_AMPLITUDE, MAX_AMPLITUDE]);

  return (
    <ChartContainer
      theme={theme}
      perf={perfHud}
      animations={{ y: { transition: yEngine } }}
      interactive={false}
      viewport={{ initialRange: { from: seed[0].time, bars: VISIBLE_CAP } }}
    >
      <Title sub="sine carrier with breathing amplitude envelope">Y-axis breathing</Title>
      <LineSeries data={[data]} options={{ pulse: false }} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

/**
 * Variable inter-arrival cadence: ticks fire 30–800 ms apart. Adaptive scroll
 * duration should track the interval so the right edge stays close to the
 * latest bar without wobble or overshoot.
 */
function VariableJitter({ theme, perfHud, yEngine }: PanelCtx) {
  const seed = useMemo(() => makeSeed(Date.now() - 40 * INTERVAL, 40), []);
  const [data, setData] = useState<LineData[]>(seed);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      setData((prev) => {
        const last = prev[prev.length - 1];
        return [...prev, { time: last.time + INTERVAL, value: 100 + Math.sin(prev.length / 6) * 12 }];
      });
      const next = 30 + Math.random() * 770;
      timeout = setTimeout(tick, next);
    };
    timeout = setTimeout(tick, 200);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <ChartContainer
      theme={theme}
      perf={perfHud}
      animations={{ y: { transition: yEngine } }}
      interactive={false}
      viewport={{ initialRange: { from: seed[0].time, bars: 80 } }}
    >
      <Title sub="30–800 ms between ticks">Variable cadence</Title>
      <LineSeries data={[data]} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

/**
 * Burst-then-pause: 80 fast ticks, then 5 s idle, repeat. The post-pause first
 * tick must not produce a multi-second slide (idle reset clamps the adaptive
 * duration back to the baseline).
 */
function BurstThenPause({ theme, perfHud, yEngine }: PanelCtx) {
  const seed = useMemo(() => makeSeed(Date.now() - 30 * INTERVAL, 30), []);
  const [data, setData] = useState<LineData[]>(seed);
  const [phase, setPhase] = useState<'burst' | 'idle'>('burst');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const burst = (remaining: number) => {
      if (cancelled) return;
      if (remaining === 0) {
        setPhase('idle');
        timer = setTimeout(() => {
          setPhase('burst');
          burst(80);
        }, 5_000);
        return;
      }
      setData((prev) => {
        const last = prev[prev.length - 1];
        return [...prev, { time: last.time + INTERVAL, value: 100 + (prev.length % 20) }];
      });
      timer = setTimeout(() => burst(remaining - 1), 25);
    };

    burst(80);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <ChartContainer
      theme={theme}
      perf={perfHud}
      animations={{ y: { transition: yEngine } }}
      interactive={false}
      viewport={{ initialRange: { from: seed[0].time, bars: 60 } }}
    >
      <Title sub={phase === 'burst' ? 'burst' : 'idle 5 s'}>Burst → pause cycle</Title>
      <LineSeries data={[data]} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

/**
 * Monotonically increasing line: each tick adds `STEP ± small noise` to the
 * previous value. Y MAX grows on every tick, Y MIN stays put — the cleanest
 * test of the chart's default auto-Y. Even a smooth Y chase visibly slides
 * every already-drawn point downward as the bound expands.
 *
 * Use this panel as the "before" picture for any Y-stability fix in core:
 * the visual movement must reduce noticeably once sticky bounds land.
 */
function MonotonicRamp({ theme, perfHud, yEngine }: PanelCtx) {
  const VISIBLE_CAP = 60;
  const STEP = 1.5;

  const seed = useMemo(() => {
    const out: LineData[] = [];
    const start = Date.now() - 10 * INTERVAL;
    let value = 100;
    for (let i = 0; i < 10; i++) {
      value += STEP + (Math.random() - 0.5) * STEP * 0.3;
      out.push({ time: start + i * INTERVAL, value });
    }
    return out;
  }, []);

  const [data, setData] = useState<LineData[]>(seed);

  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev[prev.length - 1];
        const jitter = (Math.random() - 0.5) * STEP * 0.3;
        const value = last.value + STEP + jitter;

        return [...prev, { time: last.time + INTERVAL, value }];
      });
    }, 200);

    return () => clearInterval(id);
  }, []);

  return (
    <ChartContainer
      theme={theme}
      perf={perfHud}
      animations={{ y: { transition: yEngine } }}
      interactive={false}
      viewport={{ initialRange: { from: seed[0].time, bars: VISIBLE_CAP } }}
    >
      <Title sub={`value += ${STEP} per tick · ${data.length} points`}>Monotonic ramp</Title>
      <LineSeries data={[data]} options={{ pulse: false }} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

/**
 * Outlier-rebound case: baseline ~50 with periodic spikes to 200. Spike
 * interval (40 ticks) is longer than the visible window (20 bars), so each
 * spike sits on screen for a while then scrolls off the left edge — leaving
 * a ~20-tick window where the visible data is back to baseline.
 *
 * Sticky-Y (`Y_BOUND_CONTRACT_ALPHA` in `animation-constants.ts`) holds the
 * upper bound elevated after the spike scrolls off, then lerps it back
 * toward the baseline with an EMA half-life of ~14 ticks. Without sticky,
 * Y max would snap to ~60 the instant the spike left the window and the
 * whole chart would reflow on every outlier.
 */
function OutlierRebound({ theme, perfHud, yEngine }: PanelCtx) {
  const VISIBLE_CAP = 20;
  const SPIKE_EVERY = 40;
  const BASE = 50;
  const SPIKE = 200;

  const seed = useMemo(() => makeSeed(Date.now() - 15 * INTERVAL, 15, BASE), []);
  const [data, setData] = useState<LineData[]>(seed);
  const tickRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev[prev.length - 1];
        const t = tickRef.current;
        tickRef.current += 1;

        const isSpike = t % SPIKE_EVERY === SPIKE_EVERY - 1;
        const value = isSpike ? SPIKE : BASE + (Math.random() - 0.5) * 4;

        return [...prev, { time: last.time + INTERVAL, value }];
      });
    }, 250);

    return () => clearInterval(id);
  }, []);

  return (
    <ChartContainer
      theme={theme}
      perf={perfHud}
      animations={{ y: { transition: yEngine } }}
      interactive={false}
      viewport={{ initialRange: { from: seed[0].time, bars: VISIBLE_CAP } }}
    >
      <LineSeries data={[data]} options={{ pulse: false }} />
      <YAxis />
      <TimeAxis />
    </ChartContainer>
  );
}

export const streamingPanels: readonly StressPanel[] = [
  {
    id: 'stream-warmup-compare',
    title: 'Warm-up vs scroll threshold',
    hint: 'Restart the burst and watch each chart. cap=50 transitions to tail-scroll around point 50; cap=200 keeps expanding.',
    note: 'Both charts receive the same stream. Smoothness is the eye-test target — no per-tick jerks during warm-up, no overshoot at the transition.',
    render: (ctx) => <WarmUpComparison {...ctx} />,
    minHeight: 360,
  },
  {
    id: 'stream-sharp-jumps',
    title: 'Y-axis breathing',
    hint: 'Sine carrier with a slow amplitude envelope. Y axis smoothly compresses and expands as the envelope rises and falls.',
    render: (ctx) => <SharpJumps {...ctx} />,
  },
  {
    id: 'stream-jitter',
    title: 'Variable cadence',
    hint: 'Inter-arrival 30–800 ms. Adaptive scroll duration must follow — right edge always near the latest bar.',
    render: (ctx) => <VariableJitter {...ctx} />,
  },
  {
    id: 'stream-burst-pause',
    title: 'Burst → idle → burst',
    hint: '80 fast ticks then a 5 s pause. Idle reset prevents a long slide on the first post-pause tick.',
    render: (ctx) => <BurstThenPause {...ctx} />,
  },
  {
    id: 'stream-monotonic-ramp',
    title: 'Monotonic ramp',
    hint: 'Each tick adds a fixed step to value. Y MAX grows every tick; already-drawn points slide downward as the bound expands.',
    note: 'Baseline for Y-stability work — sticky bounds with EMA shrink should make the slide smoother and eliminate per-tick wobble after the initial expansion.',
    render: (ctx) => <MonotonicRamp {...ctx} />,
  },
  {
    id: 'stream-outlier-rebound',
    title: 'Outlier rebound',
    hint: 'Baseline ~50 with spikes to 200 every 40 ticks; visible window = 20 bars, so each spike spends ~20 ticks on screen then ~20 ticks off-screen. Sticky-Y keeps the upper bound elevated after the spike scrolls off and lerps it back toward the baseline rather than snapping — no per-spike reflow of the whole panel.',
    note: 'Demonstrates the sticky-Y contraction trade-off. Left chart = default (α=0.05); right chart = effectively no sticky (α=1.0). Same stream feeds both — compare which feels more readable for noisy data.',
    render: (ctx) => <OutlierRebound {...ctx} />,
    minHeight: 360,
  },
];
