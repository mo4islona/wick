import type { OHLCData, VisibleRange, YRange } from '../types';
import { easeOutCubic } from './easing';
import type { Milliseconds } from './time';
import type { Transition } from './transition';

// =============================================================================
// Engine-internal constants
// =============================================================================

/**
 * Maximum advancement per `tick()` call. After a background-tab freeze the
 * RAF callback can fire with `now − lastEffectiveNow` in the seconds; we cap
 * it so the in-flight animations relax over a couple of frames instead of
 * teleporting to their settled state.
 */
const MAX_FRAME_DT = 32;

/**
 * Velocity magnitudes below this in units/ms are treated as zero. Closed-form
 * `easeOutCubic'(1) === 0` exactly, but accumulated floating-point error can
 * leave a residual on the 1e-5 order — without the epsilon `state.animating`
 * would tick back to `true` forever after a settle.
 */
const VELOCITY_EPSILON = 0.001;

// =============================================================================
// Public types
// =============================================================================

/**
 * Animation event kind. Used both for priority resolution at the slot level
 * (`KIND_PRIORITY`) and as a metadata tag the chart-side bridge fills in when
 * translating user actions / streaming updates into engine emissions.
 */
export type TransitionKind = 'instant' | 'gesture' | 'visibility' | 'data_tick' | 'entrance';

/**
 * Priority ordering for the per-slot winner election. A higher value wins
 * over a lower one regardless of which event was emitted first — the merge
 * algorithm is preemption-based, not chronological. Ties on priority resolve
 * to the newest `startWall`, then to the newest `emitSeq` (deterministic
 * across a single RAF batch).
 */
export const KIND_PRIORITY: Record<TransitionKind, number> = {
  instant: 4,
  gesture: 3,
  visibility: 2,
  data_tick: 1,
  entrance: 0,
};

export interface AlphaTarget {
  key: string;
  target: number;
}

export interface EntryTarget {
  seriesId: string;
  layerIdx: number;
  time: number;
}

export interface LiveScalarTarget {
  seriesId: string;
  layerIdx: number;
  target: number;
}

export interface LiveOHLCTarget {
  seriesId: string;
  layerIdx: number;
  target: OHLCData;
}

export interface TickFadeTarget {
  /** Tick values that just became visible (opacity 0 → 1). */
  entering: readonly number[];
  /** Tick values that just left (opacity 1 → 0). */
  exiting: readonly number[];
}

/**
 * Single emission into the engine. Any number of target types may be
 * populated — the engine resolves each `(target, key)` slot independently,
 * so one event can drive Y reflow, X scroll, alpha cross-fade and axis tick
 * fade in lockstep on the same `duration`.
 */
export interface AnimationEvent {
  kind: TransitionKind;
  /**
   * Optional wall reference. Production callers always omit this — the
   * engine fills in `effectiveNow` at emit time (or `NaN` as a sentinel when
   * the engine is idle, resolved on the first tick after wake-up). Tests
   * may pass a value to pin event timing deterministically.
   */
  startWall?: number;
  duration: Milliseconds;
  targets: {
    /**
     * Y bound target. When `expandMs` / `contractMs` are set they replace
     * `event.duration` for the `Transition.retarget` call only — lets the
     * chart preserve the asymmetric sticky-Y baseline (fast expand, slow
     * contract) while everything else on the event still rides
     * `event.duration`. Both fields fall back to `event.duration` when
     * omitted.
     */
    y?: { target: YRange; expandMs?: Milliseconds; contractMs?: Milliseconds };
    x?: { target: VisibleRange };
    alpha?: readonly AlphaTarget[];
    entry?: readonly EntryTarget[];
    liveScalar?: readonly LiveScalarTarget[];
    liveOHLC?: readonly LiveOHLCTarget[];
    tickFade?: TickFadeTarget;
  };
}

/**
 * Snapshot returned by `tick()`. The same reference is returned every frame
 * and the inner Maps are mutated in place — renderers must read values
 * inside the current frame's render pass and not cache snapshot references
 * across frames.
 */
export interface AnimationState {
  readonly yRange: YRange;
  readonly xRange: VisibleRange;
  readonly seriesAlpha: ReadonlyMap<string, number>;
  readonly entryProgress: ReadonlyMap<string, ReadonlyMap<number, number>>;
  readonly liveValues: {
    readonly scalar: ReadonlyMap<string, number>;
    readonly ohlc: ReadonlyMap<string, OHLCData>;
  };
  readonly tickOpacity: ReadonlyMap<number, number>;
  readonly pulsePhase: ReadonlyMap<string, number>;
  readonly animating: boolean;
}

/** Slot identifier accepted by {@link AnimationEngine.dropSlot}. */
export type SlotTarget = 'y' | 'x' | 'alpha' | 'tickFade' | 'liveScalar' | 'liveOHLC' | 'entry';

export interface AnimationEngineOptions {
  initial: { yRange: YRange; xRange: VisibleRange };
  /**
   * Pre-constructed Y transition. Engine drives it via `retarget` / `snap`
   * / `tick`. Phase 2 design: the chart owns transition construction (so it
   * can swap factory based on `animations.y.transition` config); the engine
   * only needs the running instance.
   */
  yTransition: Transition;
  /**
   * Optional callback fired when `emit()` lands on an idle engine. The host
   * (chart) uses this to (re-)start its RAF loop after stop-on-settle.
   */
  onWake?: () => void;
}

export interface AnimationEngine {
  emit(event: AnimationEvent): void;
  tick(now: number): AnimationState;
  getAnimationState(): AnimationState;
  flush(): void;
  registerSeriesPulse(seriesId: string, period: Milliseconds): void;
  unregisterSeriesPulse(seriesId: string): void;
  dropEntry(seriesId: string, layerIdx: number, time: number): void;
  dropSlot(target: SlotTarget, key?: string | number): void;
}

// =============================================================================
// Internal types
// =============================================================================

interface SealedEvent {
  kind: TransitionKind;
  /** May be NaN as a sentinel until the first tick after wake-up. */
  startWall: number;
  duration: Milliseconds;
  emitSeq: number;
  targets: AnimationEvent['targets'];
}

interface ScalarSlot {
  current: number;
  /** Sampled at the most recent tick. Units: value-units per millisecond. */
  velocity: number;
  activeEvent: SealedEvent | null;
  /** Frozen at handoff. Does not update each frame — without freeze the
   *  easing curve loses shape (leaky integrator → fps-dependent). */
  from: number;
  fromVelocity: number;
  /** `effectiveNow` at which `activeEvent` was elected. */
  activatedAt: number;
  /**
   * `emitSeq` values that lost the slot's election and must NOT be revived
   * if a higher-priority winner expires before they do. Pruned alongside
   * in-flight events.
   */
  droppedClaims: Set<number>;
}

