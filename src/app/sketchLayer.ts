import type { NodeId } from '../core/types';
import type { Point } from '../floor/bezier';

/** One end of a sketch pinned to a real node's port (Falcon,
 * 2026-09-05: "I want it to snap on those dots ... althought I draw a
 * path it should either snap to a path or port to connect"). The
 * anchor is booked in FloorLayout's shared reservation pool
 * (`${sketchId}:from` / `:to`) so the sketch genuinely holds that
 * port — nothing else can grab the same dot while it's attached. */
export interface SketchAttachment {
  nodeId: NodeId;
  anchorIndex: number;
}

export interface Sketch {
  id: string;
  from: Point;
  to: Point;
  /** Which real node/port this end is pinned to, or null/undefined
   * for a plain floating point (Falcon, 2026-09-05: a sketch can be
   * "half-connected" — one end on a real port, the other still a
   * placeholder for a node that doesn't exist yet). Absent on a
   * pre-SES029 save, which is exactly equivalent to null. */
  fromAttachment?: SketchAttachment | null;
  toAttachment?: SketchAttachment | null;
}

/**
 * Pure UI/planning scratch data — deliberately NOT part of the
 * Logic/Floor/Skin architecture (design doc §2): a sketch carries no
 * simulation meaning, isn't tied to any GraphModel node/edge id, and
 * nothing ever flows along one UNLESS/UNTIL it's converted into a
 * real path (App.tsx's handleConvertSketchToPath). Falcon,
 * 2026-09-03: "maybe we can draw paths without really needing
 * node... give freedom to users to plan the paths" — resolved as a
 * pure visual planning sketch, not a real (possibly dangling)
 * GraphModel edge. Falcon, 2026-09-05: extended so a sketch can pin
 * either end to a real port and, once both ends are pinned, become a
 * real path outright.
 *
 * Mutated directly and read by FluxCanvas's render loop every frame —
 * same pattern as GraphModel/FloorLayout/SkinConfig — so adding,
 * removing, or updating a sketch doesn't need to re-run FluxCanvas's
 * setup effect.
 */
export class SketchLayer {
  private sketches = new Map<string, Sketch>();

  add(sketch: Sketch): void {
    this.sketches.set(sketch.id, sketch);
  }

  remove(id: string): void {
    this.sketches.delete(id);
  }

  get(id: string): Sketch | undefined {
    return this.sketches.get(id);
  }

  getAll(): Sketch[] {
    return [...this.sketches.values()];
  }

  /** Merges `patch` into an existing sketch — a no-op if `id` isn't
   * present. Used to keep an attached endpoint's position in sync as
   * its node moves, and to clear an attachment when its node is
   * deleted (App.tsx), without needing to reconstruct the whole
   * Sketch object at every call site. */
  update(id: string, patch: Partial<Sketch>): void {
    const existing = this.sketches.get(id);
    if (!existing) return;
    this.sketches.set(id, { ...existing, ...patch });
  }
}
