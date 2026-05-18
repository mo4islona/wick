import { DEFAULT_BAR_ENTRY, DEFAULT_BAR_SMOOTH } from '../animation/config';
import type { TimeSeriesStore } from '../data/store';
import type { ChartTheme } from '../theme/types';
import type { BarSeriesOptions, TimePoint } from '../types';
import { BaseMultiLayerSeries } from './base-multi-layer';
import type { SeriesRenderContext } from './types';

/** Internal resolved shape: `entryMs` / `smoothMs` are concrete numbers
 *  (`false` from the public surface gets normalized to `0` at the merge
 *  boundary, so downstream reads never see the disable sentinel). */
type ResolvedBarOptions = Omit<BarSeriesOptions, 'entryMs' | 'smoothMs'> & {
  entryMs: number;
  smoothMs: number;
};

const DEFAULT_OPTIONS: ResolvedBarOptions = {
  colors: ['#26a69a', '#ef5350'],
  barWidthRatio: 0.6,
  stacking: 'off',
  entryMs: DEFAULT_BAR_ENTRY,
  smoothMs: DEFAULT_BAR_SMOOTH,
};

function normalize(options: BarSeriesOptions): ResolvedBarOptions {
  return {
    ...options,
    entryMs: options.entryMs === false ? 0 : (options.entryMs ?? DEFAULT_BAR_ENTRY),
    smoothMs: options.smoothMs === false ? 0 : (options.smoothMs ?? DEFAULT_BAR_SMOOTH),
  };
}

export class BarRenderer extends BaseMultiLayerSeries<TimePoint> {
  protected declare options: ResolvedBarOptions;

  constructor(layerCount: number, options?: Partial<BarSeriesOptions>) {
    super(layerCount);
    this.options = normalize({ ...DEFAULT_OPTIONS, ...options });
  }

  /** For chart compatibility — returns first store */
  get store(): TimeSeriesStore<TimePoint> {
    return this.stores[0];
  }

  updateOptions(options: Partial<BarSeriesOptions>): void {
    this.options = normalize({ ...this.options, ...options });
  }

  protected isEntryEnabled(): boolean {
    return (this.options.entryAnimation ?? 'fade-grow') !== 'none';
  }

  applyTheme(theme: ChartTheme, prev: ChartTheme): void {
    // Only swap colors that still match the previous theme's defaults — that
    // preserves caller-supplied palettes (e.g. candlestick up/down for a P&L
    // bar) across theme switches, while still tracking the active theme for
    // colors the caller didn't override.
    const prevDefaults = prev.seriesColors;
    const current = this.options.colors;
    const next = current.map((c, i) => (c === prevDefaults[i] ? (theme.seriesColors[i] ?? c) : c));

    this.updateOptions({ colors: next });
  }

  /**
   * Shape of the per-bar entrance transform. Centralized so the entrance style
   * is a single switch; new styles like 'slide' drop in here without touching
   * each render path.
   */
  private applyBarTransform(
    progress: number,
    baselineY: number,
    topY: number,
    barHeight: number,
    x: number,
    barWidth: number,
  ): { topY: number; barHeight: number; x: number; barWidth: number; alpha: number } {
    const style = this.options.entryAnimation ?? 'fade-grow';
    if (progress >= 1 || style === 'none') {
      return { topY, barHeight, x, barWidth, alpha: 1 };
    }

    let tY = topY;
    let h = barHeight;
    let xx = x;
    let alpha = 1;

    if (style === 'fade' || style === 'fade-grow') alpha = progress;
    if (style === 'grow' || style === 'fade-grow') {
      // Anchor at baseline: bar grows from zeroY upward/downward.
      const scaled = barHeight * progress;
      if (topY < baselineY) {
        // positive bar — top is above baseline; grow downward from baseline.
        tY = baselineY - scaled;
      } else {
        // negative bar — topY is at baseline; grow downward from baseline.
        tY = baselineY;
      }
      h = Math.max(1, scaled);
    }
    if (style === 'slide') {
      // Translate in from the right edge of the bar slot.
      xx = x + (1 - progress) * barWidth;
      alpha = progress;
    }

    return { topY: tY, barHeight: h, x: xx, barWidth, alpha };
  }

  render(ctx: SeriesRenderContext): void {
    this.tickAnimations(performance.now());

    switch (this.options.stacking) {
      case 'normal':
        this.renderStacked(ctx, false);
        break;
      case 'percent':
        this.renderStacked(ctx, true);
        break;
      default:
        this.renderOff(ctx);
        break;
    }
  }