interface RangeSlot {
  current: VisibleRange;
  velocity: { from: number; to: number };
  activeEvent: SealedEvent | null;
  from: VisibleRange;
  fromVelocity: { from: number; to: number };
  activatedAt: number;
  droppedClaims: Set<number>;
}

interface OHLCSlot {
  current: OHLCData;
  velocity: { open: number; high: number; low: number; close: number };
  activeEvent: SealedEvent | null;
  from: OHLCData;
  fromVelocity: { open: number; high: number; low: number; close: number };
  activatedAt: number;
  droppedClaims: Set<number>;
}

/**
 * Y slot is a thin wrapper — the canonical current/velocity live inside the
 * injected `Transition` (`YRangeHermite` / `YRangeSpring` / `YRangeSnap`).
 * The engine only tracks which event is currently driving the transition
 * and which losers have been disqualified.
 */
interface YSlot {
  activeEvent: SealedEvent | null;
  activatedAt: number;
  droppedClaims: Set<number>;
}

interface MutableAnimationState {
  yRange: YRange;
  xRange: VisibleRange;
  seriesAlpha: Map<string, number>;
  entryProgress: Map<string, Map<number, number>>;
  liveValues: {
    scalar: Map<string, number>;
    ohlc: Map<string, OHLCData>;
  };
  tickOpacity: Map<number, number>;
  pulsePhase: Map<string, number>;
  animating: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derivative of {@link easeOutCubic}. `d/dt (1 − (1 − t)³) = 3·(1 − t)²`.
 * Used to compute the velocity of an outgoing winner at handoff time so the
 * incoming winner can preserve continuity.
 */
function easeOutCubicDerivative(t: number): number {
  const oneMinusT = 1 - t;

  return 3 * oneMinusT * oneMinusT;
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;

  return t;
}

function compareCandidates(a: SealedEvent, b: SealedEvent): number {
  const pa = KIND_PRIORITY[a.kind];
  const pb = KIND_PRIORITY[b.kind];
  if (pa !== pb) return pa - pb;
  if (a.startWall !== b.startWall) return a.startWall - b.startWall;

  return a.emitSeq - b.emitSeq;
}

function pickWinner(candidates: SealedEvent[]): SealedEvent {
  let winner = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (compareCandidates(c, winner) > 0) {
      winner = c;
    }
  }

  return winner;
}

/** Sign-preserving velocity overshoot clamp — see Phase 2 design "Velocity-continuous handoff". */
function clampHandoffVelocity(velocity: number, fromValue: number, target: number, duration: number): number {
  if (duration <= 0) return 0;

  const delta = target - fromValue;
  if (delta === 0) return 0;

  const deltaSign = delta > 0 ? 1 : -1;
  const vSign = velocity > 0 ? 1 : velocity < 0 ? -1 : 0;
  if (vSign !== 0 && vSign !== deltaSign) return 0;

  const vCap = Math.abs(delta) / duration;
  if (Math.abs(velocity) > vCap) {
    return vSign === 0 ? 0 : vSign * vCap;
  }

  return velocity;
}

function createScalarSlot(initial: number): ScalarSlot {
  return {
    current: initial,
    velocity: 0,
    activeEvent: null,
    from: initial,
    fromVelocity: 0,
    activatedAt: 0,
    droppedClaims: new Set(),
  };
}

function createRangeSlot(initial: VisibleRange): RangeSlot {
  return {
    current: { from: initial.from, to: initial.to },
    velocity: { from: 0, to: 0 },
    activeEvent: null,
    from: { from: initial.from, to: initial.to },
    fromVelocity: { from: 0, to: 0 },
    activatedAt: 0,
    droppedClaims: new Set(),
  };
}

function entryKey(seriesId: string, layerIdx: number, time: number): string {
  return `${seriesId}:${layerIdx}:${time}`;
}

function liveKey(seriesId: string, layerIdx: number): string {
  return `${seriesId}:${layerIdx}`;
}

// =============================================================================
// Implementation
// =============================================================================

class AnimationEngineImpl implements AnimationEngine {
  /** Injected Y curve (`YRangeHermite` / `YRangeSpring` / `YRangeSnap`). Engine drives it via retarget / snap / tick. */
  readonly #yTransition: Transition;
  /** Fires once per idle→active transition so the host (chart) can (re-)start its RAF loop. */
  readonly #onWake: (() => void) | undefined;

  /** Stable `AnimationState` instance returned by every `tick()` (P2 contract). Maps mutate in place. */
  readonly #state: MutableAnimationState;

  /** Monotonic engine clock — advances by capped dt only. Real wall-clock `now` is only used as `tick()` input. */
  #lastEffectiveNow = 0;
  /** Strictly-increasing counter for deterministic tiebreaks when two emits land in the same RAF batch. */
  #emitSeq = 0;
  /** True when there's nothing to do AND host has stopped ticking. `emit()` may then fire `onWake`. */
  #isIdle = true;
  /** Re-entrancy guard: `emit()` called while this is true routes into `#pendingEmits` instead of `#inFlight`. */
  #inTick = false;

  /** Events currently competing for slot election. Pruned by strict `>` after their duration elapses. */
  #inFlight: SealedEvent[] = [];
  /** Emits queued from inside a `tick()`. Promoted to `#inFlight` at the start of the NEXT tick with that tick's `effectiveNow` as `startWall`. */
  readonly #pendingEmits: SealedEvent[] = [];

  /** Y slot — only winner-election bookkeeping; canonical current / velocity live inside `#yTransition`. */
  readonly #ySlot: YSlot;
  /** Newest Y target observed. Used by `flush()` to snap the transition even
   *  if no `tick()` has run between the emit and the flush call. */
  #lastYTarget: YRange | null = null;
  /** Single global X viewport slot. */
  readonly #xSlot: RangeSlot;
  /** Per-series alpha cross-fade (visibility toggle). Key: `seriesId`. */
  readonly #alphaSlots = new Map<string, ScalarSlot>();
  /** Per-tick-value axis label opacity (entering 0→1, exiting 1→0). Key: numeric tick timestamp. */
  readonly #tickFadeSlots = new Map<number, ScalarSlot>();
  /** Live-value chase for scalar (line / bar) series. Key: composite `"seriesId:layerIdx"`. */
  readonly #liveScalarSlots = new Map<string, ScalarSlot>();
  /** Live-value chase for OHLC (candlestick) layers. Key: composite `"seriesId:layerIdx"`. */
  readonly #liveOHLCSlots = new Map<string, OHLCSlot>();
  /** Per-point entrance fade-in progress (target always 1). Key: composite `"seriesId:layerIdx:time"`. */
  readonly #entrySlots = new Map<string, ScalarSlot>();

