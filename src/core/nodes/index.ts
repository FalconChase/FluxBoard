import type { Item, NodeDef, EdgeDef } from '../types';
import type { RuntimeState } from '../NodeRuntimeState';

/**
 * Shared node function contract (design doc §4.3):
 *
 *   onItemArrival(item, node, state, outputEdges) => { newState, actions }
 *
 * Every node kind (source, distributor, sorter, mixer, buffer, sink)
 * implements this same shape. This file is the registry that
 * SimEngine dispatches to by NodeDef.kind.
 *
 * Milestone 1 implements 'sink' only (consume, no actions). 'source'
 * has 0 inputs so it never receives onItemArrival — it's driven
 * directly by SimEngine's tick via trySpawn instead (see SimEngine.ts).
 * Milestone 3 fills in distributor, sorter, mixer, buffer/overflow.
 */

export type Action =
  | { type: 'send'; edgeId: string; item: Item }
  | { type: 'consume'; item: Item };

export interface OnItemArrivalResult {
  newState: RuntimeState;
  actions: Action[];
}

export type OnItemArrival = (
  item: Item,
  node: NodeDef,
  state: RuntimeState,
  outputEdges: EdgeDef[],
) => OnItemArrivalResult;

export const nodeHandlers: Partial<Record<NodeDef['kind'], OnItemArrival>> = {
  sink: (item, _node, state) => {
    const consumedCount = typeof state.consumedCount === 'number' ? state.consumedCount : 0;
    return {
      newState: { ...state, consumedCount: consumedCount + 1 },
      actions: [{ type: 'consume', item }],
    };
  },
};

/**
 * Source spawn contract — a source has 0 inputs so it doesn't implement
 * onItemArrival; SimEngine calls this once per tick instead (design
 * doc §4.2, §4.3).
 */
export interface TrySpawnResult {
  newState: RuntimeState;
  actions: Action[];
}

export function sourceTrySpawn(
  node: NodeDef,
  state: RuntimeState,
  outputEdges: EdgeDef[],
  dt: number,
  makeItemId: () => string,
): TrySpawnResult {
  const cooldown = typeof node.config.cooldown === 'number' ? node.config.cooldown : 1;
  const itemType = typeof node.config.itemType === 'string' ? node.config.itemType : 'item';
  const cooldownRemaining = typeof state.cooldownRemaining === 'number' ? state.cooldownRemaining : cooldown;

  if (cooldownRemaining > 0) {
    return { newState: { ...state, cooldownRemaining: cooldownRemaining - dt }, actions: [] };
  }

  // v1: single-output source. Picks the first active edge; if none is
  // active/available, the item simply isn't spawned this tick (backs up
  // naturally rather than being lost or force-created).
  const target = outputEdges.find((e) => e.active);
  if (!target) {
    return { newState: state, actions: [] };
  }

  const item: Item = { id: makeItemId(), type: itemType };
  return {
    newState: { ...state, cooldownRemaining: cooldown },
    actions: [{ type: 'send', edgeId: target.id, item }],
  };
}
