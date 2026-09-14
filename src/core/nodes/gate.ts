import type { EdgeDef, NodeDef, NodeId } from '../types';
import type { RuntimeState } from '../NodeRuntimeState';
import type { NodeBehavior, OnItemArrival } from './contract';

/**
 * Gate (design doc §4.8, 2026-09-09 node-design session) — 1 input,
 * 1 output, no storage of its own, no built-in awareness of anything
 * around it. The same node kind serves as either an in-gate or an
 * out-gate purely by virtue of where it's wired, not a separate
 * config or kind.
 *
 * Open (`state.open === true`) — an arriving item is forwarded
 * immediately onto the first active, non-signal output edge.
 * Closed (the default, `state.open` unset or false) — the arrival is
 * refused (`accepted: false`), reusing the existing general
 * backpressure mechanism from Milestone 3 rather than needing new
 * bounce-back path geometry; the item just waits upstream and retries
 * next tick. A literal reverse-travel visual was discussed as a later
 * Skin/Floor polish item, not required for correct behavior.
 *
 * BREAKING CHANGE (2026-09-11, Command/Counter/Time extension):
 * `state.open` is no longer ever written by a Sensor directly — only
 * a Command node's Latch duration mode writes it now (command.ts);
 * Command is the sole actuator in the system, Sensor purely senses and
 * emits. Any project with a pre-existing live Sensor->Gate signal wire
 * gets it spliced through an auto-inserted Command node at load time
 * (see persistence.ts's migrateSensorGateToCommand) so behavior is
 * preserved exactly. `hasSignalInput` below now checks for a Command
 * source by default (was Sensor) to match.
 *
 * Pulse mode (new, Command's Pulse duration mode targeting a Gate —
 * confirmed count-based over duration/tick-based: "let exactly one
 * item through then close"): a `'pulse'` Action bumps `state.pulseSeq`
 * (SimEngine's applyActions) instead of writing `open`. This hook
 * tracks whether that bump has been "consumed" yet
 * (`lastConsumedPulseSeq`) — a pending, unconsumed pulse ALSO opens the
 * gate for exactly the next arrival, independent of (and additive
 * with) the Latch `open` flag above: whichever arrives first, an
 * item is let through and the pulse is marked consumed right then, not
 * on a timer. This correctly implements "wait indefinitely for the
 * next item once armed, then close" — a pulse that arrives while
 * nothing is currently in flight simply stays armed until an item
 * eventually shows up, exactly like a real momentary-open valve rather
 * than a fixed time window that could miss a delayed item entirely.
 */
const onItemArrival: OnItemArrival = (item, _node, state, outputEdges) => {
  const latchOpen = state.open === true;
  const pulseSeq = typeof state.pulseSeq === 'number' ? state.pulseSeq : 0;
  const lastConsumedPulseSeq = typeof state.lastConsumedPulseSeq === 'number' ? state.lastConsumedPulseSeq : 0;
  const pulsePending = pulseSeq > lastConsumedPulseSeq;

  if (!latchOpen && !pulsePending) {
    return { newState: state, actions: [], accepted: false };
  }

  const target = outputEdges.find((e) => e.active && e.edgeKind !== 'signal');
  if (!target) {
    return { newState: state, actions: [], accepted: false };
  }

  const forwardedCount = typeof state.forwardedCount === 'number' ? state.forwardedCount : 0;
  const newState: RuntimeState = { ...state, forwardedCount: forwardedCount + 1 };
  // Consume exactly one pulse per item let through — a second item
  // arriving before a fresh pulse must go back to needing latchOpen,
  // not ride the same already-spent pulse through again.
  if (pulsePending) newState.lastConsumedPulseSeq = pulseSeq;

  return {
    newState,
    actions: [{ type: 'forward', edgeId: target.id, item }],
  };
};

export const gateBehavior: NodeBehavior = { onItemArrival };

/** Pure helper (no SimEngine/GraphModel dependency — just plain data
 * in, boolean out) for a properties-panel/placement check: true once
 * at least one active `edgeKind: 'signal'` edge targets `gateId` FROM
 * a node of `requiredSourceKind`. Not called from gate.ts's own
 * onItemArrival — correctness doesn't depend on it (see the doc
 * comment above), it's only for surfacing the "this node can never be
 * driven" case to a person building the graph.
 *
 * `requiredSourceKind` defaults to `'command'` (2026-09-11 — was
 * `'sensor'` until the breaking change above: Gate's own call site,
 * PropertiesPanel's GateFields, now relies on this default rather than
 * passing an explicit kind, since Command is the only thing that may
 * ever drive a Gate any more). Reused with an explicit override by
 * PropertiesPanel's CommandFields (still checks for an incoming
 * `'sensor'`, unchanged — a Command's OWN input is still Sensor-fed)
 * and SourceFields/CounterFields (`'command'`, same as this new
 * default, just passed explicitly since they predate it) — the
 * `gateId` param name is a holdover from when Gate was the only kind
 * this mattered for, but the check itself was always generic over any
 * target node id and, now, over what kind is allowed to drive it. */
export function hasSignalInput(
  gateId: NodeId,
  allEdges: EdgeDef[],
  allNodes: NodeDef[],
  requiredSourceKind: NodeDef['kind'] = 'command',
): boolean {
  const nodesById = new Map(allNodes.map((n) => [n.id, n] as const));
  return allEdges.some(
    (e) =>
      e.target === gateId && e.active && e.edgeKind === 'signal' && nodesById.get(e.source)?.kind === requiredSourceKind,
  );
}