  /** Registered line-series pulse periods. Key: `seriesId`, value: period ms. */
  readonly #pulseRegistry = new Map<string, number>();

  constructor(opts: AnimationEngineOptions) {
    this.#yTransition = opts.yTransition;
    this.#onWake = opts.onWake;

    this.#state = {
      yRange: { min: opts.initial.yRange.min, max: opts.initial.yRange.max },
      xRange: { from: opts.initial.xRange.from, to: opts.initial.xRange.to },
      seriesAlpha: new Map(),
      entryProgress: new Map(),
      liveValues: { scalar: new Map(), ohlc: new Map() },
      tickOpacity: new Map(),
      pulsePhase: new Map(),
      animating: false,
    };

    this.#ySlot = { activeEvent: null, activatedAt: 0, droppedClaims: new Set() };
    this.#xSlot = createRangeSlot(opts.initial.xRange);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  emit(event: AnimationEvent): void {
    const emitSeq = ++this.#emitSeq;

    const sealed: SealedEvent = {
      kind: event.kind,
      startWall: 0,
      duration: event.duration,
      emitSeq,
      targets: event.targets,
    };

    if (this.#inTick) {
      // Promoted at the start of the next tick with `startWall = effectiveNow`.
      sealed.startWall = Number.NaN;
      this.#pendingEmits.push(sealed);

      return;
    }

    // Fire onWake exactly once per idle session — when the engine transitions
    // from "nothing to do" to "first event queued". Subsequent emits before
    // the host drives a tick should NOT re-fire the callback.
    const shouldWake = this.#isIdle && this.#inFlight.length === 0 && this.#pendingEmits.length === 0;

    if (event.startWall !== undefined) {
      sealed.startWall = event.startWall;
    } else if (this.#isIdle) {
      // Sentinel: resolved on the first tick after wake-up. Without this an
      // idle-tab emit followed by a non-zero RAF dt would land with `t > 1`
      // on the first frame and prune immediately — a 1-frame blink.
      sealed.startWall = Number.NaN;
    } else {
      sealed.startWall = this.#lastEffectiveNow;
    }

    this.#inFlight.push(sealed);

