import type { NodeId, EdgeId } from '../core/types';
import { type EdgeSkin, defaultEdgeSkin } from './pathSkin';

/**
 * SkinConfig — the skin layer's own data, keyed by the same ids the
 * logic-layer GraphModel uses (design doc §2 — floor owns positions,
 * skin owns cosmetics, logic never touches either). Mirrors
 * FloorLayout's pattern: a separate store rather than fields bolted
 * onto NodeDef/EdgeDef, so the strict "each layer only reads the one
 * below it" invariant holds structurally, not just by convention.
 *
 * Node z-order (design doc §4.5) lives here as a per-node override;
 * the interactive "bring to front / send to back" UI action lands in
 * Milestone 5, but the data model and render-time sort are ready now.
 */
export class SkinConfig {
  private nodeZIndex = new Map<NodeId, number>();
  private nodeLocked = new Map<NodeId, boolean>();
  private edgeSkins = new Map<EdgeId, EdgeSkin>();

  setNodeZIndex(nodeId: NodeId, zIndex: number): void {
    this.nodeZIndex.set(nodeId, zIndex);
  }

  getNodeZIndex(nodeId: NodeId): number {
    return this.nodeZIndex.get(nodeId) ?? 0;
  }

  /** Locked = drag-to-move is a no-op for this node (Milestone 5).
   * Purely a UI affordance — logic/floor/skin rendering don't care,
   * only FluxCanvas's pointer handling reads this. Defaults to
   * unlocked, keeping the free-canvas design pillar (design doc §1)
   * as the default rather than something opted out of. */
  setNodeLocked(nodeId: NodeId, locked: boolean): void {
    this.nodeLocked.set(nodeId, locked);
  }

  getNodeLocked(nodeId: NodeId): boolean {
    return this.nodeLocked.get(nodeId) ?? false;
  }

  /** Partial update — only the given fields change, everything else
   * (or the shared default) is preserved. */
  setEdgeSkin(edgeId: EdgeId, skin: Partial<EdgeSkin>): void {
    const current = this.edgeSkins.get(edgeId) ?? defaultEdgeSkin;
    this.edgeSkins.set(edgeId, { ...current, ...skin });
  }

  getEdgeSkin(edgeId: EdgeId): EdgeSkin {
    return this.edgeSkins.get(edgeId) ?? defaultEdgeSkin;
  }

  /** Drops whatever skin state a deleted node/edge had (Milestone 5
   * deletion) — otherwise it just sits here orphaned forever, since
   * nothing else ever removes a map entry on its own. Safe to call
   * even if there was never any override to begin with. */
  removeNode(nodeId: NodeId): void {
    this.nodeZIndex.delete(nodeId);
    this.nodeLocked.delete(nodeId);
  }

  removeEdge(edgeId: EdgeId): void {
    this.edgeSkins.delete(edgeId);
  }
}
