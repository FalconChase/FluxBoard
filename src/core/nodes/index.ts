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
 * TODO (Milestone 1): implement 'source' (spawns on a timer — really
 * driven by SimEngine's tick rather than onItemArrival) and 'sink'
 * (consume, no actions) only. TODO (Milestone 3): distributor, sorter,
 * mixer, buffer/overflow.
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
  // sink: consume, no actions — first thing to implement in Milestone 1.
};
