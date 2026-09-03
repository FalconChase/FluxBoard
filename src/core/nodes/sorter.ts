import type { Item, NodeDef } from '../types';
import type { NodeBehavior, OnItemArrival } from './contract';

interface SorterRule {
  itemType?: string;
  outputPort: number;
}

/**
 * Sorter (design doc §4.2) — strict first-match rules route by item
 * type to an output port; `defaultPort` catches anything unmatched.
 *
 * If the resolved port has no active output edge (including a gated-
 * off edge — FBP003), it's treated the same as "no rule matched":
 * unmatchedPolicy decides what happens —
 *  - 'hold' (default): accepted: false, item stays parked and is
 *    retried next tick (natural backpressure, e.g. once the edge is
 *    un-gated).
 *  - 'drop': the item is silently destroyed; droppedCount is tracked
 *    in node state for visibility.
 */
function resolvePort(item: Item, node: NodeDef): number | undefined {
  const rules = Array.isArray(node.config.rules) ? (node.config.rules as SorterRule[]) : [];
  for (const rule of rules) {
    if (rule.itemType === undefined || rule.itemType === item.type) return rule.outputPort;
  }
  return typeof node.config.defaultPort === 'number' ? node.config.defaultPort : undefined;
}

const onItemArrival: OnItemArrival = (item, node, state, outputEdges) => {
  const port = resolvePort(item, node);
  const edge = port === undefined ? undefined : outputEdges.find((e) => e.sourcePort === port && e.active);

  if (!edge) {
    if (node.config.unmatchedPolicy === 'drop') {
      const droppedCount = typeof state.droppedCount === 'number' ? state.droppedCount : 0;
      return { newState: { ...state, droppedCount: droppedCount + 1 }, actions: [] };
    }
    return { newState: state, actions: [], accepted: false };
  }

  const routedCount = typeof state.routedCount === 'number' ? state.routedCount : 0;
  return {
    newState: { ...state, routedCount: routedCount + 1 },
    actions: [{ type: 'forward', edgeId: edge.id, item }],
  };
};

export const sorterBehavior: NodeBehavior = { onItemArrival };
