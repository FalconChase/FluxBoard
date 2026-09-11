import type { EdgeId, NodeId } from '../core/types';
import { BezierPath, MultiSegmentPath, curveBetween, bendPoint, type EdgePath, type Point } from './bezier';
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

/** One specific anchor dot, found by searching near a world point —
 * returned by nearestAnchorOnNode/findNearestAnchor (Falcon,
 * 2026-09-05: "snap on those dots"). `occupied` lets a caller show a
 * different highlight (and refuse to attach) when the nearest dot is
 * already taken, without a second lookup. */
export interface AnchorHit {
  nodeId: NodeId;
  anchorIndex: number;
  point: Point;
  occupied: boolean;
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
 * concept — which anchor a path's curve starts/ends at.
 *
 * Originally kept deliberately separate from the LOGIC layer's
 * sourcePort/targetPort integers (GraphModel/EdgeDef) — conflating the
 * two would have tied every node's physical socket count to its
 * routing logic, a bigger decision than FBP009 asked for at the time.
 * Falcon revisited that exact tradeoff 2026-09-10 ("the ports are
 * named according to compass like the N,NE,SE,S,SW,W,NW", confirmed
 * via AskUserQuestion: ports auto-derived from the physical anchor,
 * across every port-based kind) — every edge-creation call site in
 * App.tsx now sets sourcePort/targetPort to the SAME anchor index this
 * module assigned it (see GraphModel.updateEdgePorts's own doc
 * comment), and `reassignAnchor` below is kept in sync with it by
 * every caller too (PropertiesPanel's EdgeSidePicker). The two are no
 * longer independent concepts — an edge's logical port IS whichever
 * physical anchor it's plugged into.
 *
 * Precise port snapping + sketch attachments (Falcon, 2026-09-05):
 * the 8 anchor slots per node are now a shared reservation pool — a
 * real edge occupies one via edgeAnchors (below), and a planning
 * sketch's endpoint can ALSO reserve one via the generic
 * reserveAnchor/releaseReservation pair, keyed by an opaque id
 * (`${sketchId}:from` / `:to`) rather than an edge id. Both draw from
 * the same nodeAnchorUsage set, so a sketch genuinely holds a real
 * port the way a wired edge does — nothing else can grab that dot
 * until the sketch releases it (deleted, detached, or converted).
 */
export class FloorLayout {
  private nodePositions = new Map<NodeId, Point>();
  private edgeCurves = new Map<EdgeId, EdgePath>();
  /** The bow each edge's curve was last built with — kept so a moved
   * node's edges can be rebuilt (Milestone 5 drag-to-move) without
   * losing their original bend. */
  private edgeBow = new Map<EdgeId, number>();
  /** Falcon, 2026-09-05 ("one continuous path... treating it as
   * simple paths connected as one"): an edge converted from a
   * MULTI-segment sketch carries interior shape points here, same
   * spirit as Sketch's own points[] but with only the interior ones
   * stored -- the two true ends are always derived live from this
   * edge's own anchors/node positions (edgeAnchors below), exactly
   * like the single-segment case already does, never stored as
   * fixed coordinates. Absent (or empty) for the vast majority of
   * ordinary edges, which keep behaving exactly as before this
   * existed. */
  private edgeInteriorPoints = new Map<EdgeId, Point[]>();
  /** Falcon, 2026-09-05: one bow per segment for a multi-segment edge
   * -- length is always edgeInteriorPoints.get(id)!.length + 1. Only
   * ever set together with edgeInteriorPoints (setEdgeSegments), and
   * cleared together with it. An ordinary single-segment edge keeps
   * using the plain edgeBow map above instead. */
  private edgeSegmentBows = new Map<EdgeId, number[]>();
  /** Which of a node's 8 anchor indices (0-7, skin/octagon.ts compass
   * order) are currently occupied — by an edge OR a sketch
   * reservation, see class doc above. */
  private nodeAnchorUsage = new Map<NodeId, Set<number>>();
  /** Which anchor (and which node) each edge is attached to at each
   * end — this is FloorLayout's own record, independent of GraphModel,
   * so an edge's anchors can be released on deletion even after the
   * edge is already gone from GraphModel (node-deletion cascade). */
  private edgeAnchors = new Map<EdgeId, EdgeAnchors>();
  /** Generic anchor reservations from things that aren't full
   * GraphModel edges — currently just sketch endpoints. Keyed by an
   * opaque reservation id so a sketch's two ends book independently
   * and either can be released without touching the other. */
  private anchorReservations = new Map<string, { nodeId: NodeId; anchorIndex: number }>();

  setNodePosition(nodeId: NodeId, position: Point): void {
    this.nodePositions.set(nodeId, position);
  }

  getNodePosition(nodeId: NodeId): Point | undefined {
    return this.nodePositions.get(nodeId);
  }

  removeNodePosition(nodeId: NodeId): void {
    this.nodePositions.delete(nodeId);
    // Defensive cleanup — a node's edges/sketch attachments are
    // normally already released (via removeEdgeCurve / an explicit
    // releaseReservation call) before this runs, but drop any stray
    // booking rather than leak it.
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
   * "Nearest" is what auto-picks which side a new path attaches to
   * when nothing more specific was targeted. */
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

  /** Whether one specific anchor (0-7) on `nodeId` is currently taken
   * — by an edge or a sketch reservation, doesn't matter which. */
  isAnchorOccupied(nodeId: NodeId, anchorIndex: number): boolean {
    return this.nodeAnchorUsage.get(nodeId)?.has(anchorIndex) ?? false;
  }

  /** The world-space point of one specific anchor on a node, or
   * undefined if the node has no recorded position. */
  getAnchorPoint(nodeId: NodeId, anchorIndex: number): Point | undefined {
    const center = this.nodePositions.get(nodeId);
    if (!center) return undefined;
    return octagonPortAnchor(center, NODE_RADIUS, anchorIndex);
  }

  /** The single nearest anchor dot to `point` ON ONE SPECIFIC node,
   * within `maxDistance` world units — regardless of whether it's
   * already occupied (callers decide what to do with that). Used to
   * find which exact dot a drag started ON, once the node under the
   * cursor is already known. */
  nearestAnchorOnNode(nodeId: NodeId, point: Point, maxDistance: number): Omit<AnchorHit, 'nodeId'> | undefined {
    const center = this.nodePositions.get(nodeId);
    if (!center) return undefined;
    let best: Omit<AnchorHit, 'nodeId'> | undefined;
    let bestDist = maxDistance;
    for (let i = 0; i < OCTAGON_PORT_COUNT; i++) {
      const anchorPoint = octagonPortAnchor(center, NODE_RADIUS, i);
      const dist = Math.hypot(anchorPoint.x - point.x, anchorPoint.y - point.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { anchorIndex: i, point: anchorPoint, occupied: this.isAnchorOccupied(nodeId, i) };
      }
    }
    return best;
  }

  /** The single nearest anchor dot to `point` across EVERY node,
   * within `maxDistance` world units — the general "what's under the
   * cursor right now" lookup used while dragging out a new path or
   * sketch (Falcon, 2026-09-05: "I want it to snap on those dots"). */
  findNearestAnchor(point: Point, maxDistance: number): AnchorHit | undefined {
    let best: AnchorHit | undefined;
    let bestDist = maxDistance;
    for (const nodeId of this.nodePositions.keys()) {
      const hit = this.nearestAnchorOnNode(nodeId, point, bestDist);
      if (hit) {
        bestDist = Math.hypot(hit.point.x - point.x, hit.point.y - point.y);
        best = { nodeId, ...hit };
      }
    }
    return best;
  }

  /** Books one anchor for something that isn't a full GraphModel edge
   * — currently a planning sketch's endpoint (Falcon, 2026-09-05: a
   * sketch snapped onto a port should genuinely hold that port, the
   * same as a real path would). Returns false (books nothing) if the
   * anchor is already taken by anything else. Safe to call again with
   * the same reservationId — re-reserves fresh rather than leaking
   * the old booking. */
  reserveAnchor(reservationId: string, nodeId: NodeId, anchorIndex: number): boolean {
    this.releaseReservation(reservationId);
    if (this.isAnchorOccupied(nodeId, anchorIndex)) return false;
    this.occupyAnchor(nodeId, anchorIndex);
    this.anchorReservations.set(reservationId, { nodeId, anchorIndex });
    return true;
  }

  /** Releases a reservation made via reserveAnchor — a no-op if that
   * id never held one (already released, or never attached). */
  releaseReservation(reservationId: string): void {
    const r = this.anchorReservations.get(reservationId);
    if (!r) return;
    this.nodeAnchorUsage.get(r.nodeId)?.delete(r.anchorIndex);
    this.anchorReservations.delete(reservationId);
  }

  getReservation(reservationId: string): { nodeId: NodeId; anchorIndex: number } | undefined {
    return this.anchorReservations.get(reservationId);
  }

  /** Drops every generic reservation record AND frees the anchor
   * slots they held (without touching edge bookings) — used by
   * persistence.ts's clearAllStores (loading a different project) so
   * an abandoned sketch's reservation id can never confuse a
   * same-named one from the project being loaded, and so the freed
   * dots don't linger as falsely "occupied". */
  clearReservations(): void {
    for (const { nodeId, anchorIndex } of this.anchorReservations.values()) {
      this.nodeAnchorUsage.get(nodeId)?.delete(anchorIndex);
    }
    this.anchorReservations.clear();
  }

  /** Falcon, 2026-09-05 ("one continuous path... treating it as
   * simple paths connected as one"): the ONE place any edge's curve
   * actually gets constructed -- every rebuild site below (initial
   * creation, a moved node, reassigning which port an edge is on,
   * changing its bow, restoring from a save) funnels through here
   * instead of building a BezierPath directly, so "does this edge
   * have a multi-segment shape" only ever needs checking in one spot.
   * An ordinary edge (no entry in edgeInteriorPoints) is completely
   * unaffected -- same single BezierPath as always. */
  private buildEdgeGeometry(edgeId: EdgeId, fromPoint: Point, toPoint: Point, bow: number): EdgePath {
    const interior = this.edgeInteriorPoints.get(edgeId);
    if (interior && interior.length > 0) {
      const bows = this.edgeSegmentBows.get(edgeId) ?? [...interior.map(() => 0), 0];
      return new MultiSegmentPath([fromPoint, ...interior, toPoint], bows);
    }
    return new BezierPath(curveBetween(fromPoint, toPoint, bow));
  }

  /** Builds (and caches) an edge's curve from its endpoints' current node
   * positions. By default auto-picks (and books) the nearest free
   * anchor at each end — the source's anchor faces the target and vice
   * versa, the natural convention for a node-link diagram. Falcon,
   * 2026-09-05 ("snap on those dots"): `explicitAnchors` lets a caller
   * that already knows exactly which dot the user targeted skip the
   * auto-pick for that end — if that specific anchor is already taken,
   * the whole call fails (returns false) rather than silently falling
   * back to a different one, since the user asked for THAT port.
   * Returns false without changing anything if either endpoint ends up
   * with no anchor (auto-pick exhausted, or an explicit one is taken)
   * — callers should check `hasFreeAnchorSlot`/`isAnchorOccupied` on
   * both nodes BEFORE creating the logic-layer edge at all, so a
   * rejected wire never leaves a GraphModel edge with no curve to
   * render. Call again if either endpoint moves. */
  setEdgeCurve(
    edgeId: EdgeId,
    fromNodeId: NodeId,
    toNodeId: NodeId,
    bow = 0,
    explicitAnchors?: { sourceAnchor?: number; targetAnchor?: number },
  ): boolean {
    const from = this.nodePositions.get(fromNodeId);
    const to = this.nodePositions.get(toNodeId);
    if (!from || !to) {
      throw new Error(`FloorLayout.setEdgeCurve: missing node position for edge "${edgeId}"`);
    }

    // Safe to call twice for the same id (re-picks fresh anchors)
    // rather than leaking the old booking.
    this.releaseEdgeAnchors(edgeId);

    let sourceAnchor = explicitAnchors?.sourceAnchor;
    if (sourceAnchor === undefined) {
      sourceAnchor = this.nearestFreeAnchor(fromNodeId, to);
    } else if (this.isAnchorOccupied(fromNodeId, sourceAnchor)) {
      return false;
    }

    let targetAnchor = explicitAnchors?.targetAnchor;
    if (targetAnchor === undefined) {
      targetAnchor = this.nearestFreeAnchor(toNodeId, from);
    } else if (this.isAnchorOccupied(toNodeId, targetAnchor)) {
      return false;
    }

    if (sourceAnchor === undefined || targetAnchor === undefined) return false;

    this.occupyAnchor(fromNodeId, sourceAnchor);
    this.occupyAnchor(toNodeId, targetAnchor);
    this.edgeAnchors.set(edgeId, { sourceNodeId: fromNodeId, sourceAnchor, targetNodeId: toNodeId, targetAnchor });

    const fromAnchorPoint = octagonPortAnchor(from, NODE_RADIUS, sourceAnchor);
    const toAnchorPoint = octagonPortAnchor(to, NODE_RADIUS, targetAnchor);
    this.edgeCurves.set(edgeId, this.buildEdgeGeometry(edgeId, fromAnchorPoint, toAnchorPoint, bow));
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
    const bow = this.edgeBow.get(edgeId) ?? 0;
    const from = this.nodePositions.get(fromNodeId);
    const to = this.nodePositions.get(toNodeId);
    if (!from || !to) {
      throw new Error(`FloorLayout.recomputeEdgeCurve: missing node position for edge "${edgeId}"`);
    }
    const anchors = this.edgeAnchors.get(edgeId);
    const fromPoint = anchors ? octagonPortAnchor(from, NODE_RADIUS, anchors.sourceAnchor) : from;
    const toPoint = anchors ? octagonPortAnchor(to, NODE_RADIUS, anchors.targetAnchor) : to;
    this.edgeCurves.set(edgeId, this.buildEdgeGeometry(edgeId, fromPoint, toPoint, bow));
  }

  getEdgeCurve(edgeId: EdgeId): EdgePath | undefined {
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

    const bow = this.edgeBow.get(edgeId) ?? 0;
    const fromPos = this.nodePositions.get(anchors.sourceNodeId);
    const toPos = this.nodePositions.get(anchors.targetNodeId);
    if (fromPos && toPos) {
      const fromPoint = octagonPortAnchor(fromPos, NODE_RADIUS, anchors.sourceAnchor);
      const toPoint = octagonPortAnchor(toPos, NODE_RADIUS, anchors.targetAnchor);
      this.edgeCurves.set(edgeId, this.buildEdgeGeometry(edgeId, fromPoint, toPoint, bow));
    }
    return true;
  }

  /** The bow an edge's curve was last built with — 0 means a
   * straight line (Falcon, 2026-09-03: "linear" path type), any
   * other value a gentle curve ("curve" path type). Falls back to 0
   * (linear) when one hasn't been set explicitly — every new-path
   * creation path defaults here now (Falcon, 2026-09-05), not
   * `curveBetween`'s old 0.15 cosmetic default. */
  getEdgeBow(edgeId: EdgeId): number {
    return this.edgeBow.get(edgeId) ?? 0;
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
    this.edgeCurves.set(edgeId, this.buildEdgeGeometry(edgeId, fromPoint, toPoint, bow));
  }

  /** Rebuilds an edge's curve at EXACT, caller-specified anchors
   * rather than auto-picking the nearest free one — the save/load
   * feature's hydration path (persistence.ts) needs this so a
   * reloaded graph's paths land on the exact same physical sides they
   * were saved with, not just "close enough." Both anchors must be
   * free (or already booked to THIS edge, for idempotent re-hydration)
   * — returns false and books nothing if either is taken by a
   * different edge. */
  restoreEdgeCurve(
    edgeId: EdgeId,
    fromNodeId: NodeId,
    sourceAnchor: number,
    toNodeId: NodeId,
    targetAnchor: number,
    bow: number,
  ): boolean {
    const from = this.nodePositions.get(fromNodeId);
    const to = this.nodePositions.get(toNodeId);
    if (!from || !to) {
      throw new Error(`FloorLayout.restoreEdgeCurve: missing node position for edge "${edgeId}"`);
    }

    this.releaseEdgeAnchors(edgeId);

    const sourceTaken = this.nodeAnchorUsage.get(fromNodeId)?.has(sourceAnchor);
    const targetTaken = this.nodeAnchorUsage.get(toNodeId)?.has(targetAnchor);
    if (sourceTaken || targetTaken) return false;

    this.occupyAnchor(fromNodeId, sourceAnchor);
    this.occupyAnchor(toNodeId, targetAnchor);
    this.edgeAnchors.set(edgeId, { sourceNodeId: fromNodeId, sourceAnchor, targetNodeId: toNodeId, targetAnchor });

    const fromAnchorPoint = octagonPortAnchor(from, NODE_RADIUS, sourceAnchor);
    const toAnchorPoint = octagonPortAnchor(to, NODE_RADIUS, targetAnchor);
    this.edgeCurves.set(edgeId, this.buildEdgeGeometry(edgeId, fromAnchorPoint, toAnchorPoint, bow));
    this.edgeBow.set(edgeId, bow);
    return true;
  }

  removeEdgeCurve(edgeId: EdgeId): void {
    this.releaseEdgeAnchors(edgeId);
    this.edgeCurves.delete(edgeId);
    this.edgeBow.delete(edgeId);
    this.edgeInteriorPoints.delete(edgeId);
    this.edgeSegmentBows.delete(edgeId);
  }

  /** Falcon, 2026-09-05 ("one continuous path... treating it as
   * simple paths connected as one"): layers a multi-segment shape
   * onto an edge that ALREADY exists (setEdgeCurve/restoreEdgeCurve
   * has already booked its two real anchors) -- called once, right
   * after creating the underlying single edge, when converting a
   * multi-segment sketch to a path. `interiorPoints` holds only the
   * shape points BETWEEN the two node-anchored ends (never the ends
   * themselves, which stay live-derived from this edge's own
   * anchors); `segmentBows` must have exactly interiorPoints.length+1
   * entries. Passing an empty interiorPoints array clears any
   * previously-set multi-segment shape, reverting to the plain
   * single-bow edge every ordinary path already is. */
  setEdgeSegments(edgeId: EdgeId, interiorPoints: Point[], segmentBows: number[]): void {
    if (interiorPoints.length === 0) {
      this.edgeInteriorPoints.delete(edgeId);
      this.edgeSegmentBows.delete(edgeId);
    } else {
      this.edgeInteriorPoints.set(edgeId, interiorPoints);
      this.edgeSegmentBows.set(edgeId, segmentBows);
    }
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return;
    const fromPos = this.nodePositions.get(anchors.sourceNodeId);
    const toPos = this.nodePositions.get(anchors.targetNodeId);
    if (!fromPos || !toPos) return;
    const fromPoint = octagonPortAnchor(fromPos, NODE_RADIUS, anchors.sourceAnchor);
    const toPoint = octagonPortAnchor(toPos, NODE_RADIUS, anchors.targetAnchor);
    const bow = this.edgeBow.get(edgeId) ?? 0;
    this.edgeCurves.set(edgeId, this.buildEdgeGeometry(edgeId, fromPoint, toPoint, bow));
  }

  /** Falcon, 2026-09-05: read-only views of a multi-segment edge's
   * stored shape -- undefined for an ordinary single-segment edge.
   * Used by persistence.ts (saving/restoring the shape alongside the
   * plain bow every edge already saves) and, later, any per-segment
   * editing UI. */
  getEdgeInteriorPoints(edgeId: EdgeId): Point[] | undefined {
    return this.edgeInteriorPoints.get(edgeId);
  }

  getEdgeSegmentBows(edgeId: EdgeId): number[] | undefined {
    return this.edgeSegmentBows.get(edgeId);
  }

  /** Falcon, 2026-09-05: updates ONE segment's bow on an edge that
   * already has a multi-segment shape -- a no-op if this edge has no
   * interior points at all (an ordinary edge uses setEdgeBow
   * instead). Mirrors SketchLayer.update's per-segment bow write. */
  setEdgeSegmentBow(edgeId: EdgeId, segmentIndex: number, bow: number): void {
    const interior = this.edgeInteriorPoints.get(edgeId);
    const bows = this.edgeSegmentBows.get(edgeId);
    if (!interior || interior.length === 0 || !bows) return;
    const nextBows = bows.map((b, i) => (i === segmentIndex ? bow : b));
    this.edgeSegmentBows.set(edgeId, nextBows);
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return;
    const fromPos = this.nodePositions.get(anchors.sourceNodeId);
    const toPos = this.nodePositions.get(anchors.targetNodeId);
    if (!fromPos || !toPos) return;
    const fromPoint = octagonPortAnchor(fromPos, NODE_RADIUS, anchors.sourceAnchor);
    const toPoint = octagonPortAnchor(toPos, NODE_RADIUS, anchors.targetAnchor);
    this.edgeCurves.set(edgeId, new MultiSegmentPath([fromPoint, ...interior, toPoint], nextBows));
  }

  /** The two TRUE (node-anchored) endpoints of an edge's curve, in
   * world space -- undefined if the edge has no recorded anchors or
   * either node has no position yet. Shared by the ribbon's Move/
   * Flip/Rotate MODIFY tools (Falcon, 2026-09-06) so they all reason
   * about the same two fixed points every one of them keeps pinned. */
  getEdgeEndpoints(edgeId: EdgeId): { from: Point; to: Point } | undefined {
    const anchors = this.edgeAnchors.get(edgeId);
    if (!anchors) return undefined;
    const fromPos = this.nodePositions.get(anchors.sourceNodeId);
    const toPos = this.nodePositions.get(anchors.targetNodeId);
    if (!fromPos || !toPos) return undefined;
    return {
      from: octagonPortAnchor(fromPos, NODE_RADIUS, anchors.sourceAnchor),
      to: octagonPortAnchor(toPos, NODE_RADIUS, anchors.targetAnchor),
    };
  }

  /** The edge's current reshape-able interior points (Falcon,
   * 2026-09-06: Move/Flip/Rotate "reshape the curve, endpoints stay
   * pinned") -- whatever's already stored via setEdgeSegments, or,
   * for an ordinary single-bow edge that's never been reshaped
   * before, the ONE implied bend point its bow already describes
   * (bezier.ts's bendPoint -- the same perpendicular-offset formula
   * curveBetween itself uses). Read-only -- doesn't write/promote
   * anything, so it's safe to call just to check what a Move/Flip/
   * Rotate drag would start from. */
  getEdgeReshapePoints(edgeId: EdgeId): Point[] {
    const interior = this.edgeInteriorPoints.get(edgeId);
    if (interior && interior.length > 0) return interior;
    const ends = this.getEdgeEndpoints(edgeId);
    if (!ends) return [];
    return [bendPoint(ends.from, ends.to, this.edgeBow.get(edgeId) ?? 0)];
  }

  /** Overwrites an edge's reshape-able interior points -- the ONLY
   * way Move/Flip/Rotate ever write back. Promotes a plain single-bow
   * edge to a real stored multi-segment shape the first time this is
   * called (via setEdgeSegments): the new per-segment bows carry over
   * the edge's existing plain bow on every segment so the very first
   * frame of a drag doesn't visually jump, then are left alone (this
   * function never touches them again) so later per-segment bow
   * edits made through the properties panel survive further Move/
   * Flip/Rotate calls untouched. */
  setEdgeReshapePoints(edgeId: EdgeId, points: Point[]): void {
    const bow = this.edgeBow.get(edgeId) ?? 0;
    const existingBows = this.edgeSegmentBows.get(edgeId);
    const bows =
      existingBows && existingBows.length === points.length + 1
        ? existingBows
        : points.map(() => bow).concat(bow);
    this.setEdgeSegments(edgeId, points, bows);
  }

  /** Falcon, 2026-09-05: "dont allow overlapping of nodes and paths
   * (introduction of junctions and elevators later)" — scoped for
   * now to node-vs-node only (paths are curves, not points, and a
   * clean overlap test for those waits until junctions/elevators
   * actually exist). Nodes are approximated as circles of NODE_RADIUS
   * — the same approximation their octagon body already fits inside
   * — so two nodes "overlap" once their centers are closer than
   * 2×NODE_RADIUS. `exclude` lets a node (or, FBP014 2026-09-05,
   * every node in a multi-select group being dragged/duplicated
   * together) ignore its own current position while checking every
   * OTHER node — a single id or an array of ids, so a group move's
   * hard-block check can exclude the whole moving group in one call
   * rather than looping wouldOverlap per member. */
  wouldOverlap(candidate: Point, exclude?: NodeId | NodeId[]): boolean {
    const minDist = NODE_RADIUS * 2;
    const excludeSet = exclude === undefined ? undefined : new Set(Array.isArray(exclude) ? exclude : [exclude]);
    for (const [nodeId, pos] of this.nodePositions.entries()) {
      if (excludeSet?.has(nodeId)) continue;
      if (Math.hypot(pos.x - candidate.x, pos.y - candidate.y) < minDist) return true;
    }
    return false;
  }

  /** Docking (design doc §5.6, 2026-09-09 — "attaching the node
   * without needing to add a path in between"): the exact world
   * position a node would sit at if docked onto `targetNodeId` from
   * compass direction `dir` (skin/octagon.ts's port-index convention,
   * same one octagonPortAnchor uses). Deliberately the same
   * `2 * NODE_RADIUS` boundary wouldOverlap already treats as "not
   * overlapping" — docking never needs a wouldOverlap exception, it
   * just always lands EXACTLY on that boundary. That's slightly
   * farther apart than the two octagons' own edges (which meet at the
   * smaller apothem distance), leaving a few world-units' gap between
   * the bodies — deliberate, not a rounding slip: pathSkin.ts's
   * drawDockSeam renders a small connector plate filling exactly that
   * gap, which is the visual Falcon asked for ("something in between
   * the node to indicate that they are docked"). */
  dockedPosition(targetNodeId: NodeId, dir: number): Point | undefined {
    const center = this.nodePositions.get(targetNodeId);
    if (!center) return undefined;
    const angle = (dir * Math.PI) / 4;
    return { x: center.x + NODE_RADIUS * 2 * Math.cos(angle), y: center.y + NODE_RADIUS * 2 * Math.sin(angle) };
  }

  /** The nearest valid dock slot to `point`, docking `movingNodeId`
   * onto `targetNodeId` — tries all 8 compass directions and returns
   * the closest one within `maxDistance` whose facing anchor pair
   * (dir on the target, the opposite dir on the moving node) is
   * currently free on BOTH sides, or undefined if none qualifies
   * (either every direction is out of range, or the only in-range
   * ones already have that side's anchor taken by a real edge/sketch).
   * Anchor occupancy is checked here rather than left to the eventual
   * setEdgeCurve call so a caller (FluxCanvas's drag-release check)
   * can tell "no valid slot" apart from "found a slot" before doing
   * anything else. */
  nearestDockSlot(
    targetNodeId: NodeId,
    movingNodeId: NodeId,
    point: Point,
    maxDistance: number,
  ): { dir: number; position: Point } | undefined {
    let best: { dir: number; position: Point } | undefined;
    let bestDist = maxDistance;
    for (let dir = 0; dir < OCTAGON_PORT_COUNT; dir++) {
      if (this.isAnchorOccupied(targetNodeId, dir)) continue;
      const oppositeDir = (dir + OCTAGON_PORT_COUNT / 2) % OCTAGON_PORT_COUNT;
      if (this.isAnchorOccupied(movingNodeId, oppositeDir)) continue;
      const position = this.dockedPosition(targetNodeId, dir);
      if (!position) continue;
      const dist = Math.hypot(position.x - point.x, position.y - point.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { dir, position };
      }
    }
    return best;
  }
}
