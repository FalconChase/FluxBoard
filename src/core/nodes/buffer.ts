import type { Item } from '../types';
import type { NodeBehavior, OnItemArrival, PerTickHook } from './contract';

/**
 * Buffer/overflow (design doc §4.2) — a capacity-limited queue with
 * continuous opportunistic drain, and one of two overflow policies
 * once full:
 *  - 'block' (default): accepted: false — natural backpressure onto
 *    whatever's upstream.
 *  - 'divert': the overflowing item bypasses the buffer entirely and
 *    is forwarded straight to the overflow output edge (sourcePort
 *    defaults to 1); if that edge isn't active either, it falls back
 *    to 'block' behavior (accepted: false) rather than dropping.
 */
const onItemArrival: OnItemArrival = (item, node, state, outputEdges) => {
  const capacity = typeof node.config.capacity === 'number' ? node.config.capacity : Infinity;
  const queue: Item[] = [...((state.queue as Item[] | undefined) ?? [])];

  if (queue.length < capacity) {
    queue.push(item);
    return { newState: { ...state, queue }, actions: [] };
  }

  if (node.config.overflowPolicy === 'divert') {
    const overflowPort = typeof node.config.overflowPort === 'number' ? node.config.overflowPort : 1;
    const overflowEdge = outputEdges.find((e) => e.sourcePort === overflowPort && e.active);
    if (overflowEdge) {
      return { newState: state, actions: [{ type: 'forward', edgeId: overflowEdge.id, item }] };
    }
  }

  return { newState: state, actions: [], accepted: false };
};

const tryDrain: PerTickHook = (node, state, outputEdges) => {
  const queue: Item[] = [...((state.queue as Item[] | undefined) ?? [])];
  if (queue.length === 0) {
    return { newState: state, actions: [] };
  }

  const outputPort = typeof node.config.outputPort === 'number' ? node.config.outputPort : 0;
  const outEdge = outputEdges.find((e) => e.sourcePort === outputPort && e.active);
  if (!outEdge) {
    return { newState: state, actions: [] };
  }

  const head = queue[0]!;
  const rest = queue.slice(1);
  return { newState: { ...state, queue: rest }, actions: [{ type: 'forward', edgeId: outEdge.id, item: head }] };
};

export const bufferBehavior: NodeBehavior = { onItemArrival, tryDrain };
