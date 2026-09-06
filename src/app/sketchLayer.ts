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

/** One straight-or-curved leg between two consecutive waypoints of a
 * (possibly multi-segment) sketch (Falcon, 2026-09-05: "l3 connected
 * non linear paths (sketched) ... then the middle path was converted
 * to arc/curve path"). `bow` is the exact same fraction-of-distance
 * perpendicular offset FloorLayout's real edges use (bezier.ts's
 * curveBetween) — 0 is straight, matching every new segment's
 * default. Purely visual, and deliberately NOT tangent-continuous
 * with its neighbors (Falcon, 2026-09-05: that's explicitly a LATER
 * idea — "select tangent-to-adjacent-paths kind of freedom" — this
 * pass is just the curve on its own). */
export interface SketchSegment {
  bow: number;
}

export interface Sketch {
  id: string;
  /** Ordered waypoints — always at least 2. A plain single-segment
   * sketch (the shape every sketch had before multi-segment) is just
   * the 2-point, 1-segment case. Falcon, 2026-09-05: only points[0]
   * and the LAST point can ever be pinned to a real node's port —
   * every interior point is a plain shape waypoint with no attachment
   * concept, mirroring how a real GraphModel edge only ever has two
   * true endpoints. */
  points: Point[];
  /** One entry per segment — always points.length - 1 long. */
  segments: SketchSegment[];
  /** Which real node/port points[0] is pinned to, or null/undefined
   * for a plain floating point (Falcon, 2026-09-05: a sketch can be
   * "half-connected" — one end on a real port, the other still a
   * placeholder for a node that doesn't exist yet). Absent on a
   * pre-SES029 save, which is exactly equivalent to null. */
  fromAttachment?: SketchAttachment | null;
  /** Same as fromAttachment, but for the LAST point. */
  toAttachment?: SketchAttachment | null;
}

/** The pre-multi-segment shape every sketch used to have — a plain
 * straight line between exactly two points. */
interface LegacySketch {
  id: string;
  from: Point;
  to: Point;
  fromAttachment?: SketchAttachment | null;
  toAttachment?: SketchAttachment | null;
}

/** Falcon, 2026-09-05: upgrades a pre-multi-segment save (or any other
 * code still constructing the original {from,to} shape) to the new
 * points/segments shape on the way in, so nothing existing breaks or
 * loses data — a straight 2-point, 1-segment sketch is exactly what
 * the old shape always meant. Same "optional field, no version bump"
 * convention already used for CanvasSettings.canvasBackground and
 * ObjectRegistry's objectTypes. */
function normalize(raw: Sketch | LegacySketch): Sketch {
  if ('points' in raw && Array.isArray((raw as Sketch).points)) return raw as Sketch;
  const legacy = raw as LegacySketch;
  return {
    id: legacy.id,
    points: [legacy.from, legacy.to],
    segments: [{ bow: 0 }],
    fromAttachment: legacy.fromAttachment,
    toAttachment: legacy.toAttachment,
  };
}

/**
 * Pure UI/planning scratch data — deliberately NOT part of the
 * Logic/Floor/Skin architecture (design doc §2): a sketch carries no
 * simulation meaning, isn't tied to any GraphModel node/edge id, and
 * nothing ever flows along one UNLESS/UNTIL it's converted into a
 * real path (App.tsx's handleConvertSketchToPath — single-segment
 * sketches only for now; a multi-segment sketch has no real-edge
 * equivalent since a GraphModel edge only ever connects exactly two
 * nodes). Falcon, 2026-09-03: "maybe we can draw paths without really
 * needing node... give freedom to users to plan the paths" — resolved
 * as a pure visual planning sketch, not a real (possibly dangling)
 * GraphModel edge. Falcon, 2026-09-05: extended so a sketch can pin
 * either end to a real port, become a real path once both ends are
 * pinned, and (this pass) chain multiple waypoints together with a
 * per-segment curve.
 *
 * Mutated directly and read by FluxCanvas's render loop every frame —
 * same pattern as GraphModel/FloorLayout/SkinConfig — so adding,
 * removing, or updating a sketch doesn't need to re-run FluxCanvas's
 * setup effect.
 */
export class SketchLayer {
  private sketches = new Map<string, Sketch>();

  add(sketch: Sketch | LegacySketch): void {
    const normalized = normalize(sketch);
    this.sketches.set(normalized.id, normalized);
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
