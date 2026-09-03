import type { EdgeId, NodeId } from '../core/types';
import { BezierPath, curveBetween, type Point } from './bezier';
import { octagonPortAnchor, OCTAGON_PORT_COUNT } from '../skin/octagon';

/** World-space node radius, shared by every layer that needs to know
 * a node's physical size: FloorLayout uses it to place the 8 octagon
 * port anchors a path can attach to (below), and FluxCanvas uses the
 * exact same value so what's drawn matches what's computed here. Kept
 * here (not in skin/octagon.ts, which is pure parametrized geometry
 * with no opinion on any particular radius) since "how big is a node"
 * is a floor-layer fact, same as position. */
export const NODE_RADIUS = 22;

interface EdgeAnchors {
  sourceNodeId: NodeId;
  sourceAnchor: number;
  targetNodeId: NodeId;
  targetAnchor: number;
}

/**
 * The floor layer's own data: world-space node positions and path curve
 * geometry, keyed by the same ids the logic-layer GraphModel uses
 * (design doc §2 — floor owns positions, logic never touches
 * pixels/coordinates, so these live in a separate structure rather than
 * on NodeDef/EdgeDef).
 *
 * Per-socket wiring (Falcon, 2026-09-03): each node has 8 octagon-edge
 * anchors (skin/octagon.ts's existing octagonPortAnchor, already drawn
 * as the small dots on every node) and a path attaches to ONE specific
 * anchor at each end, max 8 paths per node. This is purely a FLOOR
 * concept — which anchor a path's curve starts/ends at — deliberately
 * kept separate from the LOGIC layer's sourcePort/targetPort integers
 * (GraphModel/EdgeDef), which remain plain routing indices a sorter/
 * distributor/mixer's config refers to and are untouched by this.
 * Conflating the two would tie every node's physical socket count to
 * its routing logic, which is a bigger decision than what was asked
 * for here — flagged to Falcon as a deliberate scoping choice, worth
 * revisiting only if he actually wants routing tied to physical sides.
 */
export class FloorLayout {
  private nodePositions = new Map<NodeId, Point>();
  private edgeCurves = new Map<EdgeId, BezierPath>();
  /** The bow each edge's curve was last built with — kept so a moved
   * node's edges can be rebuilt (Milestone 5 drag-to-move) without
   * losing their original bend. */
  private edgeBow = new Map<EdgeId, number>();
  /** Which of a node's 8 anchor indices (0-7, skin/octagon.ts compass
   * order) are currently occupied by a path. */
  private nodeAnchorUsage = new Map<NodeId, Set<number>>();
  /** Which anchor (and which node) each edge is attached to at each
   * end — this is FloorLayout's own record, independent of GraphModel,
   * so an edge's anchors can be released on deletion even after the
   * edge is already gone from GraphModel (node-deletion cascade). */
  private edgeAnchors = new Map<EdgeId, EdgeAnchors>();

  setNodePosition(nodeId: NodeId, position: Point): void {
    this.nodePositions.set(nodeId, position);
  }

  getNodePosition(nodeId: NodeId): Point | undefined {
    return this.nodePositions.get(nodeId);
  }

  removeNodePosition(nodeId: NodeId): void {
    this.nodePositions.delete(nodeId);
    // Defensive cleanup — a node's edges are normally already removed
    // (and their anchors released) via removeEdgeCurve before this
    // runs, but drop any stray booking rather than leak it.
    this.nodeAnchorUsage.delete(nodeId);
  }

  /** True while `nodeId` has at least one of its 8 anchors still free
   * (Falcon, 2026-09-03: max 8 connections per node, one per side). */
  hasFreeAnchorSlot(nodeId: NodeId): boolean {
    const used = this.nodeAnchorUsage.get(nodeId);
    return !used || used.size < OCTAGON_PORT_COUNT;
  }

