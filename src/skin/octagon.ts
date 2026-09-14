import type { Point } from '../floor/bezier';

/**
 * Octagon geometry (design doc §4.1). Every node type shares this one
 * silhouette — 8 edges at exact 45° increments, so it supports
 * horizontal/vertical/diagonal flow with ports on edges only, never
 * corners. Free canvas means the octagon's classic tiling gap is
 * irrelevant here (nothing needs to tile).
 *
 * Pure geometry, no drawing side effects of its own beyond the path
 * tracing helper — kept separate from color/icon choices (nodeSkin.ts)
 * so the shape can be reused for hit-testing later (Milestone 5) too.
 */

const VERTEX_COUNT = 8;

/** Vertices are offset by 22.5° so the octagon's EDGES — not its
 * corners — land exactly on the 8 compass directions (0°, 45°, 90°,
 * ...). That's what makes "ports on edges only" geometrically exact
 * rather than approximate. */
const VERTEX_ANGLE_OFFSET = Math.PI / 8;

export function octagonVertices(center: Point, radius: number): Point[] {
  const verts: Point[] = [];
  for (let k = 0; k < VERTEX_COUNT; k++) {
    const angle = VERTEX_ANGLE_OFFSET + (k * Math.PI) / 4;
    verts.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return verts;
}

/** Traces (but does not fill/stroke) a closed path through the given
 * vertices — caller decides fill/stroke so this stays reusable for
 * both the node body and any future hit-test region. */
export function traceClosedPath(ctx: CanvasRenderingContext2D, verts: Point[]): void {
  ctx.beginPath();
  const first = verts[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < verts.length; i++) {
    const v = verts[i]!;
    ctx.lineTo(v.x, v.y);
  }
  ctx.closePath();
}

/**
 * One anchor per compass-aligned edge midpoint — up to 8 possible port
 * sockets per node (design doc §4.1). portIndex 0 = east (+x), going
 * clockwise in screen space (+y down) at 45° increments: 0=E, 1=SE,
 * 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE.
 *
 * Not interactive yet — drag-to-connect wiring lands in Milestone 5.
 * Drawn here only as a subtle visual hint that the socket exists.
 */
export function octagonPortAnchor(center: Point, radius: number, portIndex: number): Point {
  const angle = (portIndex * Math.PI) / 4;
  const apothem = radius * Math.cos(VERTEX_ANGLE_OFFSET); // edge-midpoint radius
  return {
    x: center.x + apothem * Math.cos(angle),
    y: center.y + apothem * Math.sin(angle),
  };
}

export const OCTAGON_PORT_COUNT = VERTEX_COUNT;

/**
 * Falcon, 2026-09-14 (docking-seam-threshold discussion, then "i want
 * to develop first in the tool tab to measure the distance between
 * node"): the exact distance from a node's own center to its octagon
 * BOUNDARY along an absolute world-space direction `angle` — not just
 * the two special cases already named elsewhere (`apothem` at the 8
 * face-normal/compass directions `octagonPortAnchor` uses, `radius`
 * itself at the 8 vertex directions), but every angle in between,
 * exact rather than approximated.
 *
 * A regular octagon's boundary at an angle `delta` off a face's own
 * normal sits at perpendicular distance `apothem` from center, so the
 * distance straight OUT to that face along the deflected ray is
 * `apothem / cos(delta)` (basic right-triangle projection) — this
 * holds for any `delta` within a face's own ±22.5° span, which is
 * exactly what `Math.round(angle / faceStep) * faceStep` finds:
 * the nearest face-normal direction, and how far `angle` sits from it.
 *
 * This is the real body-edge math the docking-seam-threshold decision
 * was reasoning about by hand (44-unit forced center distance minus
 * two apothems ≈ 3.3, one radius ≈ 22, etc.) — generalized to every
 * angle, not just the compass-aligned case dockedPosition() forces
 * today. floorLayout.ts's `bodyGap` and `getBoundaryPointTowards` are
 * both built on this one function so every "how close are these two
 * node bodies, really" question in the app answers the same way.
 */
export function octagonBoundaryDistance(radius: number, angle: number): number {
  const apothem = radius * Math.cos(VERTEX_ANGLE_OFFSET);
  const faceStep = Math.PI / 4;
  const delta = angle - Math.round(angle / faceStep) * faceStep; // in [-π/8, π/8]
  return apothem / Math.cos(delta);
}

/** The exact point on a node's own octagon boundary in the direction
 * of `towardPoint` — the real body edge, distinct from
 * `octagonPortAnchor`'s 8 fixed face-midpoint dots. Built on
 * `octagonBoundaryDistance` above. Falcon, 2026-09-14 ("a measure or
 * distance tool ... snappable to the nodes ports and even other ways
 * for measuring", confirmed snap targets: ports, centers, "node body
 * edge (octagon boundary)", grid) — this is what the measure tool's
 * body-edge snap target (FluxCanvas.tsx) resolves to. */
export function octagonBoundaryPointTowards(center: Point, radius: number, towardPoint: Point): Point {
  const angle = Math.atan2(towardPoint.y - center.y, towardPoint.x - center.x);
  const dist = octagonBoundaryDistance(radius, angle);
  return { x: center.x + dist * Math.cos(angle), y: center.y + dist * Math.sin(angle) };
}

/** Compass label for each anchor index, same clockwise order as
 * `octagonPortAnchor`'s own doc comment (0=E,1=SE,2=S,3=SW,4=W,5=NW,
 * 6=N,7=NE) — added 2026-09-10 (Falcon: "the ports are named
 * according to compass like the N,NE,SE,S,SW,W,NW") once EdgeDef's
 * sourcePort/targetPort were changed (App.tsx's edge-creation call
 * sites, GraphModel.updateEdgePorts) to just BE this anchor index,
 * ending the deliberate anchor/logical-port split FBP009 started.
 * `PropertiesPanel.SingleOutputSidePicker` had its own local compass
 * array for exactly this same mapping before this existed — kept here
 * instead since the mapping is this module's own convention. */
export const COMPASS_LABELS: readonly string[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export function compassLabel(portIndex: number): string {
  const i = ((portIndex % VERTEX_COUNT) + VERTEX_COUNT) % VERTEX_COUNT;
  return COMPASS_LABELS[i] ?? String(portIndex);
}

/** Point-in-convex-polygon test via the standard "same side of every
 * edge" check — exact for a convex shape like this octagon, and cheap
 * enough to run per click against every node (Milestone 5 selection
 * hit-testing). Vertices must be in consistent winding order, which
 * octagonVertices() already produces. */
export function isPointInOctagon(point: Point, verts: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue; // on the edge — treat as inside
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
