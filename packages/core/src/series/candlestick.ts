import { Animator } from '../animation/animator';
import { DEFAULT_CANDLESTICK_ENTRY, DEFAULT_CANDLESTICK_SMOOTH } from '../animation/config';
import { decimateOHLCData } from '../data/decimation';
import type { TimeSeriesStore } from '../data/store';
import { resolveCandlestickBodyColor } from '../theme/resolve';
import type { ChartTheme } from '../theme/types';
import type { CandlestickSeriesOptions, OHLCData, OHLCInput } from '../types';
import { hexToRgba } from '../utils/color';
import { lerp } from '../utils/math';
import { isPoisonedNumber, reportPoisonedData } from '../utils/poisoned-data-reporter';
import { normalizeOHLCArray, normalizeTime } from '../utils/time';
import { resolveMs } from './shared-animation';
import type { SeriesRenderContext, SeriesRenderer } from './types';

/** Per-candle entrance state — start wall-time so progress is `(now - startTime) / entryMs`. */
interface EntryState {
  startTime: number;
}

/** Component-wise lerp for an OHLC quadruple; lerps `volume` too when either side carries one. */
function ohlcLerp(a: OHLCData, b: OHLCData, t: number): OHLCData {
  const r: OHLCData = {
    time: b.time,
    open: a.open + (b.open - a.open) * t,
    high: a.high + (b.high - a.high) * t,
    low: a.low + (b.low - a.low) * t,
    close: a.close + (b.close - a.close) * t,
  };
  if (a.volume !== undefined || b.volume !== undefined) {
    const va = a.volume ?? 0;
    const vb = b.volume ?? 0;
    r.volume = va + (vb - va) * t;
  }

  return r;
}

function ohlcEquals(a: OHLCData, b: OHLCData): boolean {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    (a.volume ?? 0) === (b.volume ?? 0)
  );
}

const DEFAULT_OPTIONS: CandlestickSeriesOptions = {
  up: { body: '#26a69a', wick: '#26a69a' },
  down: { body: '#ef5350', wick: '#ef5350' },
  bodyWidthRatio: 0.6,
};

/**
 * Normalize caller-supplied candlestick options. Folds the deprecated
 * `enterAnimation` and `enterMs` aliases into `entryAnimation` and `entryMs`.
 */
function normalizeCandlestickOptions(input?: Partial<CandlestickSeriesOptions>): Partial<CandlestickSeriesOptions> {
  if (!input) return {};

  const out: Partial<CandlestickSeriesOptions> = { ...input };
  if (input.enterAnimation !== undefined && input.entryAnimation === undefined) {
    out.entryAnimation = input.enterAnimation;
  }
  if (input.enterMs !== undefined && input.entryMs === undefined) {
    out.entryMs = input.enterMs;
  }

  return out;
}

export class CandlestickRenderer implements SeriesRenderer {
  readonly store: TimeSeriesStore<OHLCData>;
  private options: CandlestickSeriesOptions;

