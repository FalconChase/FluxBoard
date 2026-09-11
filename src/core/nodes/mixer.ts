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
 *
 * Output lookup (2026-09-10, "the ports are named according to
 * compass"): mixer is capped to exactly 1 output (portCapacity.ts) —
 * PropertiesPanel's SingleOutputSidePicker is the ONLY thing that ever
 * moves it, and does so by directly reassigning the edge's own
 * physical anchor. A separate `config.outputPort` guess, matched by
 * sourcePort, used to exist alongside that (and could silently drift
 * out of sync with wherever the picker actually put the edge — recipe
 * complete, nothing ever sent, no error). Since there is only ever one
 * real output edge to begin with, this just takes "the" active one
 * directly instead, same lookup merger/gate already use for their own
 * single-output cases.
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

  const outEdge = outputEdges.find((e) => e.active);
  if (!outEdge) {
    // Recipe complete but nowhere to send it — hold everything queued.
    return { newState: { ...state, buffers }, actions: [] };
  }

  for (const p of recipePorts) {
    buffers[p] = (buffers[p] ?? []).slice(1);
  }
  const outputType = typeof node.config.outputType === 'string' ? node.config.outputType : 'item';
  const newItem: Item = { id: makeItemId(), type: outputType };
  const producedCount = typeof state.producedCount === 'number' ? state.producedCount : 0;

  return {
    newState: { ...state, buffers, producedCount: producedCount + 1 },
    actions: [{ type: 'send', edgeId: outEdge.id, item: newItem }],
  };
};

export const mixerBehavior: NodeBehavior = { onItemArrival };
