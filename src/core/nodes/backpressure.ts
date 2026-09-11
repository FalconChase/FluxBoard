import type { Item } from '../types';
import type { NodeTickContext } from './contract';

/**
 * Shared downstream-capacity check (design doc §5.8, originally
 * 2026-09-09 — Falcon, testing a docked Silo chain: "only the last
 * silo gets filled then the rest never get filled no matter how many
 * items already passed through"; extended 2026-09-10 — Falcon: "the
 * distributor node keeps accepting items even nowhere to be distribute
 * direction for like it simply accepts endlessly").
 *
 * Originally lived only inside buffer.ts's own `tryDrain`, since that
 * was the first place the gap showed up. The SAME gap turned out to
 * exist in every OTHER node kind that forwards an item onto a chosen
 * output edge without first checking whether the edge's TARGET can
 * actually take it — distributor being the next one Falcon actually
 * hit (see distributor.ts), sorter has the identical shape (flagged,
 * not yet fixed — see sorter.ts's own comment). Pulled out to one
 * shared place so every caller agrees on exactly what "the target has
 * no room" means, rather than each node kind re-deriving its own
 * slightly-different definition.
 *
 * Only buffer targets are checked — a buffer/Silo is the one node
 * kind with a checkable "capacity" concept today; every other target
 * kind (sink, gate, mixer, sorter, ...) keeps its original eager
 * behavior unchanged, same as before this was pulled out. Uncapped
 * (`capacity` left as Infinity) never blocks.
 */
export function targetBufferIsFull(edge: { target: string }, ctx: NodeTickContext | undefined): boolean {
  const targetNode = ctx?.getNode(edge.target);
  if (targetNode?.kind !== 'buffer') return false;
  const targetState = ctx?.getNodeState(edge.target);
  const targetQueue = (targetState?.queue as Item[] | undefined) ?? [];
  const targetCapacity = typeof targetNode.config.capacity === 'number' ? targetNode.config.capacity : Infinity;
  return targetQueue.length >= targetCapacity;
}
