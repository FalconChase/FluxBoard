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
  /** Falcon, 2026-09-05 ("the longer the path the faster it is, the
   * shorter the path the slower is it, can you explain... Option D"):
   * opt-in per edge. When true, flowRate is no longer something you
   * set directly — App.tsx's own poll keeps recomputing it from
   * `lockedSpeed` (a real world-units/second target) any time this
   * path's on-screen length changes, so the item's APPARENT speed
   * stays pinned regardless of how the path gets resized. Off by
   * default — an edge with no lock behaves exactly as it always has
   * (flowRate is the literal source of truth, apparent speed drifts
   * as the path is resized). */
  speedLocked?: boolean;
  /** The pinned real-world speed (world units/second) this edge's
   * flowRate is kept solving for while speedLocked is true. Ignored
   * (but not cleared) whenever speedLocked is false. */
  lockedSpeed?: number;
}