    if (shouldWake && this.#onWake) {
      this.#onWake();
    }
  }

  tick(now: number): AnimationState {
    // Fast path: engine settled on the previous tick and no new emit landed
    // since. The chart's render loop still pumps `engine.tick(now)` every
    // RAF because the renderer (entrance fades, per-series live track that
    // hasn't migrated yet) reports `needsAnimation`. Allocating 7 per-slot
    // candidate Maps + filtering `inFlight` (empty) on each of those frames
    // is pure waste — they'd all produce 0 work. Skip straight to pulse
    // (closed-form, no allocation) and return the same state reference.
    //
    // `#lastEffectiveNow` intentionally stays where it was — the wake-up
    // branch below pins it to `now` on the next real emit, so the dt-clamp
    // path doesn't see a stale-by-many-frames baseline.
    if (
      this.#isIdle &&
      this.#inFlight.length === 0 &&
      this.#pendingEmits.length === 0 &&
      !this.#yTransition.animating
    ) {
      if (this.#pulseRegistry.size > 0) {
        for (const [id, period] of this.#pulseRegistry) {
          if (period > 0) {
            this.#state.pulsePhase.set(id, (now / period) % 1);
          }
        }
      }
      this.#state.animating = false;

      return this.#state;
    }

    this.#inTick = true;

    // 1. Wake-up: pin the effectiveNow clock to wall `now` and resolve any
    //    NaN-sentinel startWalls from emits that landed while idle.
    if (this.#isIdle) {
      this.#lastEffectiveNow = now;
      for (const ev of this.#inFlight) {
        if (Number.isNaN(ev.startWall)) {
          ev.startWall = now;
        }
      }
      this.#isIdle = false;
    }

    // 2. Advance effectiveNow with bg-tab clamp.
    const rawDt = now - this.#lastEffectiveNow;
    const dt = rawDt < 0 ? 0 : Math.min(rawDt, MAX_FRAME_DT);
    const effectiveNow = this.#lastEffectiveNow + dt;

    // 3. Promote pending emits with deterministic timing.
    if (this.#pendingEmits.length > 0) {
      for (const ev of this.#pendingEmits) {
        ev.startWall = effectiveNow;
        this.#inFlight.push(ev);
      }
      this.#pendingEmits.length = 0;
    }

    // 4. Prune expired (strict `>` so an event with duration=D is still
    //    in-flight on the frame where `effectiveNow === startWall + D`).
    //    In-place compaction — `Array.filter` allocates a new array on
    //    every tick × every chart, the dominant GC cost during streaming.
    if (this.#inFlight.length > 0) {
      let write = 0;
      for (let read = 0; read < this.#inFlight.length; read++) {
        const ev = this.#inFlight[read];
        if (effectiveNow <= ev.startWall + ev.duration) {
          this.#inFlight[write++] = ev;
        }
      }
      this.#inFlight.length = write;
    }

    // 5. Per-slot processing.
    this.#processYSlot(effectiveNow);
    this.#processXSlot(effectiveNow);
    this.#processAlphaSlots(effectiveNow);
    this.#processTickFadeSlots(effectiveNow);
    this.#processLiveScalarSlots(effectiveNow);
    this.#processLiveOHLCSlots(effectiveNow);
    this.#processEntrySlots(effectiveNow);

    // 6. Pulse — a single closed-form formula, not a per-event slot.
    if (this.#pulseRegistry.size > 0) {
      for (const [id, period] of this.#pulseRegistry) {
        if (period > 0) {
          this.#state.pulsePhase.set(id, (effectiveNow / period) % 1);
        }
      }
    }

    // 7. Advance Y transition. The transition holds canonical current — copy
    //    its values into our stable state.yRange reference (P2 contract).
    this.#yTransition.tick(effectiveNow);
    const yCurrent = this.#yTransition.current;
    this.#state.yRange.min = yCurrent.min;
    this.#state.yRange.max = yCurrent.max;
    this.#state.xRange.from = this.#xSlot.current.from;
    this.#state.xRange.to = this.#xSlot.current.to;

    // 8. tickOpacity prune — fully-settled slots leave the public state map.
    this.#pruneTickOpacity();

    // 9. droppedClaims sweep — eventIds that pruned out can be removed.
    this.#cleanDroppedClaims();

    // 10. Post-process zero-duration events. The startup prune (step 4)
    //     keeps them on their own `startWall` frame so slot processors can
    //     snap to their target. After all processors have run their effect
    //     is fully realised — leaving the event in `inFlight` would let it
    //     preempt later `data_tick` / `gesture` events at the same wall
    //     `now` (e.g., a synchronous `setSeriesData → appendData` burst
    //     where the chart's `#applyEngineState` ticks twice at the same
    //     mocked time in tests). Drop them here so the next emit on the
    //     same wall sees a clean slot.
    if (this.#inFlight.length > 0) {
      let write = 0;
      for (let read = 0; read < this.#inFlight.length; read++) {
        const ev = this.#inFlight[read];
        if (ev.duration > 0) {
          this.#inFlight[write++] = ev;
        }
      }
      this.#inFlight.length = write;
    }

    // 11. animating flag.
    this.#state.animating = this.#computeAnimating();

    this.#lastEffectiveNow = effectiveNow;
    this.#inTick = false;

    // Go idle when nothing is in flight, nothing is queued, Y is settled and
    // no scalar slot still has residual velocity. Next `emit()` re-wakes us.
    if (!this.#state.animating) {
      this.#isIdle = true;
    }

    return this.#state;
  }

  getAnimationState(): AnimationState {
    return this.#state;
  }

  flush(): void {
    // 0. Pre-first-tick Y catch-up: if flush() runs before any tick, the
    //    in-flight queue holds Y targets that the transition hasn't seen
    //    yet. Find the newest Y target across both queues and snap to it.
    const pendingY = this.#findNewestYTarget();
    if (pendingY !== null) {
      this.#lastYTarget = pendingY;
    }
    if (this.#lastYTarget !== null) {
      this.#yTransition.snap(this.#lastYTarget, { now: this.#lastEffectiveNow });
      this.#state.yRange.min = this.#lastYTarget.min;
      this.#state.yRange.max = this.#lastYTarget.max;
    }

    // 1. Settle scalar slots to their winner targets (if any).
    this.#flushRangeSlot(this.#xSlot, (ev) => ev.targets.x?.target);
    this.#state.xRange.from = this.#xSlot.current.from;
    this.#state.xRange.to = this.#xSlot.current.to;

    this.#flushKeyedScalarSlots(
      this.#alphaSlots,
      this.#state.seriesAlpha,
      (ev, key) => ev.targets.alpha?.find((a) => a.key === key)?.target,
    );

    // Other slot families stay empty in Phase 2 (chart-side wiring lands in Phase 3).

    // 2. Drop queues and dropped-claims sets.
    this.#inFlight.length = 0;
    this.#pendingEmits.length = 0;
    this.#ySlot.activeEvent = null;
    this.#ySlot.droppedClaims.clear();
    this.#xSlot.activeEvent = null;
    this.#xSlot.droppedClaims.clear();
    for (const slot of this.#alphaSlots.values()) {
      slot.activeEvent = null;
      slot.droppedClaims.clear();
    }
    for (const slot of this.#tickFadeSlots.values()) {
      slot.activeEvent = null;
      slot.droppedClaims.clear();
    }
    for (const slot of this.#liveScalarSlots.values()) {
      slot.activeEvent = null;
      slot.droppedClaims.clear();
    }
    for (const slot of this.#liveOHLCSlots.values()) {
      slot.activeEvent = null;
      slot.droppedClaims.clear();
    }
    for (const slot of this.#entrySlots.values()) {
      slot.activeEvent = null;
      slot.droppedClaims.clear();
    }

    this.#state.animating = false;
  }

  registerSeriesPulse(seriesId: string, period: Milliseconds): void {
    if (period <= 0) {
      this.#pulseRegistry.delete(seriesId);
      this.#state.pulsePhase.delete(seriesId);

      return;
    }

    this.#pulseRegistry.set(seriesId, period);
  }

  unregisterSeriesPulse(seriesId: string): void {
    this.#pulseRegistry.delete(seriesId);
    this.#state.pulsePhase.delete(seriesId);
  }

  dropEntry(_seriesId: string, _layerIdx: number, _time: number): void {
    // Phase 2: entry slots remain empty — renderers still own entrance state.
    // The chart-side keepLast path will start calling this in Phase 3 when
    // entry events begin emitting from the bridge.
  }

  dropSlot(target: SlotTarget, key?: string | number): void {
    if (target === 'y' || target === 'x') {
      // Persistent slots are not droppable — they always have a meaningful
      // current/target.
      return;
    }

    if (target === 'alpha' && typeof key === 'string') {
      this.#alphaSlots.delete(key);
      this.#state.seriesAlpha.delete(key);

      return;
    }

    if (target === 'tickFade' && typeof key === 'number') {
      this.#tickFadeSlots.delete(key);
      this.#state.tickOpacity.delete(key);

      return;
    }

    if (target === 'liveScalar' && typeof key === 'string') {
      this.#liveScalarSlots.delete(key);
      this.#state.liveValues.scalar.delete(key);

      return;
    }

    if (target === 'liveOHLC' && typeof key === 'string') {
      this.#liveOHLCSlots.delete(key);
      this.#state.liveValues.ohlc.delete(key);

      return;
    }

    if (target === 'entry' && typeof key === 'string') {
      this.#entrySlots.delete(key);
      // entryProgress map structure is `seriesId → (time → progress)` —
      // ephemeral helper drops the composite-keyed slot only.
    }
  }

  // ---------------------------------------------------------------------------
  // Slot processors
  // ---------------------------------------------------------------------------

  #processYSlot(effectiveNow: number): void {
    const candidates: SealedEvent[] = [];
    for (const ev of this.#inFlight) {
      if (this.#ySlot.droppedClaims.has(ev.emitSeq)) continue;
      if (ev.targets.y === undefined) continue;

      candidates.push(ev);
    }

    if (candidates.length === 0) {
      this.#ySlot.activeEvent = null;

      return;
    }

    const winner = pickWinner(candidates);
    for (const c of candidates) {
      if (c !== winner) {
        this.#ySlot.droppedClaims.add(c.emitSeq);
      }
    }

    const winnerY = winner.targets.y;
    if (winnerY === undefined) return;

    const target = winnerY.target;
    this.#lastYTarget = target;

    if (winner.duration === 0) {
      this.#yTransition.snap(target, { now: effectiveNow });
      this.#ySlot.activeEvent = null;

      return;
    }

    if (this.#ySlot.activeEvent !== winner) {
      const expandMs = winnerY.expandMs ?? winner.duration;
      const contractMs = winnerY.contractMs ?? winner.duration;
      this.#yTransition.retarget(target, {
        now: effectiveNow,
        expandMs,
        contractMs,
      });
      this.#ySlot.activatedAt = effectiveNow;
      this.#ySlot.activeEvent = winner;
    }
  }

  #processXSlot(effectiveNow: number): void {
    const candidates: SealedEvent[] = [];
    for (const ev of this.#inFlight) {
      if (this.#xSlot.droppedClaims.has(ev.emitSeq)) continue;
      if (ev.targets.x === undefined) continue;

      candidates.push(ev);
    }

    this.#advanceRangeSlot(this.#xSlot, candidates, effectiveNow, (ev) => ev.targets.x?.target);
  }

  #processAlphaSlots(effectiveNow: number): void {
    // Fast path: no in-flight event claims alpha AND no slot is stored —
    // skip the Map allocation and the outer iteration. Streaming
    // data_tick events on charts without visibility toggles hit this
    // path every frame.
    let hasAlphaEvent = false;
    for (const ev of this.#inFlight) {
      if (ev.targets.alpha !== undefined) {
        hasAlphaEvent = true;
        break;
      }
    }
    if (!hasAlphaEvent && this.#alphaSlots.size === 0) return;

    // Collect candidate events per key in a single pass.
    const candidatesByKey = new Map<string, SealedEvent[]>();
    for (const ev of this.#inFlight) {
      const alpha = ev.targets.alpha;
      if (alpha === undefined) continue;

      for (const a of alpha) {
        let slot = this.#alphaSlots.get(a.key);
        if (slot === undefined) {
          slot = createScalarSlot(this.#state.seriesAlpha.get(a.key) ?? 1);
          this.#alphaSlots.set(a.key, slot);
        }
        if (slot.droppedClaims.has(ev.emitSeq)) continue;

        let list = candidatesByKey.get(a.key);
        if (list === undefined) {
          list = [];
          candidatesByKey.set(a.key, list);
        }
        list.push(ev);
      }
    }

    for (const [key, slot] of this.#alphaSlots) {
      const candidates = candidatesByKey.get(key) ?? [];
      this.#advanceScalarSlot(slot, candidates, effectiveNow, (ev) => {
        const alpha = ev.targets.alpha;
        if (alpha === undefined) return undefined;
        const found = alpha.find((a) => a.key === key);

        return found?.target;
      });
      this.#state.seriesAlpha.set(key, slot.current);
    }
  }

  #processTickFadeSlots(effectiveNow: number): void {
    // Fast path: no in-flight event claims tickFade AND no slot is stored —
    // skip the Map allocations. The per-frame data_tick path during
    // streaming doesn't always carry a tickFade (only when the tick set
    // diffs), so this branch hits on most frames.
    let hasTickFadeEvent = false;
    for (const ev of this.#inFlight) {
      if (ev.targets.tickFade !== undefined) {
        hasTickFadeEvent = true;
        break;
      }
    }
    if (!hasTickFadeEvent && this.#tickFadeSlots.size === 0) return;

    // Two passes — entering events drive each entering value toward 1,
    // exiting values toward 0. Each tick value gets its own slot keyed by
    // the numeric value.
    const candidatesByTick = new Map<number, SealedEvent[]>();
    const targetByEventAndTick = new Map<string, number>();

    for (const ev of this.#inFlight) {
      const tickFade = ev.targets.tickFade;
      if (tickFade === undefined) continue;

      for (const t of tickFade.entering) {
        this.#ensureTickFadeSlot(t);
        targetByEventAndTick.set(`${ev.emitSeq}:${t}`, 1);
        const slot = this.#tickFadeSlots.get(t);
        if (slot && slot.droppedClaims.has(ev.emitSeq)) continue;

        let list = candidatesByTick.get(t);
        if (list === undefined) {
          list = [];
          candidatesByTick.set(t, list);
        }
        list.push(ev);
      }

      for (const t of tickFade.exiting) {
        this.#ensureTickFadeSlot(t);
        targetByEventAndTick.set(`${ev.emitSeq}:${t}`, 0);
        const slot = this.#tickFadeSlots.get(t);
        if (slot && slot.droppedClaims.has(ev.emitSeq)) continue;

        let list = candidatesByTick.get(t);
        if (list === undefined) {
          list = [];
          candidatesByTick.set(t, list);
        }
        list.push(ev);
      }
    }

    for (const [tickValue, slot] of this.#tickFadeSlots) {
      const candidates = candidatesByTick.get(tickValue) ?? [];
      this.#advanceScalarSlot(slot, candidates, effectiveNow, (ev) => {
        return targetByEventAndTick.get(`${ev.emitSeq}:${tickValue}`);
      });
      this.#state.tickOpacity.set(tickValue, slot.current);
    }
  }

  #processLiveScalarSlots(effectiveNow: number): void {
    // Fast path: no in-flight event claims liveScalar AND no slot is stored.
    // Phase 2 chart-side doesn't emit liveScalar yet (Phase 3 wires it),
    // so this branch is the entire fast-path during Phase 2 streaming.
    let hasLiveScalarEvent = false;
    for (const ev of this.#inFlight) {
      if (ev.targets.liveScalar !== undefined) {
        hasLiveScalarEvent = true;
        break;
      }
    }
    if (!hasLiveScalarEvent && this.#liveScalarSlots.size === 0) return;

    const candidatesByKey = new Map<string, SealedEvent[]>();
    const targetByEventAndKey = new Map<string, number>();

    for (const ev of this.#inFlight) {
      const live = ev.targets.liveScalar;
      if (live === undefined) continue;

      for (const item of live) {
        const key = liveKey(item.seriesId, item.layerIdx);
        let slot = this.#liveScalarSlots.get(key);
        if (slot === undefined) {
          slot = createScalarSlot(this.#state.liveValues.scalar.get(key) ?? item.target);
          this.#liveScalarSlots.set(key, slot);
        }
        targetByEventAndKey.set(`${ev.emitSeq}:${key}`, item.target);
        if (slot.droppedClaims.has(ev.emitSeq)) continue;

        let list = candidatesByKey.get(key);
        if (list === undefined) {
          list = [];
          candidatesByKey.set(key, list);
        }
        list.push(ev);
      }
    }

    for (const [key, slot] of this.#liveScalarSlots) {
      const candidates = candidatesByKey.get(key) ?? [];
      this.#advanceScalarSlot(slot, candidates, effectiveNow, (ev) => targetByEventAndKey.get(`${ev.emitSeq}:${key}`));
      this.#state.liveValues.scalar.set(key, slot.current);
    }
  }

  #processLiveOHLCSlots(effectiveNow: number): void {
    // Fast path: no in-flight event claims liveOHLC AND no slot is stored.
    // Phase 3 hooks this up; until then every Phase 2 streaming frame
    // hits this branch.
    let hasLiveOHLCEvent = false;
    for (const ev of this.#inFlight) {
      if (ev.targets.liveOHLC !== undefined) {
        hasLiveOHLCEvent = true;
        break;
      }
    }
    if (!hasLiveOHLCEvent && this.#liveOHLCSlots.size === 0) return;

    const candidatesByKey = new Map<string, SealedEvent[]>();
    const targetByEventAndKey = new Map<string, OHLCData>();

    for (const ev of this.#inFlight) {
      const live = ev.targets.liveOHLC;
      if (live === undefined) continue;

      for (const item of live) {
        const key = liveKey(item.seriesId, item.layerIdx);
        let slot = this.#liveOHLCSlots.get(key);
        if (slot === undefined) {
          const seedRef = this.#state.liveValues.ohlc.get(key) ?? item.target;
          const seed: OHLCData = {
            time: seedRef.time,
            open: seedRef.open,
            high: seedRef.high,
            low: seedRef.low,
            close: seedRef.close,
          };
          slot = {
            current: seed,
            velocity: { open: 0, high: 0, low: 0, close: 0 },
            activeEvent: null,
            from: { ...seed },
            fromVelocity: { open: 0, high: 0, low: 0, close: 0 },
            activatedAt: 0,
            droppedClaims: new Set(),
          };
          this.#liveOHLCSlots.set(key, slot);
        }
        targetByEventAndKey.set(`${ev.emitSeq}:${key}`, item.target);
        if (slot.droppedClaims.has(ev.emitSeq)) continue;

        let list = candidatesByKey.get(key);
        if (list === undefined) {
          list = [];
          candidatesByKey.set(key, list);
        }
        list.push(ev);
      }
    }

    for (const [key, slot] of this.#liveOHLCSlots) {
      const candidates = candidatesByKey.get(key) ?? [];
      this.#advanceOHLCSlot(slot, candidates, effectiveNow, (ev) => targetByEventAndKey.get(`${ev.emitSeq}:${key}`));
      this.#state.liveValues.ohlc.set(key, slot.current);
    }
  }

  #processEntrySlots(effectiveNow: number): void {
    // Fast path: same shape as the other slot processors. Phase 3 emits
    // entrance events here; through Phase 2 the renderer keeps its own
    // entries Map and this branch is the entire path.
    let hasEntryEvent = false;
    for (const ev of this.#inFlight) {
      if (ev.targets.entry !== undefined) {
        hasEntryEvent = true;
        break;
      }
    }
    if (!hasEntryEvent && this.#entrySlots.size === 0) return;

    const candidatesByKey = new Map<string, SealedEvent[]>();

    for (const ev of this.#inFlight) {
      const entries = ev.targets.entry;
      if (entries === undefined) continue;

      for (const item of entries) {
        const key = entryKey(item.seriesId, item.layerIdx, item.time);
        let slot = this.#entrySlots.get(key);
        if (slot === undefined) {
          slot = createScalarSlot(0);
          this.#entrySlots.set(key, slot);
        }
        if (slot.droppedClaims.has(ev.emitSeq)) continue;

        let list = candidatesByKey.get(key);
        if (list === undefined) {
          list = [];
          candidatesByKey.set(key, list);
        }
        list.push(ev);
      }
    }

    for (const [key, slot] of this.#entrySlots) {
      const candidates = candidatesByKey.get(key) ?? [];
      // Entry target is always 1 (fade-in).
      this.#advanceScalarSlot(slot, candidates, effectiveNow, () => 1);

      const colonIdx = key.indexOf(':');
      const lastColonIdx = key.lastIndexOf(':');
      if (colonIdx < 0 || lastColonIdx <= colonIdx) continue;
      const seriesId = key.slice(0, colonIdx);
      const time = Number.parseFloat(key.slice(lastColonIdx + 1));
      let perSeries = this.#state.entryProgress.get(seriesId);
      if (perSeries === undefined) {
        perSeries = new Map();
        this.#state.entryProgress.set(seriesId, perSeries);
      }
      perSeries.set(time, slot.current);
    }
  }

  // ---------------------------------------------------------------------------
  // Slot advance primitives
  // ---------------------------------------------------------------------------

  #advanceScalarSlot(
    slot: ScalarSlot,
    candidates: SealedEvent[],
    effectiveNow: number,
    pickTarget: (ev: SealedEvent) => number | undefined,
  ): void {
    if (candidates.length === 0) {
      // Previous winner expired between frames (RAF rarely aligns with
      // `startWall + duration` exactly). Snap the slot to that target so we
      // don't leak residual velocity into `state.animating`.
      if (slot.activeEvent !== null) {
        const expiredTarget = pickTarget(slot.activeEvent);
        if (expiredTarget !== undefined) {
          slot.current = expiredTarget;
          slot.from = expiredTarget;
        }
        slot.velocity = 0;
        slot.fromVelocity = 0;
        slot.activeEvent = null;
      } else if (Math.abs(slot.velocity) < VELOCITY_EPSILON) {
        slot.velocity = 0;
      }

      return;
    }

    const winner = pickWinner(candidates);
    for (const c of candidates) {
      if (c !== winner) {
        slot.droppedClaims.add(c.emitSeq);
      }
    }

    const target = pickTarget(winner);
    if (target === undefined) return;

    if (winner.duration === 0) {
      slot.current = target;
      slot.velocity = 0;
      slot.from = target;
      slot.fromVelocity = 0;
      slot.activeEvent = null;

      return;
    }

    if (slot.activeEvent !== winner) {
      // Handoff: advance the outgoing winner to effectiveNow first, then
      // freeze `from` and the (clamped) velocity at the handoff position.
      if (slot.activeEvent !== null) {
        const oldEv = slot.activeEvent;
        const oldTarget = pickTarget(oldEv);
        if (oldTarget !== undefined) {
          const tRaw = (effectiveNow - slot.activatedAt) / oldEv.duration;
          const t = clamp01(tRaw);
          slot.current = slot.from + easeOutCubic(t) * (oldTarget - slot.from);
          slot.velocity = t >= 1 ? 0 : (easeOutCubicDerivative(t) * (oldTarget - slot.from)) / oldEv.duration;
        }
      }
      slot.from = slot.current;
      slot.fromVelocity = clampHandoffVelocity(slot.velocity, slot.from, target, winner.duration);
      slot.activatedAt = effectiveNow;
      slot.activeEvent = winner;
    }

    const tRaw = (effectiveNow - slot.activatedAt) / winner.duration;
    const t = clamp01(tRaw);
    const eased = easeOutCubic(t);
    slot.current = slot.from + eased * (target - slot.from);
    slot.velocity = t >= 1 ? 0 : (easeOutCubicDerivative(t) * (target - slot.from)) / winner.duration;
  }

  #advanceRangeSlot(
    slot: RangeSlot,
    candidates: SealedEvent[],
    effectiveNow: number,
    pickTarget: (ev: SealedEvent) => VisibleRange | undefined,
  ): void {
    if (candidates.length === 0) {
      if (slot.activeEvent !== null) {
        const expiredTarget = pickTarget(slot.activeEvent);
        if (expiredTarget !== undefined) {
          slot.current.from = expiredTarget.from;
          slot.current.to = expiredTarget.to;
          slot.from.from = expiredTarget.from;
          slot.from.to = expiredTarget.to;
        }
        slot.velocity.from = 0;
        slot.velocity.to = 0;
        slot.fromVelocity.from = 0;
        slot.fromVelocity.to = 0;
        slot.activeEvent = null;
      } else {
        if (Math.abs(slot.velocity.from) < VELOCITY_EPSILON) slot.velocity.from = 0;
        if (Math.abs(slot.velocity.to) < VELOCITY_EPSILON) slot.velocity.to = 0;
      }

      return;
    }

    const winner = pickWinner(candidates);
    for (const c of candidates) {
      if (c !== winner) {
        slot.droppedClaims.add(c.emitSeq);
      }
    }

    const target = pickTarget(winner);
    if (target === undefined) return;

    if (winner.duration === 0) {
      slot.current.from = target.from;
      slot.current.to = target.to;
      slot.velocity.from = 0;
      slot.velocity.to = 0;
      slot.from.from = target.from;
      slot.from.to = target.to;
      slot.fromVelocity.from = 0;
      slot.fromVelocity.to = 0;
      slot.activeEvent = null;

      return;
    }

    if (slot.activeEvent !== winner) {
      if (slot.activeEvent !== null) {
        const oldEv = slot.activeEvent;
        const oldTarget = pickTarget(oldEv);
        if (oldTarget !== undefined) {
          const tRaw = (effectiveNow - slot.activatedAt) / oldEv.duration;
          const t = clamp01(tRaw);
          const eased = easeOutCubic(t);
          slot.current.from = slot.from.from + eased * (oldTarget.from - slot.from.from);
          slot.current.to = slot.from.to + eased * (oldTarget.to - slot.from.to);
          if (t >= 1) {
            slot.velocity.from = 0;
            slot.velocity.to = 0;
          } else {
            const deriv = easeOutCubicDerivative(t);
            slot.velocity.from = (deriv * (oldTarget.from - slot.from.from)) / oldEv.duration;
            slot.velocity.to = (deriv * (oldTarget.to - slot.from.to)) / oldEv.duration;
          }
        }
      }
      slot.from.from = slot.current.from;
      slot.from.to = slot.current.to;
      slot.fromVelocity.from = clampHandoffVelocity(slot.velocity.from, slot.from.from, target.from, winner.duration);
      slot.fromVelocity.to = clampHandoffVelocity(slot.velocity.to, slot.from.to, target.to, winner.duration);
      slot.activatedAt = effectiveNow;
      slot.activeEvent = winner;
    }

    const tRaw = (effectiveNow - slot.activatedAt) / winner.duration;
    const t = clamp01(tRaw);
    const eased = easeOutCubic(t);
    slot.current.from = slot.from.from + eased * (target.from - slot.from.from);
    slot.current.to = slot.from.to + eased * (target.to - slot.from.to);
    if (t >= 1) {
      slot.velocity.from = 0;
      slot.velocity.to = 0;
    } else {
      const deriv = easeOutCubicDerivative(t);
      slot.velocity.from = (deriv * (target.from - slot.from.from)) / winner.duration;
      slot.velocity.to = (deriv * (target.to - slot.from.to)) / winner.duration;
    }
  }

  #advanceOHLCSlot(
    slot: OHLCSlot,
    candidates: SealedEvent[],
    effectiveNow: number,
    pickTarget: (ev: SealedEvent) => OHLCData | undefined,
  ): void {
    if (candidates.length === 0) {
      if (slot.activeEvent !== null) {
        const expiredTarget = pickTarget(slot.activeEvent);
        if (expiredTarget !== undefined) {
          slot.current = { ...expiredTarget };
          slot.from = { ...expiredTarget };
        }
        slot.velocity = { open: 0, high: 0, low: 0, close: 0 };
        slot.fromVelocity = { open: 0, high: 0, low: 0, close: 0 };
        slot.activeEvent = null;
      }

      return;
    }

    const winner = pickWinner(candidates);
    for (const c of candidates) {
      if (c !== winner) {
        slot.droppedClaims.add(c.emitSeq);
      }
    }

    const target = pickTarget(winner);
    if (target === undefined) return;

    if (winner.duration === 0) {
      slot.current = { ...target };
      slot.from = { ...target };
      slot.activeEvent = null;
      slot.velocity = { open: 0, high: 0, low: 0, close: 0 };
      slot.fromVelocity = { open: 0, high: 0, low: 0, close: 0 };

      return;
    }

    if (slot.activeEvent !== winner) {
      if (slot.activeEvent !== null) {
        const oldEv = slot.activeEvent;
        const oldTarget = pickTarget(oldEv);
        if (oldTarget !== undefined) {
          const tRaw = (effectiveNow - slot.activatedAt) / oldEv.duration;
          const t = clamp01(tRaw);
          const eased = easeOutCubic(t);
          slot.current = {
            time: oldTarget.time,
            open: slot.from.open + eased * (oldTarget.open - slot.from.open),
            high: slot.from.high + eased * (oldTarget.high - slot.from.high),
            low: slot.from.low + eased * (oldTarget.low - slot.from.low),
            close: slot.from.close + eased * (oldTarget.close - slot.from.close),
          };
        }
      }
      slot.from = { ...slot.current };
      slot.activatedAt = effectiveNow;
      slot.activeEvent = winner;
    }

    const tRaw = (effectiveNow - slot.activatedAt) / winner.duration;
    const t = clamp01(tRaw);
    const eased = easeOutCubic(t);
    slot.current = {
      time: target.time,
      open: slot.from.open + eased * (target.open - slot.from.open),
      high: slot.from.high + eased * (target.high - slot.from.high),
      low: slot.from.low + eased * (target.low - slot.from.low),
      close: slot.from.close + eased * (target.close - slot.from.close),
    };
  }

  // ---------------------------------------------------------------------------
  // Misc helpers
  // ---------------------------------------------------------------------------

  #ensureTickFadeSlot(tickValue: number): void {
    if (!this.#tickFadeSlots.has(tickValue)) {
      const initial = this.#state.tickOpacity.get(tickValue) ?? 0;
      this.#tickFadeSlots.set(tickValue, createScalarSlot(initial));
    }
  }

  #pruneTickOpacity(): void {
    for (const [tickValue, slot] of this.#tickFadeSlots) {
      if (slot.activeEvent !== null) continue;

      if (slot.current <= 0.001) {
        this.#tickFadeSlots.delete(tickValue);
        this.#state.tickOpacity.delete(tickValue);
      } else if (slot.current >= 1 - 0.001) {
        // Fully visible — fade complete; we can remove the slot but keep
        // the value in the public map so the renderer still draws the tick.
        this.#tickFadeSlots.delete(tickValue);
        this.#state.tickOpacity.set(tickValue, 1);
      }
    }
  }

  #findNewestYTarget(): YRange | null {
    let newest: SealedEvent | null = null;
    for (const ev of this.#inFlight) {
      if (ev.targets.y === undefined) continue;
      if (newest === null || ev.emitSeq > newest.emitSeq) {
        newest = ev;
      }
    }
    for (const ev of this.#pendingEmits) {
      if (ev.targets.y === undefined) continue;
      if (newest === null || ev.emitSeq > newest.emitSeq) {
        newest = ev;
      }
    }

    return newest?.targets.y?.target ?? null;
  }

  #flushRangeSlot(slot: RangeSlot, pickTarget: (ev: SealedEvent) => VisibleRange | undefined): void {
    let newestTarget: VisibleRange | undefined;
    let newestSeq = -1;
    for (const ev of this.#inFlight) {
      const t = pickTarget(ev);
      if (t === undefined) continue;
      if (ev.emitSeq > newestSeq) {
        newestSeq = ev.emitSeq;
        newestTarget = t;
      }
    }
    for (const ev of this.#pendingEmits) {
      const t = pickTarget(ev);
      if (t === undefined) continue;
      if (ev.emitSeq > newestSeq) {
        newestSeq = ev.emitSeq;
        newestTarget = t;
      }
    }
    if (newestTarget !== undefined) {
      slot.current.from = newestTarget.from;
      slot.current.to = newestTarget.to;
      slot.from.from = newestTarget.from;
      slot.from.to = newestTarget.to;
      slot.velocity.from = 0;
      slot.velocity.to = 0;
      slot.fromVelocity.from = 0;
      slot.fromVelocity.to = 0;
    }
  }

  #flushKeyedScalarSlots(
    slots: Map<string, ScalarSlot>,
    publicMap: Map<string, number>,
    pickTarget: (ev: SealedEvent, key: string) => number | undefined,
  ): void {
    for (const [key, slot] of slots) {
      let newestTarget: number | undefined;
      let newestSeq = -1;
      for (const ev of this.#inFlight) {
        const t = pickTarget(ev, key);
        if (t === undefined) continue;
        if (ev.emitSeq > newestSeq) {
          newestSeq = ev.emitSeq;
          newestTarget = t;
        }
      }
      for (const ev of this.#pendingEmits) {
        const t = pickTarget(ev, key);
        if (t === undefined) continue;
        if (ev.emitSeq > newestSeq) {
          newestSeq = ev.emitSeq;
          newestTarget = t;
        }
      }
      if (newestTarget !== undefined) {
        slot.current = newestTarget;
        slot.from = newestTarget;
        slot.velocity = 0;
        slot.fromVelocity = 0;
        publicMap.set(key, newestTarget);
      }
    }
  }

  #cleanDroppedClaims(): void {
    if (this.#inFlight.length === 0 && this.#pendingEmits.length === 0) {
      // Everything pruned — drop every claim across every slot.
      this.#ySlot.droppedClaims.clear();
      this.#xSlot.droppedClaims.clear();
      for (const slot of this.#alphaSlots.values()) slot.droppedClaims.clear();
      for (const slot of this.#tickFadeSlots.values()) slot.droppedClaims.clear();
      for (const slot of this.#liveScalarSlots.values()) slot.droppedClaims.clear();
      for (const slot of this.#liveOHLCSlots.values()) slot.droppedClaims.clear();
      for (const slot of this.#entrySlots.values()) slot.droppedClaims.clear();

      return;
    }

    const alive = new Set<number>();
    for (const ev of this.#inFlight) alive.add(ev.emitSeq);
    for (const ev of this.#pendingEmits) alive.add(ev.emitSeq);

    this.#sweepDropped(this.#ySlot.droppedClaims, alive);
    this.#sweepDropped(this.#xSlot.droppedClaims, alive);
    for (const slot of this.#alphaSlots.values()) this.#sweepDropped(slot.droppedClaims, alive);
    for (const slot of this.#tickFadeSlots.values()) this.#sweepDropped(slot.droppedClaims, alive);
    for (const slot of this.#liveScalarSlots.values()) this.#sweepDropped(slot.droppedClaims, alive);
    for (const slot of this.#liveOHLCSlots.values()) this.#sweepDropped(slot.droppedClaims, alive);
    for (const slot of this.#entrySlots.values()) this.#sweepDropped(slot.droppedClaims, alive);
  }

  #sweepDropped(claims: Set<number>, alive: Set<number>): void {
    if (claims.size === 0) return;

    for (const seq of claims) {
      if (!alive.has(seq)) {
        claims.delete(seq);
      }
    }
  }

  #computeAnimating(): boolean {
    if (this.#inFlight.length > 0) return true;
    if (this.#pendingEmits.length > 0) return true;
    if (this.#yTransition.animating) return true;

    if (Math.abs(this.#xSlot.velocity.from) >= VELOCITY_EPSILON) return true;
    if (Math.abs(this.#xSlot.velocity.to) >= VELOCITY_EPSILON) return true;

    for (const slot of this.#alphaSlots.values()) {
      if (Math.abs(slot.velocity) >= VELOCITY_EPSILON) return true;
    }
    for (const slot of this.#tickFadeSlots.values()) {
      if (Math.abs(slot.velocity) >= VELOCITY_EPSILON) return true;
    }
    for (const slot of this.#liveScalarSlots.values()) {
      if (Math.abs(slot.velocity) >= VELOCITY_EPSILON) return true;
    }

    return false;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAnimationEngine(opts: AnimationEngineOptions): AnimationEngine {
  return new AnimationEngineImpl(opts);
}
