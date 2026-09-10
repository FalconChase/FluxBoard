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
  | 'sink'
  /** Trigger system (design doc §4.8, 2026-09-09 node-design session).
   * 1 in / 1 out valve — no storage of its own. Opens only while its
   * runtime state's `open` flag is true, which only a connected
   * Sensor's signal ever sets (see `evaluateSignals` in contract.ts
   * and sensor.ts) — a Gate with no Sensor wired to it can never open,
   * by construction, not by a separate validation rule. */
  | 'gate'
  /** Trigger system (design doc §4.8) — reads a condition (v1: another
   * node's queue length, e.g. a "Silo" — just a buffer at larger
   * capacity, §4.2) and fires a level-based signal down its outgoing
   * signal edges (edgeKind: 'signal', below) to every connected Gate.
   * Carries no physical item and has no onItemArrival at all. */
  | 'sensor';

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
  /** Design doc §5.5 (2026-09-09 node-design session): a Sensor→Gate
   * connection is a distinct path kind from every edge above — it
   * carries an event/pulse, not a physical Item, so it never gets a
   * `progress` value or an in-flight item token and needs no
   * conservation accounting. Optional, defaulting to item-carrying
   * behavior (undefined === 'item'), same "no version bump" convention
   * as speedLocked/lockedSpeed above — every pre-existing edge in a
   * saved project keeps behaving exactly as it always has.
   *
   * 'dock' (design doc §5.6, 2026-09-09 docking follow-up): a Gate↔
   * Buffer/Silo connection made by dragging the two nodes to touch
   * rather than drawing a path — still a completely ordinary item-
   * carrying edge to every node behavior (gate.ts/buffer.ts's
   * onItemArrival don't need to know or care), the ONLY difference is
   * an intentionally huge `flowRate` (App.tsx's DOCK_FLOW_RATE) so an
   * item's `progress` crosses 0→1 in a single tick — no new SimEngine
   * mechanism, reusing 100% of the existing send/forward/arrival
   * machinery, per Falcon's explicit choice of that option over a
   * deeper "merged single node" alternative. Skin never draws it as a
   * conveyor/tube (FluxCanvas skips it in the normal path-render
   * passes) — instead a small connector seam is drawn between the two
   * touching octagons (pathSkin.ts's drawDockSeam), and it's excluded
   * from click-to-select (FluxCanvas's hitTestEdge) since its curve is
   * only a few world-units long by construction (see FloorLayout's
   * dockedPosition — touching distance is the same 2×NODE_RADIUS
   * boundary wouldOverlap already treats as "not overlapping", which
   * sits slightly outside the octagons' actual edge-to-edge apothem
   * distance, leaving the small gap the seam visually fills).
   *
   * NOTE (design doc §5.7, 2026-09-09 follow-up): 'dock' is no longer
   * the only edgeKind a drag-to-dock gesture can produce — a Silo↔
   * Sensor dock is a copper/signal connection, not an item edge (see
   * `docked` below and App.tsx's handleDockNodes), so it's created
   * with edgeKind: 'signal' instead. 'dock' itself keeps meaning
   * exactly what it always did: a huge-flowRate real item edge drawn
   * as a connector seam. */
  edgeKind?: 'item' | 'signal' | 'dock';
  /** Docking (design doc §5.6/§5.7, 2026-09-09): true for every edge
   * created by the drag-to-snap dock gesture, REGARDLESS of its
   * edgeKind — orthogonal to edgeKind on purpose. edgeKind still
   * governs routing/rendering (does this edge carry real items? does
   * it draw as a seam or a normal path?); `docked` governs a separate
   * concern, whether the two endpoints are "attached as one unit" for
   * UI purposes: FluxCanvas's group-move (dragging either docked node
   * moves the whole transitively-docked chain) and PropertiesPanel's
   * DockSection (flip direction / detach). A Gate↔Buffer or Buffer↔
   * Buffer dock is both `edgeKind: 'dock'` AND `docked: true` (the two
   * happened to always coincide before this field existed); a Buffer↔
   * Sensor dock is `edgeKind: 'signal'` (so it never carries a real
   * item and renders as an ordinary copper wire) but still `docked:
   * true` (so it still groups/detaches like any other dock). Undefined
   * on every edge from before this existed, or from a plain hand-drawn
   * wire — both mean "not docked," same "no version bump" convention
   * as edgeKind/speedLocked above. */
  docked?: boolean;
  /** Falcon, 2026-09-09 ("is it possible to never overlap the items
   * like they wont continue piling up ... respects the size of the
   * object along a path"; then, same day, "i want it to be by default
   * to respect item sizes"): DEFAULT ON — undefined/anything but an
   * explicit `false` means enabled, the one field in this file that
   * inverts the usual "undefined means old/off behavior" convention,
   * by his own direct request. Set it to `false` on a specific edge to
   * opt that one path OUT (still a per-edge override, just flipped
   * from how speedLocked/docked/etc. default). When enabled, SimEngine
   * keeps every item on this edge at least its own size's worth of
   * clearance (plus the size of whichever item is directly ahead of
   * it) behind that item, rather than letting items' progress values
   * close in on each other freely — a trailing item that would
   * otherwise catch up to the one ahead is held back instead, exactly
   * like a physical object queuing behind another. Never applies to a
   * `dock` edge regardless of this flag (SimEngine checks
   * `edgeKind !== 'dock'` too) — a dock's huge flowRate and near-zero
   * seam length make size-based spacing meaningless there and risk
   * reintroducing the exact docked-chain stall design doc §5.8 fixed. */
  respectItemSize?: boolean;
  /** The bridged real-world length (design doc §2's "never a second
   * source of truth," same bridging shape as lockedSpeed) of this
   * edge's CURRENT path, in Floor-layer world units — kept in sync by
   * App.tsx's own poll for every edge respectItemSize doesn't
   * explicitly disable (mirrors the speed-lock poll exactly: Floor-
   * layer length changes through several different mutation sites —
   * node moves, curvature edits, anchor reassignment — with no single
   * handler to instrument instead). SimEngine needs this to convert a
   * world-space item size (Skin-layer ObjectRegistry data, itself
   * bridged in per-tick as a plain resolver function, never imported
   * directly) into a minimum PROGRESS gap between two items on this
   * edge: gapProgress = (sizeOfItemAhead + sizeOfThisItem) /
   * pathLength. Ignored (but not cleared) whenever respectItemSize is
   * explicitly false, same convention as lockedSpeed while
   * speedLocked is false. */
  pathLength?: number;
}
