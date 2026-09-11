import type { EdgeDef, Item } from '../types';
import type { NodeBehavior, OnItemArrival } from './contract';
import { targetBufferIsFull } from './backpressure';

/**
 * Distributor (design doc §4.2) — routes each arriving item to one or
 * more active output edges.
 *
 *  - mode: 'roundRobin' (default) — cycles through active output
 *    edges in port order, one item per edge per visit.
 *  - mode: 'broadcast' — copies the item onto every active output
 *    edge (each copy gets a fresh id via makeItemId; the copies are
 *    'forward' actions, not new spawns, since they all trace back to
 *    one already-spawned item).
 *  - mode: 'weighted' (2026-09-10 follow-up — Falcon: "its a round
 *    robin but set to a certain outflow in a certain way," e.g. 3
 *    outputs at 1:3:5 instead of round-robin's implicit 1:1:1) — same
 *    cycling mechanism as plain round-robin, just over an EXPANDED
 *    sequence built by `buildWeightedSequence` below (each active port
 *    repeated its own configured weight's number of times per cycle).
 *
 * No active output edges => accepted: false (park, retry next tick)
 * rather than dropping the item.
 *
 * `targetBufferIsFull` check (2026-09-10 — Falcon: "the distributor
 * node keeps accepting items even nowhere to be distribute direction
 * for like it simply accepts endlessly"): before this, "has an active
 * output edge" was treated as the whole answer to "can I take this
 * item" — it never asked whether the edge's TARGET could actually
 * hold another one. A distributor feeding a buffer that's already at
 * capacity kept accepting every arrival anyway and forwarding it
 * straight onto that edge, where it had nowhere real to go — the same
 * "eagerly hands off with no idea if the target has room" shape as
 * the docked-Silo-chain bug (§5.8), just on the onItemArrival side
 * instead of tryDrain. Fixed the same way: peek the candidate
 * target(s) before accepting, and refuse (park upstream, retry next
 * tick) instead of forwarding into a wall.
 *
 * Round-robin only ever peeks the ONE edge its index currently points
 * at — a blocked target holds there without state.rrIndex advancing
 * (so the retry re-checks the exact same edge, not a different one),
 * same "hold on the specific chosen destination" convention sorter's
 * unmatchedPolicy and mixer's recipe-complete-but-blocked case already
 * use. With more than one active output this means a jam on one side
 * can hold up items that would have fit down another; ask if that
 * matters in practice before building the fancier "skip to whichever
 * active edge currently has room" version.
 *
 * Broadcast holds ALL-or-nothing: if even one active edge's target is
 * full, nothing is sent this tick, rather than silently dropping just
 * that one copy and breaking the "one copy per active output"
 * invariant broadcast exists for.
 */
const onItemArrival: OnItemArrival = (item, node, state, outputEdges, _arrivalEdge, makeItemId, ctx) => {
  const active = outputEdges.filter((e) => e.active).sort((a, b) => a.sourcePort - b.sourcePort);
  if (active.length === 0) {
    return { newState: state, actions: [], accepted: false };
  }

  const mode = node.config.mode === 'broadcast' ? 'broadcast' : node.config.mode === 'weighted' ? 'weighted' : 'roundRobin';

  const routedCount = typeof state.routedCount === 'number' ? state.routedCount : 0;

  if (mode === 'broadcast') {
    if (active.some((edge) => targetBufferIsFull(edge, ctx))) {
      return { newState: state, actions: [], accepted: false };
    }
    const actions = active.map((edge) => ({
      type: 'forward' as const,
      edgeId: edge.id,
      item: { id: makeItemId(), type: item.type } as Item,
    }));
    return { newState: { ...state, routedCount: routedCount + 1 }, actions };
  }

  // Plain round-robin cycles over `active` directly; weighted cycles
  // over an expanded sequence instead — every other step (index math,
  // the hold-on-refusal convention) is identical, so both share the
  // block below by picking which list to cycle over first.
  const cycle =
    mode === 'weighted' ? buildWeightedSequence(active, node.config.weights as Record<string, number> | undefined) : active;
  if (cycle.length === 0) {
    // Every active port weighed 0 -- same "nowhere real to send this"
    // outcome as zero active edges above, not a bug to work around.
    return { newState: state, actions: [], accepted: false };
  }

  const rrIndex = typeof state.rrIndex === 'number' ? state.rrIndex : 0;
  const target = cycle[rrIndex % cycle.length]!;
  if (targetBufferIsFull(target, ctx)) {
    return { newState: state, actions: [], accepted: false };
  }
  return {
    newState: { ...state, rrIndex: (rrIndex + 1) % cycle.length, routedCount: routedCount + 1 },
    actions: [{ type: 'forward', edgeId: target.id, item }],
  };
};

/** Builds the expanded weighted-round-robin cycle: each active edge
 * (already sorted by `sourcePort`) repeated its own weight's number of
 * times, in port order. `weights` is keyed by the STRING form of each
 * edge's `sourcePort` (not edge id, which can change if a wire is
 * redrawn) — a port with no entry (or a non-finite one) defaults to
 * weight 1, so an unconfigured distributor produces the exact same
 * cycle plain round-robin would (every port once). A port explicitly
 * weighted to 0 is skipped entirely — a deliberate "route nothing here
 * for now" switch; if EVERY active port weighs 0 the caller sees an
 * empty sequence and treats it the same as zero active edges. Exported
 * for direct unit testing alongside onItemArrival above. */
export function buildWeightedSequence(active: EdgeDef[], weights: Record<string, number> | undefined): EdgeDef[] {
  const sequence: EdgeDef[] = [];
  for (const edge of active) {
    const raw = weights?.[String(edge.sourcePort)];
    const weight = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 1;
    for (let i = 0; i < weight; i++) sequence.push(edge);
  }
  return sequence;
}

export const distributorBehavior: NodeBehavior = { onItemArrival };
