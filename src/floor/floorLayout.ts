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

  setNodePosition(nodeId: NodeId, position: Point): void {
    this.nodePositions.set(nodeId, position);
  }

  getNodePosition(nodeId: NodeId): Point | undefined {
    return this.nodePositions.get(nodeId);
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
  }

  getEdgeCurve(edgeId: EdgeId): BezierPath | undefined {
    return this.edgeCurves.get(edgeId);
  }
}
