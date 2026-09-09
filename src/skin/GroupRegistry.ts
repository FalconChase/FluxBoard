import type { EdgeId, NodeId } from '../core/types';

/** One persisted "local group" (Falcon, 2026-09-06: "use multiselect
 * then those will get group into one group as a local group and in
 * contrast to that ... the ungroup/explode reverting the group into
 * as before regardless of other modifications"). A group is nothing
 * more than a named set of member ids — no position, no skin, no
 * logic meaning of its own — so grouping/ungrouping never touches
 * anything about the members themselves (position, wiring, config);
 * it only changes whether selecting one of them selects all of them
 * together (App.tsx's handleSelect). */
export interface GroupDef {
  id: string;
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  sketchIds: string[];
}

/**
 * Deliberately NOT part of the Logic/Floor/Skin architecture proper
 * (design doc §2) — like SketchLayer, this is pure UI/selection
 * scratch data. Lives in skin/ anyway (not app/) so it can be
 * threaded through persistence.ts alongside ObjectRegistry/SkinConfig
 * with the same "mutated directly, single source of truth" convention
 * (design doc §4.6) rather than living as extra App.tsx-only state.
 *
 * A member (node, edge, or sketch) belongs to at most ONE group at a
 * time in this first pass — App.tsx's handleGroupSelection refuses to
 * fold a member that's already in a different group into a new one
 * (flashes a reason) rather than silently stealing it away.
 */
export class GroupRegistry {
  private groups = new Map<string, GroupDef>();
  private nodeToGroup = new Map<NodeId, string>();
  private edgeToGroup = new Map<EdgeId, string>();
  private sketchToGroup = new Map<string, string>();

  /** Creates a new group — assumes the caller (App.tsx) already
   * confirmed none of these members belong to an existing group. */
  create(id: string, nodeIds: NodeId[], edgeIds: EdgeId[], sketchIds: string[]): void {
    this.groups.set(id, { id, nodeIds: [...nodeIds], edgeIds: [...edgeIds], sketchIds: [...sketchIds] });
    for (const n of nodeIds) this.nodeToGroup.set(n, id);
    for (const e of edgeIds) this.edgeToGroup.set(e, id);
    for (const s of sketchIds) this.sketchToGroup.set(s, id);
  }

  get(id: string): GroupDef | undefined {
    return this.groups.get(id);
  }

  getAll(): GroupDef[] {
    return [...this.groups.values()];
  }

  groupOfNode(id: NodeId): string | undefined {
    return this.nodeToGroup.get(id);
  }
  groupOfEdge(id: EdgeId): string | undefined {
    return this.edgeToGroup.get(id);
  }
  groupOfSketch(id: string): string | undefined {
    return this.sketchToGroup.get(id);
  }

  /** Dissolves a group WITHOUT touching any member's own state
   * (position, wiring, edits made while grouped) — per Falcon's own
   * framing, Ungroup reverts only the grouping structure itself,
   * "regardless of other modifications" made to members in the
   * meantime. Returns the dissolved group's membership (App.tsx uses
   * it to rebuild the plain multi-selection left behind), or
   * undefined if `id` wasn't a real group. */
  dissolve(id: string): GroupDef | undefined {
    const def = this.groups.get(id);
    if (!def) return undefined;
    for (const n of def.nodeIds) this.nodeToGroup.delete(n);
    for (const e of def.edgeIds) this.edgeToGroup.delete(e);
    for (const s of def.sketchIds) this.sketchToGroup.delete(s);
    this.groups.delete(id);
    return def;
  }

  /** Removes just one member from whatever group it's in (a no-op if
   * it isn't in one) — used by App.tsx's delete cascades so a
   * deleted node/edge/sketch never leaves a stale id inside a group
   * definition. Dissolves the group outright if that leaves fewer
   * than 2 total members left (a "group" of 0-1 things means
   * nothing) — same self-cleaning spirit as every other cascade in
   * this app. */
  private removeMember(kind: 'node' | 'edge' | 'sketch', id: string): void {
    const groupId =
      kind === 'node' ? this.nodeToGroup.get(id) : kind === 'edge' ? this.edgeToGroup.get(id) : this.sketchToGroup.get(id);
    if (!groupId) return;
    const def = this.groups.get(groupId);
    if (!def) return;
    if (kind === 'node') {
      def.nodeIds = def.nodeIds.filter((x) => x !== id);
      this.nodeToGroup.delete(id);
    } else if (kind === 'edge') {
      def.edgeIds = def.edgeIds.filter((x) => x !== id);
      this.edgeToGroup.delete(id);
    } else {
      def.sketchIds = def.sketchIds.filter((x) => x !== id);
      this.sketchToGroup.delete(id);
    }
    const remaining = def.nodeIds.length + def.edgeIds.length + def.sketchIds.length;
    if (remaining < 2) this.dissolve(groupId);
  }

  removeNodeMember(nodeId: NodeId): void {
    this.removeMember('node', nodeId);
  }
  removeEdgeMember(edgeId: EdgeId): void {
    this.removeMember('edge', edgeId);
  }
  removeSketchMember(sketchId: string): void {
    this.removeMember('sketch', sketchId);
  }

  /** Empties every group — used by persistence.ts's clearAllStores
   * (loading a different project) so a stale group id from the
   * previous project can never collide with one from the project
   * being loaded next. */
  clear(): void {
    this.groups.clear();
    this.nodeToGroup.clear();
    this.edgeToGroup.clear();
    this.sketchToGroup.clear();
  }

  /** Replaces every group wholesale from a saved list — same
   * "clear then repopulate the SAME instance" pattern
   * ObjectRegistry.replaceAll already uses. */
  replaceAll(defs: GroupDef[]): void {
    this.clear();
    for (const def of defs) this.create(def.id, def.nodeIds, def.edgeIds, def.sketchIds);
  }
}
