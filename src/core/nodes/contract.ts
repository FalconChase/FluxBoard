import type { Item, NodeDef, EdgeDef } from '../types';
import type { RuntimeState } from '../NodeRuntimeState';

/**
 * Shared node function contract (design doc §4.3), extended for
 * milestone 3 (design doc §4.2, §4.6, §7):
 *
 *   onItemArrival(item, node, state, outputEdges, arrivalEdge, makeItemId)
 *     => { newState, actions, accepted? }
 *
 * `accepted` defaults to true. A handler returns `accepted: false` to
 * refuse an arrival this tick (backpressure — buffer full, no output
 * edge available, sorter unmatchedPolicy: 'hold'): the item stays
 * parked on its edge at progress 1 and is retried next tick, with no
 * state or action changes applied.
 *
 * Two `Action` kinds send an item onward:
 *  - 'send'    — a genuinely new item (source spawn, mixer recipe
 *                output). Counted as a `spawned` SimEvent.
 *  - 'forward' — the same logical item continuing onward (distributor
 *                routing, sorter routing, buffer drain). Counted as a
 *                `forwarded` SimEvent, distinct from `spawned` so
 *                conservation accounting (spawned === consumed +
 *                inFlight [+ buffered]) isn't double-counted.
 */

export type Action =
  | { type: 'send'; edgeId: string; item: Item }
  | { type: 'forward'; edgeId: string; item: Item }
  | { type: 'consume'; item: Item };

export interface OnItemArrivalResult {
  newState: RuntimeState;
  actions: Action[];
  /** Defaults to true. false = refuse this arrival, retry next tick. */
  accepted?: boolean;
}

export type OnItemArrival = (
  item: Item,
  node: NodeDef,
  state: RuntimeState,
  outputEdges: EdgeDef[],
  arrivalEdge: EdgeDef,
  makeItemId: () => string,
) => OnItemArrivalResult;

/**
 * Per-tick hook contract, for node kinds that act without waiting for
 * an arrival: source's `trySpawn` (0 inputs, design doc §4.2) and
 * buffer's `tryDrain` (continuous opportunistic drain, design doc
 * §4.2 buffer/overflow).
 */
export interface PerTickResult {
  newState: RuntimeState;
  actions: Action[];
}

export type PerTickHook = (
  node: NodeDef,
  state: RuntimeState,
  outputEdges: EdgeDef[],
  dt: number,
  makeItemId: () => string,
) => PerTickResult;

/** Back-compat alias used by source.ts / existing callers. */
export type TrySpawnResult = PerTickResult;

export interface NodeBehavior {
  onItemArrival?: OnItemArrival;
  trySpawn?: PerTickHook;
  tryDrain?: PerTickHook;
}
