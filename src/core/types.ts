/**
 * Logic-layer types (see design doc §2, §4.4).
 *
 * These describe topology and functional config only — no coordinates,
 * no styling. Floor and Skin layers define their own types that reference
 * these ids but never the reverse.
 */

export type NodeId = string;
export type EdgeId = string;

/** Flat type tag for v1 items (design doc §4.7). */
export type ItemType = string;

export interface Item {
  id: string;
  type: ItemType;
}

export type NodeKind =
  | 'source'
  | 'distributor'
  | 'merger'
  | 'sorter'
  | 'mixer'
  | 'buffer'
  | 'sink';

/** Pure topology + static config for one node. No runtime state here. */
export interface NodeDef {
  id: NodeId;
  kind: NodeKind;
  // Per-kind config (spawn rate, recipe, rules, capacity, overflowPolicy...)
  // is intentionally left to be added per node type as milestone 3 builds
  // out the registry (design doc §4.2, §4.6).
  config: Record<string, unknown>;
}

/** Pure topology + static config for one edge. No geometry, no style. */
export interface EdgeDef {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  sourcePort: number;
  targetPort: number;
  flowRate: number;
  /** Edge gating (design doc §7) — independent of flowRate. */
  active: boolean;
}