  /** The anchor index (0-7) on `nodeId` nearest to `towardPoint`,
   * skipping any already occupied — or undefined if all 8 are taken.
   * "Nearest" is what auto-picks which side a new path attaches to. */
  private nearestFreeAnchor(nodeId: NodeId, towardPoint: Point): number | undefined {
    const center = this.nodePositions.get(nodeId);
    if (!center) return undefined;
    const used = this.nodeAnchorUsage.get(nodeId);
    let best: number | undefined;
    let bestDist = Infinity;
    for (let i = 0; i < OCTAGON_PORT_COUNT; i++) {
      if (used?.has(i)) continue;
      const anchor = octagonPortAnchor(center, NODE_RADIUS, i);
      const dist = Math.hypot(anchor.x - towardPoint.x, anchor.y - towardPoint.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  private occupyAnchor(nodeId: NodeId, anchorIndex: number): void {
    let set = this.nodeAnchorUsage.get(nodeId);
    if (!set) {
      set = new Set();
      this.nodeAnchorUsage.set(nodeId, set);
    }
    set.add(anchorIndex);
  }

  private releaseEdgeAnchors(edgeId: EdgeId): void {
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return;
    this.nodeAnchorUsage.get(anchors.sourceNodeId)?.delete(anchors.sourceAnchor);
    this.nodeAnchorUsage.get(anchors.targetNodeId)?.delete(anchors.targetAnchor);
    this.edgeAnchors.delete(edgeId);
  }

  /** Builds (and caches) an edge's curve from its endpoints' current node
   * positions, auto-picking (and booking) the nearest free anchor at
   * each end — the source's anchor faces the target and vice versa,
   * the natural convention for a node-link diagram. Returns false
   * without changing anything if either endpoint has no free anchor
   * (already at its 8-connection limit) — callers should check
   * `hasFreeAnchorSlot` on both nodes BEFORE creating the logic-layer
   * edge at all, so a rejected wire never leaves a GraphModel edge
   * with no curve to render. Call again if either endpoint moves. */
  setEdgeCurve(edgeId: EdgeId, fromNodeId: NodeId, toNodeId: NodeId, bow = 0.15): boolean {
    const from = this.nodePositions.get(fromNodeId);
    const to = this.nodePositions.get(toNodeId);
    if (!from || !to) {
      throw new Error(`FloorLayout.setEdgeCurve: missing node position for edge "${edgeId}"`);
    }

    // Safe to call twice for the same id (re-picks fresh anchors)
    // rather than leaking the old booking.
    this.releaseEdgeAnchors(edgeId);

    const sourceAnchor = this.nearestFreeAnchor(fromNodeId, to);
    const targetAnchor = this.nearestFreeAnchor(toNodeId, from);
    if (sourceAnchor === undefined || targetAnchor === undefined) return false;

    this.occupyAnchor(fromNodeId, sourceAnchor);
    this.occupyAnchor(toNodeId, targetAnchor);
    this.edgeAnchors.set(edgeId, { sourceNodeId: fromNodeId, sourceAnchor, targetNodeId: toNodeId, targetAnchor });

    const fromAnchorPoint = octagonPortAnchor(from, NODE_RADIUS, sourceAnchor);
    const toAnchorPoint = octagonPortAnchor(to, NODE_RADIUS, targetAnchor);
    this.edgeCurves.set(edgeId, new BezierPath(curveBetween(fromAnchorPoint, toAnchorPoint, bow)));
    this.edgeBow.set(edgeId, bow);
    return true;
  }

  /** Rebuilds an edge's curve from its endpoints' CURRENT positions,
   * reusing whatever bow AND whatever anchors it was originally
   * created with (falls back to node centers if this edge somehow has
   * no recorded anchors) — this is what keeps an edge's curve correct,
   * still attached to the same side of each node, after Milestone 5
   * drag-to-move repositions one of its endpoints. Does NOT re-pick
   * anchors — a path stays on whichever side it was wired to even as
   * the node moves around it. */
  recomputeEdgeCurve(edgeId: EdgeId, fromNodeId: NodeId, toNodeId: NodeId): void {
    const bow = this.edgeBow.get(edgeId) ?? 0.15;
    const from = this.nodePositions.get(fromNodeId);
    const to = this.nodePositions.get(toNodeId);
    if (!from || !to) {
      throw new Error(`FloorLayout.recomputeEdgeCurve: missing node position for edge "${edgeId}"`);
    }
    const anchors = this.edgeAnchors.get(edgeId);
    const fromPoint = anchors ? octagonPortAnchor(from, NODE_RADIUS, anchors.sourceAnchor) : from;
    const toPoint = anchors ? octagonPortAnchor(to, NODE_RADIUS, anchors.targetAnchor) : to;
    this.edgeCurves.set(edgeId, new BezierPath(curveBetween(fromPoint, toPoint, bow)));
  }

  getEdgeCurve(edgeId: EdgeId): BezierPath | undefined {
    return this.edgeCurves.get(edgeId);
  }

  /** Which anchor (0-7) an edge is attached to at each end — read-only
   * view for UI that wants to show/change it (properties panel's
   * side-picker for a single-socket kind, Falcon 2026-09-03). */
  getEdgeAnchors(edgeId: EdgeId): { sourceAnchor: number; targetAnchor: number } | undefined {
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return undefined;
    return { sourceAnchor: anchors.sourceAnchor, targetAnchor: anchors.targetAnchor };
  }

  /** Moves one end of an already-wired edge to a specific anchor
   * (0-7) on its own node — the "toggle which side to output" control
   * for a node whose kind only ever has one socket of a given role
   * (e.g. source's single output), so the user doesn't need to redo
   * the drag gesture just to change sides. Returns false (no change)
   * if the edge has no recorded anchors, or if the requested side is
   * already occupied by a DIFFERENT edge on that node. */
  reassignAnchor(edgeId: EdgeId, end: 'source' | 'target', newAnchorIndex: number): boolean {
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return false;

    const nodeId = end === 'source' ? anchors.sourceNodeId : anchors.targetNodeId;
    const oldAnchorIndex = end === 'source' ? anchors.sourceAnchor : anchors.targetAnchor;
    if (oldAnchorIndex === newAnchorIndex) return true;

    const used = this.nodeAnchorUsage.get(nodeId);
    if (used?.has(newAnchorIndex)) return false;

    used?.delete(oldAnchorIndex);
    this.occupyAnchor(nodeId, newAnchorIndex);
    if (end === 'source') anchors.sourceAnchor = newAnchorIndex;
    else anchors.targetAnchor = newAnchorIndex;

    const bow = this.edgeBow.get(edgeId) ?? 0.15;
    const fromPos = this.nodePositions.get(anchors.sourceNodeId);
    const toPos = this.nodePositions.get(anchors.targetNodeId);
    if (fromPos && toPos) {
      const fromPoint = octagonPortAnchor(fromPos, NODE_RADIUS, anchors.sourceAnchor);
      const toPoint = octagonPortAnchor(toPos, NODE_RADIUS, anchors.targetAnchor);
      this.edgeCurves.set(edgeId, new BezierPath(curveBetween(fromPoint, toPoint, bow)));
    }
    return true;
  }

  /** The bow an edge's curve was last built with — 0 means a
   * straight line (Falcon, 2026-09-03: "linear" path type), any
   * other value a gentle curve ("curve" path type, `curveBetween`'s
   * own 0.15 cosmetic default when one hasn't been set explicitly). */
  getEdgeBow(edgeId: EdgeId): number {
    return this.edgeBow.get(edgeId) ?? 0.15;
  }

  /** Sets an edge's path SHAPE — 0 for a dead-straight "linear" path,
   * any other value for a "curve" path (Falcon, 2026-09-03: "we
   * should have a path type, the basic one is the linear type
   * (straight line) and curve type"). Rebuilds the curve immediately
   * from the edge's current anchors/node positions, same as
   * `reassignAnchor` — a no-op on the curve itself if the edge has no
   * recorded anchors yet (bow is still remembered for when it does). */
  setEdgeBow(edgeId: EdgeId, bow: number): void {
    this.edgeBow.set(edgeId, bow);
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return;
    const fromPos = this.nodePositions.get(anchors.sourceNodeId);
    const toPos = this.nodePositions.get(anchors.targetNodeId);
    if (!fromPos || !toPos) return;
    const fromPoint = octagonPortAnchor(fromPos, NODE_RADIUS, anchors.sourceAnchor);
    const toPoint = octagonPortAnchor(toPos, NODE_RADIUS, anchors.targetAnchor);
    this.edgeCurves.set(edgeId, new BezierPath(curveBetween(fromPoint, toPoint, bow)));
  }

  removeEdgeCurve(edgeId: EdgeId): void {
    this.releaseEdgeAnchors(edgeId);
    this.edgeCurves.delete(edgeId);
    this.edgeBow.delete(edgeId);
  }
}
