import { EventEmitter } from '../events';
import { binarySearch } from '../utils/math';

interface StoreEvents {
  update: () => void;
}

export class TimeSeriesStore<T extends { time: number }> extends EventEmitter<StoreEvents> {
  private data: T[] = [];
  private _visible = true;
  private cachedRange: { from: number; to: number } | null = null;
  private cachedResult: T[] = [];

  setVisible(visible: boolean): void {
    this._visible = visible;
  }

  isVisible(): boolean {
    return this._visible;
  }

  setData(data: T[]): void {
    let sorted = true;
    for (let i = 1; i < data.length; i++) {
      if (data[i].time < data[i - 1].time) { sorted = false; break; }
    }
    this.data = sorted ? data.slice() : [...data].sort((a, b) => a.time - b.time);
    this.cachedRange = null;
    this.emit('update');
  }

  append(point: T): void {
    if (this.data.length > 0 && point.time <= this.data[this.data.length - 1].time) {
      this.updateLast(point);
      return;
    }
    this.data.push(point);
    this.cachedRange = null;
    this.emit('update');
  }

  updateLast(point: T): void {
    if (this.data.length === 0) return;
    this.data[this.data.length - 1] = point;
    this.cachedRange = null;
    this.emit('update');
  }

  trimStart(count: number): void {
    if (count <= 0 || this.data.length === 0) return;
    if (count >= this.data.length) {
      this.data = [];
      this.cachedRange = null;
      this.emit('update');
      return;
    }
    this.data = this.data.slice(count);
    this.cachedRange = null;
    this.emit('update');
  }

  getAll(): T[] {
    return this.data;
  }

  getVisibleData(from: number, to: number): T[] {
    if (this.data.length === 0) return [];
    if (this.cachedRange && this.cachedRange.from === from && this.cachedRange.to === to) return this.cachedResult;

    const startIdx = Math.max(0, binarySearch(this.data, from, (d) => d.time) - 1);
    const endIdx = Math.min(this.data.length, binarySearch(this.data, to, (d) => d.time) + 1);
    this.cachedResult = this.data.slice(startIdx, endIdx);
    this.cachedRange = { from, to };
    return this.cachedResult;
  }

  first(): T | undefined {
    return this.data[0];
  }

  last(): T | undefined {
    return this.data[this.data.length - 1];
  }

  get length(): number {
    return this.data.length;
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  findNearest(time: number, maxDist: number): T | null {
    if (this.data.length === 0) return null;
    const idx = binarySearch(this.data, time, (d) => d.time);
    let best: T | null = null;
    let bestDist = maxDist;
    for (let i = Math.max(0, idx - 1); i <= Math.min(this.data.length - 1, idx + 1); i++) {
      const dist = Math.abs(this.data[i].time - time);
      if (dist <= bestDist) {
        bestDist = dist;
        best = this.data[i];
      }
    }
    return best;
  }
}
