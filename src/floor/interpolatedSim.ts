import type { SimEngine } from '../core/SimEngine';
import type { EdgeId, ItemType } from '../core/types';

export interface RenderItem {
  id: string;
  type: ItemType;
  edgeId: EdgeId;
  /** Interpolated for smooth rendering — not a logic-layer value. */
  progress: number;
}

interface ItemSnapshot {
  edgeId: EdgeId;
  type: ItemType;
  progress: number;
}

/**
 * Drives a SimEngine at a fixed logic tick rate, independent of the
 * render frame rate, and interpolates item progress between ticks so
 * motion reads as smooth even though the sim itself only updates a few
 * times a second — the same technique Factorio/Satisfactory use to
 * decouple sim tick rate from 60fps rendering (design doc §5.1).
 *
 * Classic fixed-timestep interpolation: blends between the last two
 * already-simulated states, so render trails real time by up to one
 * tick interval. A freshly-spawned item therefore holds at its spawn
 * position for the rest of the tick it was born in, and interpolates
 * smoothly starting the tick after that.
 */
export class InterpolatedSimDriver {
  private engine: SimEngine;
  private tickIntervalMs: number;
  private accumulatorMs = 0;
  private lastNow: number | null = null;
  private running = true;

  private prevSnapshot = new Map<string, ItemSnapshot>();
  private currSnapshot = new Map<string, ItemSnapshot>();

  constructor(engine: SimEngine, tickIntervalMs: number) {
    this.engine = engine;
    this.tickIntervalMs = tickIntervalMs;
    this.captureInto(this.currSnapshot);
    this.captureInto(this.prevSnapshot);
  }

  private captureInto(target: Map<string, ItemSnapshot>): void {
    target.clear();
    for (const inFlight of this.engine.getItemsInFlight()) {
      target.set(inFlight.item.id, {
        edgeId: inFlight.edgeId,
        type: inFlight.item.type,
        progress: inFlight.progress,
      });
    }
  }

  /** Call once per render frame with a monotonically increasing
   * timestamp (e.g. from requestAnimationFrame). Advances the sim by
   * zero or more fixed ticks (dt = 1 "logic second" per tick), each
   * tick's dt scaled so `flowRate` reads as "progress per logic
   * second" regardless of tickIntervalMs. */
  update(nowMs: number): void {
    if (this.lastNow === null) {
      this.lastNow = nowMs;
      return;
    }
    const deltaMs = Math.max(0, nowMs - this.lastNow);
    this.lastNow = nowMs;

    // Held (paused): keep the clock moving so a later resume doesn't see
    // one giant deltaMs and burn through a pile of ticks at once, but
    // don't accumulate time or advance the sim — items stay exactly
    // where they are.
    if (!this.running) return;

    this.accumulatorMs += deltaMs;

    while (this.accumulatorMs >= this.tickIntervalMs) {
      this.captureInto(this.prevSnapshot);
      this.engine.tick(1);
      this.captureInto(this.currSnapshot);
      this.accumulatorMs -= this.tickIntervalMs;
    }
  }

  /** RUN/HOLD control. Held items stay frozen in place — no lost
   * progress, no jump on resume. */
  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Items with progress blended between the last two ticks, ready for
   * the floor layer to map onto curve geometry. */
  getRenderItems(): RenderItem[] {
    const alpha = Math.max(0, Math.min(1, this.accumulatorMs / this.tickIntervalMs));
    const result: RenderItem[] = [];

    for (const [id, curr] of this.currSnapshot) {
      const prev = this.prevSnapshot.get(id);
      const progress = prev ? prev.progress + (curr.progress - prev.progress) * alpha : curr.progress;
      result.push({ id, type: curr.type, edgeId: curr.edgeId, progress });
    }

    return result;
  }

  getEngine(): SimEngine {
    return this.engine;
  }
}
