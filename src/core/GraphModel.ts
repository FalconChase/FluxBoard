import type { NodeDef, EdgeDef, NodeId, EdgeId } from './types';

/**
 * GraphModel — pure topology (design doc §4.4, §6).
 *
 * Holds node/edge ids, ports and static config only. No rendering
 * knowledge, no mutable runtime state (that's NodeRuntimeState), no
 * pixels. Safe to serialize directly as the saved graph.
 */
export class GraphModel {
  private nodes = new Map<NodeId, NodeDef>();
  private edges = new Map<EdgeId, EdgeDef>();
  private outEdgesByNode = new Map<NodeId, EdgeId[]>();

  addNode(node: NodeDef): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists`);
    }
    this.nodes.set(node.id, node);
  }

  addEdge(edge: EdgeDef): void {
    if (this.edges.has(edge.id)) {
      throw new Error(`Edge "${edge.id}" already exists`);
    }
    if (!this.nodes.has(edge.source)) {
      throw new Error(`Edge "${edge.id}" references unknown source node "${edge.source}"`);
    }
    if (!this.nodes.has(edge.target)) {
      throw new Error(`Edge "${edge.id}" references unknown target node "${edge.target}"`);
    }
    this.edges.set(edge.id, edge);

    const list = this.outEdgesByNode.get(edge.source) ?? [];
    list.push(edge.id);
    this.outEdgesByNode.set(edge.source, list);
  }

  getNode(id: NodeId): NodeDef | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: EdgeId): EdgeDef | undefined {
    return this.edges.get(id);
  }

  getAllNodes(): NodeDef[] {
    return [...this.nodes.values()];
  }

  /** Outgoing edges from a node — the query SimEngine needs to route items. */
  outputEdges(nodeId: NodeId): EdgeDef[] {
    return (this.outEdgesByNode.get(nodeId) ?? []).map((id) => this.edges.get(id)!);
  }

  /** Flow gate toggle (design doc §7) — preserves flowRate. */
  setEdgeActive(edgeId: EdgeId, active: boolean): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    edge.active = active;
  }
}