  /** Stacking off — each layer drawn independently from zero, overlapping */
  private renderOff(ctx: SeriesRenderContext): void {
    const { scope, timeScale, yScale, dataInterval } = ctx;
    const { context, horizontalPixelRatio } = scope;
    const range = timeScale.getRange();

    // Bar slot width — only cap when the visible range is sparse (≤ 2
    // points on the most-populated layer). Dense zooms must keep wide bars.
    // See the matching comment in candlestick.ts.
    let maxVisibleCount = 0;
    for (const store of this.stores) {
      if (!store.isVisible()) continue;
      const count = store.getVisibleData(range.from, range.to).length;
      if (count > maxVisibleCount) maxVisibleCount = count;
      if (maxVisibleCount > 2) break;
    }
    const naturalBarWidth = timeScale.barWidthBitmap(dataInterval);
    const sparseCap = Math.round(30 * horizontalPixelRatio);
    const barWidth = maxVisibleCount <= 2 ? Math.min(sparseCap, naturalBarWidth) : naturalBarWidth;
    const bodyWidth = Math.max(1, Math.round(barWidth * this.options.barWidthRatio) - 2);
    const halfBody = Math.floor(bodyWidth / 2);

    const yRange = yScale.getRange();
    const hasNegative = yRange.min < 0;
    const zeroY = hasNegative ? yScale.valueToBitmapY(0) : scope.bitmapSize.height;

    const isSingleLayer = this.stores.length === 1;

    if (isSingleLayer) {
      if (!this.stores[0].isVisible()) return;

      // Single-layer: colors[0] = positive, colors[1] = negative
      const posColor = this.options.colors[0];
      const negColor = this.options.colors.length > 1 ? this.options.colors[1] : posColor;
      const visibleData = this.stores[0].getVisibleData(range.from, range.to);

      for (const d of visibleData) {
        // Skip poisoned values (null / NaN / ±Infinity / undefined) — the
        // renderer must not draw a NaN-height bar.
        if (!Number.isFinite(d.value)) continue;
        const value = this.effectiveValue(ctx, 0, d.time, d.value);
        const progress = this.entranceProgress(ctx, 0, d.time);
        const cx = timeScale.timeToBitmapX(d.time);
        if (value >= 0) {
          const topY = yScale.valueToBitmapY(value);
          const barHeight = Math.max(1, zeroY - topY);
          this.drawAnimatedBar(
            context,
            progress,
            zeroY,
            topY,
            barHeight,
            cx - halfBody,
            bodyWidth,
            value >= 0 ? posColor : negColor,
          );
        } else {
          const bottomY = yScale.valueToBitmapY(value);
          const barHeight = Math.max(1, bottomY - zeroY);
          this.drawAnimatedBar(context, progress, zeroY, zeroY, barHeight, cx - halfBody, bodyWidth, negColor);
        }
      }
    } else {
      // Multi-layer: collect per-time, draw tallest first so shorter bars appear in front
      const layers = this.stores.map((store) => (store.isVisible() ? store.getVisibleData(range.from, range.to) : []));
      const timeMap = new Map<number, { layer: number; value: number }[]>();
      for (let li = 0; li < layers.length; li++) {
        for (const d of layers[li]) {
          // Skip poisoned values — same reason as the single-layer path.
          if (!Number.isFinite(d.value)) continue;
          let arr = timeMap.get(d.time);
          if (!arr) {
            arr = [];
            timeMap.set(d.time, arr);
          }
          // Substitute smoothed value for the live last bar of this layer.
          arr.push({ layer: li, value: this.effectiveValue(ctx, li, d.time, d.value) });
        }
      }

      for (const [time, entries] of timeMap) {
        // Sort by |value| descending — tallest drawn first (behind)
        entries.sort(
          (a: { layer: number; value: number }, b: { layer: number; value: number }) =>
            Math.abs(b.value) - Math.abs(a.value),
        );
        const cx = timeScale.timeToBitmapX(time);

        for (const { layer, value } of entries) {
          const color = this.options.colors[layer % this.options.colors.length];
          const progress = this.entranceProgress(ctx, layer, time);
          if (value >= 0) {
            const topY = yScale.valueToBitmapY(value);
            const barHeight = Math.max(1, zeroY - topY);
            this.drawAnimatedBar(context, progress, zeroY, topY, barHeight, cx - halfBody, bodyWidth, color);
          } else {
            const bottomY = yScale.valueToBitmapY(value);
            const barHeight = Math.max(1, bottomY - zeroY);
            this.drawAnimatedBar(context, progress, zeroY, zeroY, barHeight, cx - halfBody, bodyWidth, color);
          }
        }
      }
    }

    if (hasNegative) {
      context.strokeStyle = ctx.theme.grid.color;
      context.lineWidth = 1;
      const y = Math.round(zeroY) + 0.5;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(scope.bitmapSize.width, y);
      context.stroke();
    }
  }

