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

  /** Incoming edges to a node — no index kept for this direction (only
   * outputEdges is on the hot SimEngine path), so this scans all edges.
   * Cheap enough for wiring-time checks (portCapacity.ts's per-kind
   * input caps) and other occasional callers; not meant for a per-tick
   * hot path the way outputEdges is. */
  inputEdges(nodeId: NodeId): EdgeDef[] {
    return this.getAllEdges().filter((e) => e.target === nodeId);
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

  /** Falcon, 2026-09-05 ("Option D" — a per-path opt-in lock so the
   * path's apparent speed stays pinned as it's resized, rather than
   * every path behaving that way globally): records the toggle plus
   * the real-world speed (world units/second) it should keep solving
   * for. Doesn't itself touch flowRate — App.tsx's own poll is what
   * continuously recomputes flowRate from lockedSpeed against this
   * edge's CURRENT path length (same "poll instead of instrumenting
   * every mutation site" convention undo/redo already uses, since a
   * path's length can change through several different code paths —
   * a node drag, a curvature edit, a reassigned anchor). Passing no
   * lockedSpeed while turning the lock off leaves the last value in
   * place (harmless — it's ignored whenever speedLocked is false),
   * so a later re-enable without a fresh speed still remembers the
   * old target. */
  setEdgeSpeedLock(edgeId: EdgeId, locked: boolean, lockedSpeed?: number): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    edge.speedLocked = locked;
    if (lockedSpeed !== undefined) edge.lockedSpeed = lockedSpeed;
  }

  /** Falcon, 2026-09-09 ("respects the size of the object along a
   * path"; "by default to respect item sizes"): the no-overlap
   * toggle — on by default per edge (see EdgeDef.respectItemSize's own
   * doc comment for why this one field inverts the usual undefined-
   * means-off convention); this setter is how a specific edge opts
   * OUT by passing `false`. Doesn't itself touch `pathLength` —
   * App.tsx's own poll is what keeps that field synced against this
   * edge's CURRENT length, same "poll instead of instrumenting every
   * mutation site" reasoning setEdgeSpeedLock's own doc comment
   * already explains. */
  setEdgeItemSpacing(edgeId: EdgeId, respectItemSize: boolean): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    edge.respectItemSize = respectItemSize;
  }

  /** Bridged Floor-layer measurement (see EdgeDef.pathLength's own doc
   * comment) — small setter mirroring setEdgeFlowRate so App.tsx's
   * poll has something to call. Only meaningful while
   * respectItemSize is true; harmless to set otherwise. */
  setEdgePathLength(edgeId: EdgeId, pathLength: number): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    edge.pathLength = pathLength;
  }

  /** Design doc §5.5/§5.6 (2026-09-09): switches an edge between
   * carrying physical items (the default, undefined/'item'), carrying
   * a Sensor's signal pulse ('signal'), or being a docked connection
   * ('dock') — see EdgeDef.edgeKind's own doc comment in types.ts for
   * what each actually changes at runtime. */
  setEdgeKind(edgeId: EdgeId, edgeKind: NonNullable<EdgeDef['edgeKind']>): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge "${edgeId}" does not exist`);
    edge.edgeKind = edgeKind;
  }

  /** Edge port numbers — the integers each node kind's own handler
   * matches against (sorter rules, mixer recipe ports, distributor
   * round-robin order, ...). Originally NOT the octagon's 8 geometric
   * port anchors (design doc §4.1, FBP009) — as of 2026-09-10 (Falcon:
   * "the ports are named according to compass") these ARE that same
   * anchor index; every caller that moves an edge's physical anchor
   * (App.tsx's edge-creation sites, PropertiesPanel's EdgeSidePicker)
   * calls this alongside FloorLayout.reassignAnchor/setEdgeCurve so
   * the two never drift apart. Kept as a separate direct setter (not
   * folded into FloorLayout itself) since GraphModel/EdgeDef is still
   * the one place a node's own onItemArrival ever reads these from —
   * SimEngine has no FloorLayout dependency at all (design doc §4.6). */
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

  /** Removes one edge. Idempotent — removing an id that's already
   * gone (e.g. a cascade from removeNode racing a direct call) is a
   * no-op, not an error, since "the edge doesn't exist" is exactly
   * the state the caller wanted. */
  removeEdge(edgeId: EdgeId): void {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.edges.delete(edgeId);
    const list = this.outEdgesByNode.get(edge.source);
    if (list) {
      const idx = list.indexOf(edgeId);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  /** Removes a node AND every edge touching it (as source or
   * target) — an edge can't legally reference a node that no longer
   * exists (addEdge already enforces that on the way in). Returns the
   * ids of the edges removed as a side effect, so a caller managing
   * per-edge state in another layer (floor curves, skin styling) knows
   * what else to clean up — GraphModel has no idea those layers exist
   * (design doc §2). No-op if the node doesn't exist. */
  removeNode(nodeId: NodeId): EdgeId[] {
    if (!this.nodes.has(nodeId)) return [];
    const removedEdgeIds: EdgeId[] = [];
    for (const edge of [...this.edges.values()]) {
      if (edge.source === nodeId || edge.target === nodeId) {
        removedEdgeIds.push(edge.id);
        this.removeEdge(edge.id);
      }
    }
    this.nodes.delete(nodeId);
    this.outEdgesByNode.delete(nodeId);
    return removedEdgeIds;
  }
}
