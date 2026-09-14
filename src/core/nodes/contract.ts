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
 * is unrelated to item movement — originally how a Sensor's per-tick
 * `evaluateSignals` hook (below) drove a connected Gate directly;
 * as of 2026-09-11's Command/Counter/Time extension, Gate may no
 * longer be a signal edge's target at all except from a Command node
 * (Command is now the sole actuator — see command.ts) — a Sensor still
 * uses this same action to drive a Command, and Command uses it
 * onward for its own Latch duration mode. `edgeId` must reference a
 * `edgeKind: 'signal'` edge; SimEngine resolves it to that edge's
 * TARGET node and writes `value` straight into the target's own
 * runtime state as `open` — no in-flight item, no progress, no
 * `delivered`/`onItemArrival` call on the target at all.
 *
 * A fourth action kind, 'pulse' (2026-09-11, Command's Pulse duration
 * mode), is the one-shot sibling of 'signal': it carries no boolean
 * value at all, just "something happened, once." SimEngine resolves it
 * to the target's runtime state by bumping a `pulseSeq` counter (never
 * writing `open`) — the target's own handler (gate.ts's onItemArrival,
 * source.ts's trySpawn) compares `pulseSeq` against its own
 * `lastConsumedPulseSeq` to detect a still-pending pulse and decide for
 * itself what "consuming" it means (Gate: let exactly one item through
 * before consuming it; Source: force one immediate spawn bypassing
 * cooldown). Never used for a Counter/Time reset target — those still
 * reset off a `'signal'` action's rising edge, unchanged from before
 * this existed (see command.ts's own doc comment for why duration mode
 * doesn't matter for a momentary reset).
 *
 * A fifth action kind, 'resetSignal' (2026-09-11 same-session follow-up
 * — Falcon, after finding a spawn-limited Source could never be reused:
 * "why does the source can never get reused like once it deactivated
 * when limited spawn count all spawned ... even i tried to activate it
 * back manually", confirmed via AskUserQuestion: "Manual button +
 * Command-driven reset"): structurally identical to 'signal' — a level
 * relay, no item, resolved by SimEngine the exact same way — but
 * written into the target's `resetSignal` runtime field instead of
 * `open`. Source is the one existing kind whose `open` field is
 * already spoken for (its own Command-driven activate/deactivate gate,
 * portCapacity.ts's maxInputs note) — reusing 'signal'/`open` for a
 * SECOND, unrelated purpose (resetting `spawnedCount`) on the same
 * field would mean a routine activate/deactivate toggle could also
 * silently reset the spawn tally, and vice versa. A dedicated action
 * kind writing a dedicated field keeps the two fully independent, so a
 * Source can have one Command wired for ongoing activate/deactivate
 * and a SECOND, separate Command (portCapacity.ts's maxInputs bump 1
 * -> 2) wired purely to reset the count, with neither able to step on
 * the other. Only ever emitted by command.ts, only for a Source target
 * whose own `verb` is explicitly set to 'reset' (see its own doc
 * comment) — source.ts's new `onTick` does the rising-edge detection
 * on `resetSignal`, exactly mirroring counter.ts's onTick doing the
 * same thing on `open` (Counter has no competing use for that field,
 * so it never needed this split).
 */

export type Action =
  | { type: 'send'; edgeId: string; item: Item }
  | { type: 'forward'; edgeId: string; item: Item }
  | { type: 'consume'; item: Item }
  | { type: 'signal'; edgeId: string; value: boolean }
  | { type: 'pulse'; edgeId: string }
  | { type: 'resetSignal'; edgeId: string; value: boolean };

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
  /** Added 2026-09-10 (distributor/sorter downstream-capacity check —
   * see `backpressure.ts`'s `targetBufferIsFull`) for the same reason
   * `PerTickHook`'s `ctx` exists: a handler that forwards onto an
   * output edge needs to see the TARGET node's own state (its queue
   * length) to know whether forwarding there is actually safe, and
   * nothing in the original 6-arg signature could reach that.
   * Optional, same back-compat reasoning as `PerTickHook.ctx` — a
   * shorter-parameter-list handler (sink, gate, buffer's own
   * onItemArrival, every existing direct call in nodeRegistry.test.ts)
   * is still assignable to this type unchanged; only a handler that
   * actually forwards onto an edge and cares about this needs to
   * declare it. */
  ctx?: NodeTickContext,
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
  /** Counter only, so far (2026-09-10) — runs every tick
   * UNCONDITIONALLY, regardless of whether anything arrived or any
   * other hook fired this tick, for housekeeping that can't wait on
   * the next item to check itself. Counter's own use: PropertiesPanel
   * has no direct line to NodeRuntimeStateStore (config is the only
   * channel any Fields component ever writes through — see
   * PropertiesPanel.tsx), so its "Reset count" button bumps
   * `config.resetSeq` as an ordinary config write instead of opening a
   * new one; this hook is what actually notices that bump and zeroes
   * `state.count`, checked every tick (not just lazily on the node's
   * next arrival) so the reset takes effect even while nothing is
   * currently flowing through it — matters when a Sensor is watching
   * this Counter to gate a Source, where waiting for "the next
   * arrival" to apply a reset could mean waiting forever (see
   * counter.ts's own onTick doc comment). Distinct from trySpawn/
   * tryDrain/evaluateSignals (all already unconditional-per-tick too)
   * only in NAME, so each of those keeps describing one specific role
   * rather than growing a second unrelated meaning — nothing stops a
   * future kind reusing this same slot for its own per-tick,
   * not-item-shaped bookkeeping. */
  onTick?: PerTickHook;
}
