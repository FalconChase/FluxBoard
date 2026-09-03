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