  // --- Animation state ----------------------------------------------------
  /** Smoothed OHLC for the live last candle. Reset on `appendPoint` (new
   *  candle → identity snap) and chased on `updateLastPoint`. */
  protected displayedLast: OHLCData | null = null;
  /** Per-candle entrance registry. Single-layer, so no per-layer split. */
  protected readonly entries: Map<number, EntryState> = new Map();
  #liveAnimator: Animator<OHLCData> | null = null;
  /** Series-level alpha for visibility cross-fade. Chart calls {@link setAlpha} on hide. */
  readonly #alphaAnimator: Animator<number> = new Animator<number>({
    initial: 1,
    duration: 0,
    lerp: (a, b, t) => a + (b - a) * t,
  });

  constructor(store: TimeSeriesStore<OHLCData>, options?: Partial<CandlestickSeriesOptions>) {
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...normalizeCandlestickOptions(options) };
    // Seed `displayedLast` from the (possibly pre-populated) store — `setData`
    // doesn't run when the caller pre-loaded the store before construction,
    // so without this seed the first `updateLastPoint` would lazily anchor
    // its chase at the target and visually snap.
    this.displayedLast = store.last() ?? null;
  }

  private resolvedEntryMs(): number {
    return resolveMs(this.options.entryMs, DEFAULT_CANDLESTICK_ENTRY);
  }

  private resolvedSmoothMs(): number {
    return resolveMs(this.options.smoothMs, DEFAULT_CANDLESTICK_SMOOTH);
  }

  private isEntryEnabled(): boolean {
    return (this.options.entryAnimation ?? 'unfold') !== 'none';
  }

  updateOptions(options: Partial<CandlestickSeriesOptions>): void {
    this.options = { ...this.options, ...normalizeCandlestickOptions(options) };
  }

  getColor(): string {
    return resolveCandlestickBodyColor(this.options.up.body);
  }

  // --- SeriesRenderer interface implementation ------------------------------

  setData(data: unknown): void {
    this.store.setData(normalizeOHLCArray((data ?? []) as OHLCInput[]));

    // Bulk replace — seed `displayedLast` to the new last candle, drop any
    // in-flight chase and per-candle entries so the next render paints the
    // canonical dataset with no leftover animation.
    const last = this.store.last();
    this.displayedLast = last ?? null;
    this.#liveAnimator = null;
    this.entries.clear();
  }

  appendPoint(point: unknown): void {
    const p = point as OHLCInput;
    const time = normalizeTime(p.time);
    const candle: OHLCData = { ...p, time };
    this.store.append(candle);

    // Identity snap on append: a new candle's first frame must show its
    // exact OHLC, not an interpolation from the previous candle's close.
    this.displayedLast = candle;
    this.#liveAnimator = null;

    const entryMs = this.resolvedEntryMs();
    if (this.isEntryEnabled() && entryMs > 0) {
      this.entries.set(time, { startTime: performance.now() });
    }
  }

  updateLastPoint(point: unknown): void {
    const p = point as OHLCInput;
    const time = normalizeTime(p.time);
    const target: OHLCData = { ...p, time };
    this.store.updateLast(target);

    const smoothMs = this.resolvedSmoothMs();
    if (smoothMs <= 0) {
      this.displayedLast = target;
      this.#liveAnimator = null;
      return;
    }

    let anim = this.#liveAnimator;
    if (anim === null) {
      const initial = this.displayedLast ?? target;
      anim = new Animator<OHLCData>({
        initial,
        duration: smoothMs,
        lerp: ohlcLerp,
        equals: ohlcEquals,
      });
      this.#liveAnimator = anim;
    }

    anim.setTarget(target);
  }

  keepLast(count: number): void {
    if (count < 0) return;

    const drop = this.store.length - count;
    if (drop <= 0) return;

    this.store.trimStart(drop);
  }

  getLayerCount(): number {
    return 1;
  }

  setLayerVisible(_index: number, _visible: boolean): void {
    // Candlestick has a single layer; visibility is managed by the chart.
  }

  isLayerVisible(_index: number): boolean {
    return true;
  }

  getLayerColors(): string[] {
    return [resolveCandlestickBodyColor(this.options.up.body)];
  }

  applyTheme(theme: ChartTheme, _prev: ChartTheme): void {
    this.updateOptions({
      up: { ...theme.candlestick.up },
      down: { ...theme.candlestick.down },
    });
  }

  onDataChanged(listener: () => void): () => void {
    this.store.on('update', listener);
    return () => this.store.off('update', listener);
  }

  dispose(): void {
    this.store.removeAllListeners();
  }

  // --- Animation lifecycle ------------------------------------------------

  /**
   * Advance the live-OHLC chase + alpha fade against `now` and prune
   * fully-settled entrance entries. Called from `render()` once per frame.
   */
  private tickAnimations(now: number): void {
    this.#alphaAnimator.tick(now);

    const anim = this.#liveAnimator;
    if (anim !== null) {
      const stillAnimating = anim.tick(now);
      this.displayedLast = anim.current;
      if (!stillAnimating) this.#liveAnimator = null;
    }

    const entryMs = this.resolvedEntryMs();
    if (entryMs <= 0) {
      this.entries.clear();
      return;
    }

    for (const [time, state] of this.entries) {
      if (now - state.startTime >= entryMs) this.entries.delete(time);
    }
  }

  /** True while OHLC chase, any per-candle entrance, or alpha fade is unsettled. */
  get needsAnimation(): boolean {
    return this.#alphaAnimator.animating || this.#liveAnimator !== null || this.entries.size > 0;
  }

  /** Abort in-flight per-candle entrance animations. Live-OHLC chase is left intact. */
  cancelEntranceAnimations(): void {
    this.entries.clear();
  }

  setAlpha(target: number, durationMs: number): void {
    this.#alphaAnimator.setTarget(target, { duration: durationMs });
  }

  getAlpha(): number {
    return this.#alphaAnimator.current;
  }

  getLastValue(): number | null {
    const last = this.store.last();
    return last ? last.close : null;
  }

  getDataAtTime(time: number, interval: number): OHLCData | null {
    return this.store.findNearest(time, interval);
  }

  render(ctx: SeriesRenderContext): void {
    this.tickAnimations(performance.now());

    const { scope, timeScale, yScale, dataInterval } = ctx;
    const { context, horizontalPixelRatio } = scope;
    const range = timeScale.getRange();

    let visibleData = this.store.getVisibleData(range.from, range.to);
    const pixelWidth = scope.mediaSize.width;
    const decimated = visibleData.length > pixelWidth * 2;
    if (decimated) {
      visibleData = decimateOHLCData(visibleData, Math.round(pixelWidth * 1.5));
    }
    if (visibleData.length === 0) return;

    // Substitute the smoothed OHLC for the live last candle so its body and
    // wick track the real last value without jumping. Decimation loses per-
    // `time` identity, so substitution is skipped on those frames.
    const displayedLast = this.displayedLast;
    if (!decimated && displayedLast !== null) {
      const lastIdx = visibleData.length - 1;
      if (visibleData[lastIdx].time === displayedLast.time) {
        visibleData = [...visibleData.slice(0, lastIdx), displayedLast];
      }
    }

    // Snapshot entrance progress per candle up-front so drawCandles batches
    // (bulls + bears) see a consistent value and we don't probe the entry
    // map twice per candle. `null` means no active entries this frame —
    // downstream branches read `entranceByTime?.get(time) ?? 1` and fast-path.
    let entranceByTime: Map<number, number> | null = null;
    if (this.entries.size > 0) {
      const entryMs = this.resolvedEntryMs();
      const now = performance.now();
      for (const c of visibleData) {
        const state = this.entries.get(c.time);
        if (state === undefined) continue;

        const elapsed = now - state.startTime;
        const progress = entryMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / entryMs));
        if (progress >= 1) continue;

        if (entranceByTime === null) entranceByTime = new Map();
        entranceByTime.set(c.time, progress);
      }
    }

    // Bar-slot width. Only cap when the visible range is *sparse* (≤ 2
    // candles) so `barWidthBitmap(dataInterval)` is producing a bogus
    // chart-wide slot. Legitimate zoom (user dragging in on 3+ candles)
    // must keep its wide bars — a blanket cap would crush intentional
    // magnification to thin slivers.
    const naturalBarWidth = timeScale.barWidthBitmap(dataInterval);
    const sparseCap = Math.round(30 * horizontalPixelRatio);
    const barWidth = visibleData.length <= 2 ? Math.min(sparseCap, naturalBarWidth) : naturalBarWidth;
    const wickWidth = Math.max(1, Math.round(horizontalPixelRatio));
    // Match body parity to wick parity so both rectangles have their
    // pixel-accurate centers on the same sub-pixel column. Without this,
    // `Math.floor(bodyWidth / 2)` can offset the body 0.5 bitmap-px sideways
    // relative to the wick (odd-vs-even width parity mismatch), which reads
    // as a visibly off-center wick — especially at small bar widths or DPR=1.
    let bodyWidth = Math.max(1, Math.round(barWidth * this.options.bodyWidthRatio) - 2);
    if ((bodyWidth & 1) !== (wickWidth & 1)) {
      // Down-trim by 1 when possible; when bodyWidth is already the minimum
      // (1) and the wick is even (DPR=2), bump UP to 2 so the parity match
      // holds instead of silently leaving a 0.5-bitmap-px offset.
      bodyWidth = bodyWidth > 1 ? bodyWidth - 1 : 2;
    }
    const halfBody = Math.floor(bodyWidth / 2);

    // Draw volume first (behind candles)
    const chartBitmapHeight = Math.round(yScale.getMediaHeight() * scope.verticalPixelRatio);
    this.drawVolume({
      ctx: context,
      data: visibleData,
      timeScale,
      chartHeight: chartBitmapHeight,
      barWidth,
      wickWidth,
      entranceByTime,
    });

    // Then candles on top
    // Filter out poisoned bars whose OHLC fields contain `NaN` or
    // `±Infinity`. Pre-`6e76ab5` (when bodies used a flat `fillStyle +
    // fillRect`) NaN coordinates were silently no-op'd by the canvas
    // API; once gradient bodies landed,
    // `ctx.createLinearGradient(NaN, ...)` started throwing mid-paint
    // and aborting the whole frame. `isPoisonedNumber` deliberately
    // lets `null` / `undefined` pass — they coerce to `0` through
    // `valueToY`'s arithmetic and master ships working behavior for
    // those (renders as a thin bar at the Y origin).
    const bullish: OHLCData[] = [];
    const bearish: OHLCData[] = [];
    const poisonedIndices: number[] = [];
    let firstPoisonedBar: OHLCData | null = null;
    for (let i = 0; i < visibleData.length; i++) {
      const candle = visibleData[i];
      if (
        isPoisonedNumber(candle.open) ||
        isPoisonedNumber(candle.close) ||
        isPoisonedNumber(candle.high) ||
        isPoisonedNumber(candle.low)
      ) {
        poisonedIndices.push(i);
        if (firstPoisonedBar === null) firstPoisonedBar = candle;
        continue;
      }
      if (candle.close >= candle.open) bullish.push(candle);
      else bearish.push(candle);
    }
    if (firstPoisonedBar !== null) {
      reportPoisonedData(this, 'candlestick', poisonedIndices, `time ${firstPoisonedBar.time}`);
    }

    const baseCandleArgs = {
      ctx: context,
      timeScale,
      yScale,
      halfBody,
      bodyWidth,
      wickWidth,
      entranceByTime,
    };
    this.drawCandles({
      ...baseCandleArgs,
      candles: bullish,
      body: this.options.up.body,
      wickColor: this.options.up.wick,
    });
    this.drawCandles({
      ...baseCandleArgs,
      candles: bearish,
      body: this.options.down.body,
      wickColor: this.options.down.wick,
    });
  }

  private drawVolume({
    ctx,
    data,
    timeScale,
    chartHeight,
    barWidth,
    wickWidth,
    entranceByTime,
  }: {
    ctx: CanvasRenderingContext2D;
    data: OHLCData[];
    timeScale: import('../scales/time-scale').TimeScale;
    chartHeight: number;
    barWidth: number;
    wickWidth: number;
    entranceByTime: Map<number, number> | null;
  }): void {
    // Find max volume for scaling. Filter non-finite values — `Infinity`
    // would poison `maxVol` (collapsing every real bar to ~1 px), `NaN`
    // slips past `>` comparisons silently, and `null` coerces to 0 but can
    // still reach the draw loop below.
    let maxVol = 0;
    for (const c of data) {
      if (Number.isFinite(c.volume) && (c.volume as number) > maxVol) maxVol = c.volume as number;
    }
    if (maxVol === 0) return;

    // Volume occupies bottom 20% of chart. Match the wick's parity so volume
    // bars and candles share a vertical axis of symmetry — same rationale as
    // the body/wick parity fix in `render`.
    const volumeMaxHeight = chartHeight * 0.2;
    let volBarWidth = Math.max(1, barWidth - 2);
    if ((volBarWidth & 1) !== (wickWidth & 1)) {
      volBarWidth = volBarWidth > 1 ? volBarWidth - 1 : 2;
    }
    const halfBar = Math.floor(volBarWidth / 2);

    const upVolumeColor = hexToRgba(resolveCandlestickBodyColor(this.options.up.body), 0.2);
    const downVolumeColor = hexToRgba(resolveCandlestickBodyColor(this.options.down.body), 0.2);

    const style = this.options.entryAnimation ?? 'unfold';

    for (const c of data) {
      // Same finiteness filter as the maxVol loop — catches undefined, 0,
      // NaN, ±Infinity, and null all at once.
      if (!Number.isFinite(c.volume) || (c.volume as number) <= 0) continue;

      const vol = c.volume as number;
      const cx = timeScale.timeToBitmapX(c.time);
      const h = Math.max(1, (vol / maxVol) * volumeMaxHeight);
      const isUp = c.close >= c.open;

      ctx.fillStyle = isUp ? upVolumeColor : downVolumeColor;

      const progress = entranceByTime?.get(c.time) ?? 1;
      if (progress >= 1 || style === 'none') {
        ctx.fillRect(cx - halfBar, chartHeight - h, volBarWidth, h);
        continue;
      }

      // Mirror the candle body's entrance. Anchor grow/unfold from chartHeight
      // (baseline) so the bar rises from the bottom — matches the candle's
      // body unfold from openY.
      const t = applyCandleTransform(progress, style, {
        x: cx - halfBar,
        barWidth: volBarWidth,
        anchorY: chartHeight,
        topY: chartHeight - h,
        bottomY: chartHeight,
      });
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.fillRect(t.x, t.topY, volBarWidth, Math.max(1, t.bottomY - t.topY));
      ctx.restore();
    }
  }

  private drawCandles({
    ctx,
    candles,
    timeScale,
    yScale,
    halfBody,
    bodyWidth,
    wickWidth,
    body,
    wickColor,
    entranceByTime,
  }: {
    ctx: CanvasRenderingContext2D;
    candles: OHLCData[];
    timeScale: import('../scales/time-scale').TimeScale;
    yScale: import('../scales/y-scale').YScale;
    halfBody: number;
    bodyWidth: number;
    wickWidth: number;
    body: string | [string, string];
    wickColor: string;
    entranceByTime: Map<number, number> | null;
  }): void {
    if (candles.length === 0) return;

    const style = this.options.entryAnimation ?? 'unfold';
    const barWidth = bodyWidth + 2; // approximate slot width used for 'slide' horizontal offset

    // Wicks
    ctx.fillStyle = wickColor;
    for (const c of candles) {
      const progress = entranceByTime?.get(c.time) ?? 1;
      const cx = timeScale.timeToBitmapX(c.time);
      const openY = yScale.valueToBitmapY(c.open);
      const highY = yScale.valueToBitmapY(c.high);
      const lowY = yScale.valueToBitmapY(c.low);
      const wickX = cx - Math.floor(wickWidth / 2);

      if (progress >= 1 || style === 'none') {
        ctx.fillRect(wickX, highY, wickWidth, lowY - highY);
        continue;
      }

      const t = applyCandleTransform(progress, style, {
        x: wickX,
        barWidth,
        anchorY: openY,
        topY: highY,
        bottomY: lowY,
      });
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.fillRect(t.x, t.topY, wickWidth, Math.max(1, t.bottomY - t.topY));
      ctx.restore();
    }

    // Bodies. `body` is a `[top, bottom]` tuple (2-stop gradient) or a single
    // color (flat fill). No auto-lift; presets that want the previous lightened
    // look should pass `autoGradient(color)` in their config.
    const drawsGradient = Array.isArray(body);

    for (const c of candles) {
      const progress = entranceByTime?.get(c.time) ?? 1;
      const cx = timeScale.timeToBitmapX(c.time);
      const openY = yScale.valueToBitmapY(c.open);
      const closeY = yScale.valueToBitmapY(c.close);
      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);

      const needsTransform = progress < 1 && style !== 'none';

      let drawX = cx - halfBody;
      let drawTop = bodyTop;
      let drawHeight = bodyHeight;
      let alpha = 1;
      if (needsTransform) {
        const t = applyCandleTransform(progress, style, {
          x: cx - halfBody,
          barWidth,
          anchorY: openY,
          topY: bodyTop,
          bottomY: bodyBottom,
        });
        drawX = t.x;
        drawTop = t.topY;
        drawHeight = Math.max(1, t.bottomY - t.topY);
        alpha = t.alpha;
      }

      if (needsTransform) ctx.save();

      // Body fill. A ≤2px-tall candle can't show a gradient meaningfully, so
      // collapse both the tuple and single-color paths to a flat top-stop fill
      // — otherwise fillStyle would leak from the prior wick batch and the
      // body would render in the wick color.
      if (drawsGradient && drawHeight > 2) {
        const grad = ctx.createLinearGradient(0, drawTop, 0, drawTop + drawHeight);
        grad.addColorStop(0, body[0]);
        grad.addColorStop(1, body[1]);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = drawsGradient ? body[0] : body;
      }

      if (needsTransform) ctx.globalAlpha = alpha;
      ctx.fillRect(drawX, drawTop, bodyWidth, drawHeight);
      if (needsTransform) ctx.restore();
    }
  }
}

