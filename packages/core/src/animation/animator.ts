import { type Easing, easeOutCubic } from './easing';

export interface AnimatorOptions<T> {
  /** Starting value. Becomes both `current` and `target` until the first `setTarget`. */
  initial: T;
  /** Default duration (ms) used when `setTarget` is called without an explicit one. */
  duration: number;
  /** Easing curve. Defaults to {@link easeOutCubic}. */
  easing?: Easing;
  /** Interpolation function. Receives the value at animation start (`from`),
   * the target (`to`), and the eased progress `t` in `[0, 1]`. */
  lerp: (from: T, to: T, t: number) => T;
  /** Equality test used for the no-op short-circuits. Defaults to `Object.is`,
   * which is correct for primitives but not for object/array values — pass a
   * structural comparator when `T` is composite (e.g. `{from, to}` ranges). */
  equals?: (a: T, b: T) => boolean;
}

export interface SetTargetOptions {
  /** Override the animator's default duration for this retarget. `<= 0` snaps. */
  duration?: number;
  /** Explicit start-time (ms). Pass the RAF timestamp from the host's render
   * loop or a synthetic event timestamp so the animation start agrees with the
   * next `tick(now)` call. Defaults to {@link performance.now}. */
  now?: number;
  /** Override the animator's default easing curve for this retarget. Lets a
   * single animator serve both eased programmatic transitions (rebound, fit)
   * and continuous-chase paths (streaming scroll) without needing a separate
   * instance per use site. */
  easing?: Easing;
}

/**
 * Target-state animation primitive.
 *
 * The contract:
 *   - Reading `current` always returns the value at the most recent `tick`.
 *   - `setTarget(value)` retargets the animation. If a tween is in flight, the
 *     animator advances `current` to "now" first, assigns it as the new `from`,
 *     and restarts the easing curve with `value` as the new `to`. There is no
 *     visual jump because `from` is wherever we actually are.
 *   - `snap(value)` (or `setTarget(value, 0)`) lands at `value` immediately
 *     with no animation.
 *   - `setTarget(target)` is a no-op when an animation is already heading to
 *     the same target, or when the animator is settled at that value already.
 *
 * The animator carries no clock of its own — `tick(now)` is called by the
 * host's render loop, and `setTarget` reads `performance.now()` so the start
 * time agrees with what `tick` will see on the next frame.
 */
export class Animator<T> {
  #current: T;
  #from: T;
  #to: T;
  #startTime = 0;
  #activeDuration: number;
  #activeEasing: Easing;
  readonly #defaultDuration: number;
  readonly #easing: Easing;
  readonly #lerp: (from: T, to: T, t: number) => T;
  readonly #equals: (a: T, b: T) => boolean;
  #animating = false;

  constructor(opts: AnimatorOptions<T>) {
    this.#current = opts.initial;
    this.#from = opts.initial;
    this.#to = opts.initial;
    this.#defaultDuration = opts.duration;
    this.#activeDuration = opts.duration;
    this.#easing = opts.easing ?? easeOutCubic;
    this.#activeEasing = this.#easing;
    this.#lerp = opts.lerp;
    this.#equals = opts.equals ?? Object.is;
  }

  get current(): T {
    return this.#current;
  }

  get target(): T {
    return this.#to;
  }

  get animating(): boolean {
    return this.#animating;
  }

  /** Replace the target instantly; cancels any in-flight animation. */
  snap(value: T): void {
    this.#current = value;
    this.#from = value;
    this.#to = value;
    this.#animating = false;
  }

  /**
   * Set a new target. If `opts.duration` is omitted, the animator's default
   * is used. `duration <= 0` is equivalent to {@link snap}.
   *
   * Pass `opts.now` to make the animation's start time agree with the host's
   * render loop or event timestamp; defaults to `performance.now()`. This
   * matters when the caller already has a frame timestamp in hand — without
   * it, `setTarget` and the next `tick(rafNow)` would disagree by however many
   * milliseconds passed between the call and the RAF callback firing.
   *
   * Mid-flight retarget preserves visual continuity: the animator first
   * advances `current` to its position at the supplied `now`, then assigns
   * that as the new `from` and starts a fresh ease toward `value`. Because
   * `from` is the actual current position, the cubic ease resumes seamlessly
   * even though the curve technically restarts.
   */
  setTarget(value: T, opts: SetTargetOptions = {}): void {
    const now = opts.now ?? performance.now();

    if (this.#animating) {
      if (this.#equals(value, this.#to)) return;
      this.tick(now);
    } else if (this.#equals(value, this.#current)) {
      return;
    }

    const dur = opts.duration ?? this.#defaultDuration;
    if (dur <= 0) {
      this.snap(value);
      return;
    }

    this.#from = this.#current;
    this.#to = value;
    this.#activeDuration = dur;
    this.#activeEasing = opts.easing ?? this.#easing;
    this.#startTime = now;
    this.#animating = true;
  }

  /** Advance `current` toward `target`. Returns `true` while still animating. */
  tick(now: number): boolean {
    if (!this.#animating) return false;

    const elapsed = now - this.#startTime;

    if (elapsed >= this.#activeDuration) {
      this.#current = this.#to;
      this.#animating = false;

      return false;
    }

    const t = elapsed <= 0 ? 0 : elapsed / this.#activeDuration;
    this.#current = this.#lerp(this.#from, this.#to, this.#activeEasing(t));

    return true;
  }
}
