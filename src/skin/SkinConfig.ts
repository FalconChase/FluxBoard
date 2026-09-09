import type { NodeId, EdgeId } from '../core/types';
import { type EdgeSkin, defaultEdgeSkin } from './pathSkin';
import type { AnnotationIconKind } from './annotationIcons';

/** Falcon, 2026-09-09 ("add icon on the node properties with the
 * same configuration [as the annotation icon]"): an opt-in
 * built-in-icon override drawn on top of a node's own octagon body
 * (nodeSkin.ts's drawNode), same Size/Badge/Badge-color shape the
 * annotation Icon panel already uses. Skin-owned like everything
 * else in this file -- purely cosmetic, no Logic meaning. */
export interface NodeIconSkin {
  icon: AnnotationIconKind;
  iconSize?: number;
  badge?: boolean;
  badgeColor?: string;
  /** Falcon, 2026-09-09 ("add the label feature properties as how
   * the icon also have its properties adopted on the node's icon
   * section"): same Label + Font shape the annotation Icon panel
   * has, drawn under the node's icon glyph the same way. */
  label?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

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
  private nodeIcons = new Map<NodeId, NodeIconSkin>();

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

  /** Partial update, same merge convention as setEdgeSkin -- only
   * the given fields change. Passing `undefined` (via removeNodeIcon)
   * is how the override is cleared entirely, since an empty/default
   * NodeIconSkin is still "has an icon", just an unconfigured one. */
  setNodeIcon(nodeId: NodeId, patch: Partial<NodeIconSkin> & { icon?: AnnotationIconKind }): void {
    const current = this.nodeIcons.get(nodeId);
    const icon = patch.icon ?? current?.icon;
    if (!icon) return;
    this.nodeIcons.set(nodeId, { ...current, ...patch, icon });
  }

  getNodeIcon(nodeId: NodeId): NodeIconSkin | undefined {
    return this.nodeIcons.get(nodeId);
  }

  /** Clears the override entirely, back to the node kind's plain
   * default icon. */
  removeNodeIcon(nodeId: NodeId): void {
    this.nodeIcons.delete(nodeId);
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
    this.nodeIcons.delete(nodeId);
  }

  removeEdge(edgeId: EdgeId): void {
    this.edgeSkins.delete(edgeId);
  }
}
