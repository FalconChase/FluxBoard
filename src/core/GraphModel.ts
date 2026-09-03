import type { NodeDef, EdgeDef, NodeId, EdgeId } from './types';

/**
 * GraphModel — pure topology (design doc §4.4, §6).
 *
 * Holds node/edge ids, ports and static config only. No rendering
 * knowledge, no mutable runtime state (that's NodeRuntimeState), no
 * pixels. Safe to serialize directly as the saved graph.
 *
 * TODO (Milestone 1): add/remove node & edge, lookup by id, and
 * outputEdges(nodeId) — the query SimEngine needs to route items.
 */
export class GraphModel {
  private nodes = new Map<NodeId, NodeDef>();
  private edges = new Map<EdgeId, EdgeDef>();

  addNode(_node: NodeDef): void {
    throw new Error('not implemented');
  }

  addEdge(_edge: EdgeDef): void {
    throw new Error('not implemented');
  }

  getNode(_id: NodeId): NodeDef | undefined {
    throw new Error('not implemented');
  }

  outputEdges(_nodeId: NodeId): EdgeDef[] {
    throw new Error('not implemented');
  }
}
