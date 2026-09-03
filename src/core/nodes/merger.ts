import type { NodeBehavior, OnItemArrival } from './contract';

/**
 * Merger (Falcon, 2026-09-03: "the opposite of distributor") — the
 * mirror image of distributor: MANY input edges (uncapped, same as
 * distributor's many outputs), exactly ONE output edge (capped via
 * portCapacity.ts, same as source/mixer). Whatever arrives on ANY
 * input edge is forwarded straight out the single active output
 * edge, unchanged, in the same tick — no recipe matching (that's
 * mixer's job), no per-port buffering, no routing DECISION to make
 * (distributor/sorter) since there's only ever one place for an item
 * to go once it arrives here.
 *
 * No active output edge => accepted: false (park on the arrival
 * edge, retry next tick), the same backpressure convention every
 * other capped-output kind already uses (distributor/sorter/mixer).
 */
const onItemArrival: OnItemArrival = (item, _node, state, outputEdges, _arrivalEdge, _makeItemId) => {
  const target = outputEdges.find((e) => e.active);
  if (!target) {
    return { newState: state, actions: [], accepted: false };
  }

  const mergedCount = typeof state.mergedCount === 'number' ? state.mergedCount : 0;
  return {
    newState: { ...state, mergedCount: mergedCount + 1 },
    actions: [{ type: 'forward', edgeId: target.id, item }],
  };
};

export const mergerBehavior: NodeBehavior = { onItemArrival };
