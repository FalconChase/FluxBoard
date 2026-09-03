import type { Item } from '../types';
import type { NodeBehavior, OnItemArrival } from './contract';

type Buffers = Record<number, Item[]>;

/**
 * Mixer (design doc §4.2) — per-input-port buffered recipe matching.
 * `recipe` maps each required input port to the item type it expects;
 * once every recipe port has a matching item queued AND the output
 * edge is active, one item is consumed from each port and a single
 * new item (outputType) is sent out.
 *
 * Output-edge availability is checked BEFORE any input is consumed —
 * a complete-but-blocked recipe just waits (items stay queued in node
 * state, not lost), rather than destroying inputs with no
 * compensating output.
 */
const onItemArrival: OnItemArrival = (item, node, state, outputEdges, arrivalEdge, makeItemId) => {
  const capacity = typeof node.config.bufferCapacity === 'number' ? node.config.bufferCapacity : Infinity;
  const buffers: Buffers = { ...(state.buffers as Buffers | undefined) };
  const port = arrivalEdge.targetPort;
  const queue = [...(buffers[port] ?? [])];

  if (queue.length >= capacity) {
    return { newState: state, actions: [], accepted: false };
  }

  queue.push(item);
  buffers[port] = queue;

  const recipe = (node.config.recipe ?? {}) as Record<number, string>;
  const recipePorts = Object.keys(recipe).map(Number);
  const canFire =
    recipePorts.length > 0 &&
    recipePorts.every((p) => {
      const q = buffers[p];
      return !!q && q.length > 0 && q[0]!.type === recipe[p];
    });

  if (!canFire) {
    return { newState: { ...state, buffers }, actions: [] };
  }

  const outputPort = typeof node.config.outputPort === 'number' ? node.config.outputPort : 0;
  const outEdge = outputEdges.find((e) => e.sourcePort === outputPort && e.active);
  if (!outEdge) {
    // Recipe complete but nowhere to send it — hold everything queued.
    return { newState: { ...state, buffers }, actions: [] };
  }

  for (const p of recipePorts) {
    buffers[p] = (buffers[p] ?? []).slice(1);
  }
  const outputType = typeof node.config.outputType === 'string' ? node.config.outputType : 'item';
  const newItem: Item = { id: makeItemId(), type: outputType };

  return {
    newState: { ...state, buffers },
    actions: [{ type: 'send', edgeId: outEdge.id, item: newItem }],
  };
};

export const mixerBehavior: NodeBehavior = { onItemArrival };
