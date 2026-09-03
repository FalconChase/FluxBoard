import type { EdgeId, NodeId } from '../core/types';
import { BezierPath, curveBetween, type Point } from './bezier';

/**
 * The floor layer's own data: world-space node positions and path curve
 * geometry, keyed by the same ids the logic-layer GraphModel uses
 * (design doc §2 — floor owns positions, logic never touches
 * pixels/coordinates, so these live in a separate structure rather than
 * on NodeDef/EdgeDef).
 */
export class FloorLayout {
  private nodePositions = new Map<NodeId, Point>();
  private edgeCurves = new Map<EdgeId, BezierPath>();
  /** The bow each edge's curve was last built with — kept so a moved
   * node's edges can be rebuilt (Milestone 5 drag-to-move) without
   * losing their original bend. */
  private edgeBow = new Map<EdgeId, number>();

  setNodePosition(nodeId: NodeId, position: Point): void {
    this.nodePositions.set(nodeId, position);
  }

  getNodePosition(nodeId: NodeId): Point | undefined {
    return this.nodePositions.get(nodeId);
  }

  removeNodePosition(nodeId: NodeId): void {
    this.nodePositions.delete(nodeId);
  }

  /** Builds (and caches) an edge's curve from its endpoints' current node
   * positions. Call again if either endpoint moves. */
  setEdgeCurve(edgeId: EdgeId, fromNodeId: NodeId, toNodeId: NodeId, bow = 0.15): void {
    const from = this.nodePositions.get(fromNodeId);
    const to = this.nodePositions.get(toNodeId);
    if (!from || !to) {
      throw new Error(`FloorLayout.setEdgeCurve: missing node position for edge "${edgeId}"`);
    }
    this.edgeCurves.set(edgeId, new BezierPath(curveBetween(from, to, bow)));
    this.edgeBow.set(edgeId, bow);
  }

  /** Rebuilds an edge's curve from its endpoints' CURRENT positions,
   * reusing whatever bow it was originally created with (falls back to
   * the same 0.15 default setEdgeCurve uses). This is what keeps an
   * edge's curve correct after Milestone 5 drag-to-move repositions
   * one of its endpoints — setEdgeCurve itself has no memory of "this
   * edge already existed with a particular bend," only this does. */
  recomputeEdgeCurve(edgeId: EdgeId, fromNodeId: NodeId, toNodeId: NodeId): void {
    this.setEdgeCurve(edgeId, fromNodeId, toNodeId, this.edgeBow.get(edgeId) ?? 0.15);
  }

  getEdgeCurve(edgeId: EdgeId): BezierPath | undefined {
    return this.edgeCurves.get(edgeId);
  }

  removeEdgeCurve(edgeId: EdgeId): void {
    this.edgeCurves.delete(edgeId);
    this.edgeBow.delete(edgeId);
  }
}
