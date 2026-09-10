import type { Item, NodeDef, EdgeDef, NodeId } from '../types';
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
 *
 * A third action kind, 'signal' (design doc §5.5, §4.8, 2026-09-09),
 * is unrelated to item movement — it's how a Sensor's per-tick
 * `evaluateSignals` hook (below) drives a connected Gate. `edgeId`
 * must reference a `edgeKind: 'signal'` edge; SimEngine resolves it to
 * that edge's TARGET node and writes `value` straight into the
 * target's own runtime state as `open` — no in-flight item, no
 * progress, no `delivered`/`onItemArrival` call on the target at all.
 */

export type Action =
  | { type: 'send'; edgeId: string; item: Item }
  | { type: 'forward'; edgeId: string; item: Item }
  | { type: 'consume'; item: Item }
  | { type: 'signal'; edgeId: string; value: boolean };

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
 * an arrival: source's `trySpawn` (0 inputs, design doc §4.2),
 * buffer's `tryDrain` (continuous opportunistic drain, design doc
 * §4.2 buffer/overflow), and sensor's `evaluateSignals` (design doc
 * §4.8 — reads a condition and fires a signal, below).
 *
 * `ctx` (added for `evaluateSignals`, 2026-09-09) is a read-only
 * window onto the REST of the graph/runtime — every other hook so far
 * only ever needed its own node/state, but a Sensor's condition reads
 * some OTHER node's live state (e.g. a watched Silo's queue length),
 * which nothing in the original 5-arg signature could reach. Existing
 * hooks (source.trySpawn, buffer.tryDrain) simply don't declare this
 * 6th parameter — a shorter-parameter-list function value is still
 * assignable to this type, so nothing about them needed to change.
 * Optional (not just undeclared by the callee) so existing direct
 * calls to a PerTickHook-typed value with only 5 arguments — e.g.
 * nodeRegistry.test.ts's pre-existing buffer.tryDrain calls — keep
 * compiling unchanged; sensor.ts is the only implementation that
 * actually reads it, and every real call SimEngine makes always
 * supplies one.
 */
export interface NodeTickContext {
  getNode: (id: NodeId) => NodeDef | undefined;
  getNodeState: (id: NodeId) => RuntimeState | undefined;
  /** Auto-watch (design doc §5.7, 2026-09-09 follow-up — "the sensor
   * nodes should auto-watch the node it is connected to or docked
   * to"): a Sensor's own incoming edges, so evaluateSignals can derive
   * what to watch from real wiring/docking instead of only the
   * `config.watchNodeId` dropdown — see sensor.ts's watchedNodeIds.
   * Optional for the same back-compat reason `ctx` itself is optional
   * on PerTickHook: existing test-constructed ctx objects (and any
   * future PerTickHook that doesn't need it) don't have to implement
   * this; sensor.ts falls back to config.watchNodeId when it's absent
   * or returns nothing relevant. */
  getInputEdges?: (id: NodeId) => EdgeDef[];
}

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
  ctx?: NodeTickContext,
) => PerTickResult;

/** Back-compat alias used by source.ts / existing callers. */
export type TrySpawnResult = PerTickResult;

export interface NodeBehavior {
  onItemArrival?: OnItemArrival;
  trySpawn?: PerTickHook;
  tryDrain?: PerTickHook;
  /** Sensor only, so far (design doc §4.8) — see PerTickHook's `ctx`
   * doc above. Not item-shaped at all: any `Action`s it returns should
   * be `{ type: 'signal', ... }`, never send/forward/consume. */
  evaluateSignals?: PerTickHook;
}
