import type { Item } from '../types';
import type { NodeBehavior, OnItemArrival } from './contract';

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
 *
 * No active output edges => accepted: false (park, retry next tick)
 * rather than dropping the item.
 */
const onItemArrival: OnItemArrival = (item, node, state, outputEdges, _arrivalEdge, makeItemId) => {
  const active = outputEdges.filter((e) => e.active).sort((a, b) => a.sourcePort - b.sourcePort);
  if (active.length === 0) {
    return { newState: state, actions: [], accepted: false };
  }

  const mode = node.config.mode === 'broadcast' ? 'broadcast' : 'roundRobin';

  const routedCount = typeof state.routedCount === 'number' ? state.routedCount : 0;

  if (mode === 'broadcast') {
    const actions = active.map((edge) => ({
      type: 'forward' as const,
      edgeId: edge.id,
      item: { id: makeItemId(), type: item.type } as Item,
    }));
    return { newState: { ...state, routedCount: routedCount + 1 }, actions };
  }

  const rrIndex = typeof state.rrIndex === 'number' ? state.rrIndex : 0;
  const target = active[rrIndex % active.length]!;
  return {
    newState: { ...state, rrIndex: (rrIndex + 1) % active.length, routedCount: routedCount + 1 },
    actions: [{ type: 'forward', edgeId: target.id, item }],
  };
};

export const distributorBehavior: NodeBehavior = { onItemArrival };