interface CandleTransformInput {
  x: number;
  barWidth: number;
  /** Y-coordinate around which 'unfold' scales (typically openY). */
  anchorY: number;
  /** The unanimated top Y of the element (wick: highY; body: bodyTop). */
  topY: number;
  /** The unanimated bottom Y (wick: lowY; body: bodyBottom). */
  bottomY: number;
}

interface CandleTransformOutput {
  x: number;
  topY: number;
  bottomY: number;
  alpha: number;
}

/**
 * Map an entrance progress + style onto a candle element's geometry/alpha.
 * Centralized so adding a new style is one branch here instead of touching
 * every draw site.
 */
function applyCandleTransform(
  progress: number,
  style: NonNullable<CandlestickSeriesOptions['enterAnimation']>,
  g: CandleTransformInput,
): CandleTransformOutput {
  switch (style) {
    case 'none':
      return { x: g.x, topY: g.topY, bottomY: g.bottomY, alpha: 1 };
    case 'fade':
      return { x: g.x, topY: g.topY, bottomY: g.bottomY, alpha: progress };
    case 'unfold':
      return {
        x: g.x,
        topY: lerp(g.anchorY, g.topY, progress),
        bottomY: lerp(g.anchorY, g.bottomY, progress),
        alpha: 1,
      };
    case 'slide':
      return {
        x: g.x + (1 - progress) * g.barWidth,
        topY: g.topY,
        bottomY: g.bottomY,
        alpha: progress,
      };
    case 'fade-unfold':
      return {
        x: g.x,
        topY: lerp(g.anchorY, g.topY, progress),
        bottomY: lerp(g.anchorY, g.bottomY, progress),
        alpha: progress,
      };
  }
}