  /** Stacked (normal or percent) rendering */
  private renderStacked(ctx: SeriesRenderContext, percent: boolean): void {
    const { scope, timeScale, yScale, dataInterval } = ctx;
    const { context, horizontalPixelRatio } = scope;
    const range = timeScale.getRange();

    // Bar slot width — sparse-only cap, see renderOff above.
    let maxVisibleCount = 0;
    for (const store of this.stores) {
      if (!store.isVisible()) continue;
      const count = store.getVisibleData(range.from, range.to).length;
      if (count > maxVisibleCount) maxVisibleCount = count;
      if (maxVisibleCount > 2) break;
    }
    const naturalBarWidth = timeScale.barWidthBitmap(dataInterval);
    const sparseCap = Math.round(30 * horizontalPixelRatio);
    const barWidth = maxVisibleCount <= 2 ? Math.min(sparseCap, naturalBarWidth) : naturalBarWidth;
    const bodyWidth = Math.max(1, Math.round(barWidth * this.options.barWidthRatio) - 2);
    const halfBody = Math.floor(bodyWidth / 2);

    // Collect all visible data per layer (hidden layers contribute empty data)
    const layers = this.stores.map((store) => (store.isVisible() ? store.getVisibleData(range.from, range.to) : []));
    if (layers.every((l) => l.length === 0)) return;

    // Build values per time — hidden layers contribute 0. Use effectiveValue so
    // the last bar of each layer smoothly chases updateLastPoint even when
    // rendered as a stacked slice (where the stacked math depends on the
    // per-layer value, not just the geometry of one isolated bar).
    const timeMap = new Map<number, number[]>();
    for (let li = 0; li < layers.length; li++) {
      for (const d of layers[li]) {
        let arr = timeMap.get(d.time);
        if (!arr) {
          arr = new Array(layers.length).fill(0);
          timeMap.set(d.time, arr);
        }
        // Treat non-finite values as 0 in the stack — one layer's gap must
        // not NaN-out the whole stacked bar at that time slot.
        const raw = Number.isFinite(d.value) ? d.value : 0;
        arr[li] = this.stores[li].isVisible() ? this.effectiveValue(ctx, li, d.time, raw) : 0;
      }
    }

    // Draw layer by layer, bottom to top
    for (let li = 0; li < layers.length; li++) {
      const color = this.options.colors[li % this.options.colors.length];

      for (const [time, values] of timeMap) {
        const raw = values[li];
        if (raw === 0) continue;

        const cx = timeScale.timeToBitmapX(time);

        // Sum of previous layers for stacking offset
        let basePositive = 0;
        let baseNegative = 0;
        for (let prev = 0; prev < li; prev++) {
          const v = values[prev];
          if (v > 0) basePositive += v;
          else baseNegative += v;
        }

        const progress = this.entranceProgress(ctx, li, time);

        if (percent) {
          // Normalize to 0–100%
          let totalPositive = 0;
          let totalNegative = 0;
          for (const v of values) {
            if (v > 0) totalPositive += v;
            else totalNegative += v;
          }

          if (raw > 0 && totalPositive > 0) {
            const pctBase = (basePositive / totalPositive) * 100;
            const pctTop = ((basePositive + raw) / totalPositive) * 100;
            const topY = yScale.valueToBitmapY(pctTop);
            const bottomY = yScale.valueToBitmapY(pctBase);
            const h = Math.max(1, bottomY - topY);
            this.drawAnimatedBar(context, progress, bottomY, topY, h, cx - halfBody, bodyWidth, color);
          } else if (raw < 0 && totalNegative < 0) {
            const pctBase = (baseNegative / totalNegative) * -100;
            const pctTop = ((baseNegative + raw) / totalNegative) * -100;
            const topY = yScale.valueToBitmapY(pctBase);
            const bottomY = yScale.valueToBitmapY(pctTop);
            const h = Math.max(1, bottomY - topY);
            this.drawAnimatedBar(context, progress, topY, topY, h, cx - halfBody, bodyWidth, color);
          }
        } else {
          if (raw > 0) {
            const topY = yScale.valueToBitmapY(basePositive + raw);
            const bottomY = yScale.valueToBitmapY(basePositive);
            const h = Math.max(1, bottomY - topY);
            this.drawAnimatedBar(context, progress, bottomY, topY, h, cx - halfBody, bodyWidth, color);
          } else {
            const topY = yScale.valueToBitmapY(baseNegative);
            const bottomY = yScale.valueToBitmapY(baseNegative + raw);
            const h = Math.max(1, bottomY - topY);
            this.drawAnimatedBar(context, progress, topY, topY, h, cx - halfBody, bodyWidth, color);
          }
        }
      }
    }
  }

  private fillBar(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  }

  /**
   * Fill a bar with an optional entrance transform applied. When `progress >= 1`
   * this is equivalent to {@link fillBar}. During entrance the transform shapes
   * geometry (grow from baseline, slide in from the right) and/or alpha.
   */
  private drawAnimatedBar(
    context: CanvasRenderingContext2D,
    progress: number,
    baselineY: number,
    topY: number,
    barHeight: number,
    x: number,
    barWidth: number,
    color: string,
  ): void {
    const style = this.options.entryAnimation ?? 'fade-grow';
    if (progress >= 1 || style === 'none') {
      this.fillBar(context, x, topY, barWidth, barHeight, color);
      return;
    }

    const t = this.applyBarTransform(progress, baselineY, topY, barHeight, x, barWidth);
    context.save();
    context.globalAlpha = t.alpha;
    context.fillStyle = color;
    context.fillRect(t.x, t.topY, t.barWidth, t.barHeight);
    context.restore();
  }
}
