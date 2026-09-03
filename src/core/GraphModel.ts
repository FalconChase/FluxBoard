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

  /** All edges — the query the skin/floor renderers need to draw path
   * geometry and styling (design doc §5, §9 step 4). Read-only, same
   * spirit as getAllNodes(). */
  getAllEdges(): EdgeDef[] {
    return [...this.edges.values()];
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

  /** Edge flow rate — logic-owned, real throughput consequences
   * (design doc §5.4). Small setter mirroring setEdgeActive so the
   * properties panel (Milestone 5) has something to call. */
  setEdgeFlowRate(edgeId: EdgeId, flowRate: number): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    edge.flowRate = flowRate;
  }

  /** Edge port numbers — the integers each node kind's own handler
   * matches against (sorter rules, mixer recipe ports, distributor
   * round-robin order, ...). Renamed here to make clear this is NOT
   * the octagon's 8 geometric port anchors (design doc §4.1) — that
   * mapping doesn't exist yet (FBP009); this only changes which
   * logical port number an existing edge is wired to. */
  updateEdgePorts(edgeId: EdgeId, patch: { sourcePort?: number; targetPort?: number }): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    if (patch.sourcePort !== undefined) edge.sourcePort = patch.sourcePort;
    if (patch.targetPort !== undefined) edge.targetPort = patch.targetPort;
  }

  /** Shallow-merges into a node's own functional config (design doc
   * §4.6 — properties panels read/write logic-layer config; this is
   * the one write path they all share, since each kind's config shape
   * differs and a per-field setter per kind would be far more surface
   * area for the same result). */
  updateNodeConfig(nodeId: NodeId, patch: Record<string, unknown>): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" does not exist`);
    node.config = { ...node.config, ...patch };
  }
}
