import type { Item } from '../types';
import type { NodeBehavior, OnItemArrival, PerTickHook } from './contract';
import { targetBufferIsFull } from './backpressure';

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
 *
 * Both output lookups below explicitly exclude `edgeKind === 'signal'`
 * (design doc §5.7, 2026-09-09 follow-up, fixed alongside the copper-
 * path wiring rule extending to Buffer/Silo): before that, a Buffer's
 * output edges were ALWAYS real item edges by construction, since
 * nothing could put a signal edge on a Buffer's ports at all — the
 * `sourcePort` match alone was a safe way to pick "the" real output.
 * Now that a Silo can also carry a copper watch-out edge to a Sensor
 * (isCopperCompatible in App.tsx), a real item could otherwise land on
 * that copper edge purely by sourcePort coincidence and get stuck
 * forever (Sensor has no onItemArrival — see portCapacity's sensor
 * cap comment) — the exact same class of routing ambiguity gate.ts's
 * onItemArrival already guards against for its own physical output
 * lookup, applied here for the same reason.
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
    const overflowEdge = outputEdges.find((e) => e.sourcePort === overflowPort && e.active && e.edgeKind !== 'signal');
    if (overflowEdge) {
      return { newState: state, actions: [{ type: 'forward', edgeId: overflowEdge.id, item }] };
    }
  }

  return { newState: state, actions: [], accepted: false };
};

const tryDrain: PerTickHook = (node, state, outputEdges, _dt, _makeItemId, ctx) => {
  const queue: Item[] = [...((state.queue as Item[] | undefined) ?? [])];
  if (queue.length === 0) {
    return { newState: state, actions: [] };
  }

  const outputPort = typeof node.config.outputPort === 'number' ? node.config.outputPort : 0;
  const outEdge = outputEdges.find((e) => e.sourcePort === outputPort && e.active && e.edgeKind !== 'signal');
  if (!outEdge) {
    return { newState: state, actions: [] };
  }
  if (targetBufferIsFull(outEdge, ctx)) {
    // Hold — same "nowhere to send it, wait" outcome as no active edge
    // at all, just discovered a tick earlier than it otherwise would
    // be (at delivery time). Backpressure now cascades backward
    // through a docked chain one Silo at a time, visibly, same as a
    // real chain of gravity-fed tanks.
    return { newState: state, actions: [] };
  }

  const head = queue[0]!;
  const rest = queue.slice(1);
  return { newState: { ...state, queue: rest }, actions: [{ type: 'forward', edgeId: outEdge.id, item: head }] };
};

export const bufferBehavior: NodeBehavior = { onItemArrival, tryDrain };
