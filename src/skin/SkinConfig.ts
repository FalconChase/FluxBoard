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
  private edgeSkins = new Map<EdgeId, EdgeSkin>();

  setNodeZIndex(nodeId: NodeId, zIndex: number): void {
    this.nodeZIndex.set(nodeId, zIndex);
  }

  getNodeZIndex(nodeId: NodeId): number {
    return this.nodeZIndex.get(nodeId) ?? 0;
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
}
