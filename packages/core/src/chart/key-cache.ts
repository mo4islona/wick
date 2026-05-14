/**
 * Stable string cache for the `seriesId:layerIdx` composite keys that the
 * {@link AnimationEngine}'s `liveValues` / `entryProgress` maps use. The
 * renderers read these maps every frame; building a fresh template literal
 * per lookup adds ~18K string allocations per second per active series at
 * 60 fps — generation-0 GC pressure visible in long-running streams.
 *
 * The cache returns the same string instance across calls so the consumer
 * can pass it straight to `Map.get` without re-allocating.
 */
export class KeyCache {
  readonly #cache = new Map<string, string[]>();

  /**
   * Composite key for live-value / entry-progress map lookups. The same
   * `(seriesId, layerIdx)` pair returns referentially-equal strings on
   * every call, so consumers can keep a hot-path reference if they want.
   */
  liveKey(seriesId: string, layerIdx: number): string {
    let arr = this.#cache.get(seriesId);
    if (arr === undefined) {
      arr = [];
      this.#cache.set(seriesId, arr);
    }

    let key = arr[layerIdx];
    if (key === undefined) {
      key = `${seriesId}:${layerIdx}`;
      arr[layerIdx] = key;
    }

    return key;
  }

  /** Drop the entire series — used when a series is removed from the chart. */
  dropSeries(seriesId: string): void {
    this.#cache.delete(seriesId);
  }

  /** Test-only: number of cached series. Not part of the production API. */
  get size(): number {
    return this.#cache.size;
  }
}
