import type { Item } from '../types';
import type { NodeBehavior, NodeTickContext, OnItemArrival, PerTickHook } from './contract';

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

/**
 * Peek at a candidate output edge's TARGET before tryDrain commits to
 * dequeuing (design doc §5.8, 2026-09-09 follow-up — Falcon, testing a
 * docked Silo chain: "only the last silo gets filled then the rest
 * never get filled no matter how many items already passed through").
 *
 * Root cause: tryDrain used to dequeue its head item and fire a
 * 'forward' action with NO idea whether the target could actually
 * accept it. For an ORDINARY (slow-flowRate) edge that's harmless —
 * a refused item just visibly parks at progress 1 right outside the
 * target (SimEngine's own backpressure convention), which reads as
 * normal, visible congestion. But a docked Silo->Silo edge has a huge
 * flowRate (App.tsx's DOCK_FLOW_RATE — refused or not, it's re-checked
 * on the very next tick) AND dock edges are deliberately excluded from
 * FluxCanvas's item-token render pass (a connector seam is drawn there
 * instead, not a travelling token) — so a refused item on a dock edge
 * became invisible forever: already gone from the draining Silo's own
 * queue, never reflected in the target Silo's queue either, just
 * silently parked forever in SimEngine's internal item map with no
 * on-screen trace. That's exactly why every Silo except the very last
 * one in a docked chain always read empty: each one kept eagerly
 * emptying itself into the next regardless of whether the next had
 * room, so nothing short of the chain's dead end ever visibly
 * accumulated.
 *
 * Only buffer targets are checked — a buffer/Silo is the one node kind
 * with a checkable "capacity" concept today; every other target kind
 * (sink, gate, mixer, ...) keeps the original eager-drain behavior
 * unchanged. Uncapped (`capacity` left as Infinity) never blocks.
 */
function targetBufferIsFull(edge: { target: string }, ctx: NodeTickContext | undefined): boolean {
  const targetNode = ctx?.getNode(edge.target);
  if (targetNode?.kind !== 'buffer') return false;
  const targetState = ctx?.getNodeState(edge.target);
  const targetQueue = (targetState?.queue as Item[] | undefined) ?? [];
  const targetCapacity = typeof targetNode.config.capacity === 'number' ? targetNode.config.capacity : Infinity;
  return targetQueue.length >= targetCapacity;
}

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
