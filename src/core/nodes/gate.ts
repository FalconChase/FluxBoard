import type { EdgeDef, NodeDef, NodeId } from '../types';
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
 * `state.open` is never set by Gate itself — only a connected
 * Sensor's `evaluateSignals` hook (sensor.ts) ever writes it, via a
 * `'signal'` Action resolved by SimEngine. That's what makes the
 * Sensor connection mandatory "by construction": a Gate with zero
 * Sensor connections has nothing that could ever flip `open` away
 * from its default `false`, so it can never open — see
 * `hasSignalInput` below for a pure helper a future UI can use to
 * flag that case explicitly (silent-rejection style, design doc §4.6)
 * rather than relying on this rather implicit fact alone.
 */
const onItemArrival: OnItemArrival = (item, _node, state, outputEdges) => {
  const open = state.open === true;
  if (!open) {
    return { newState: state, actions: [], accepted: false };
  }

  const target = outputEdges.find((e) => e.active && e.edgeKind !== 'signal');
  if (!target) {
    return { newState: state, actions: [], accepted: false };
  }

  const forwardedCount = typeof state.forwardedCount === 'number' ? state.forwardedCount : 0;
  return {
    newState: { ...state, forwardedCount: forwardedCount + 1 },
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
 * `requiredSourceKind` defaults to `'sensor'`, so Gate's own call site
 * (App.tsx's GateFields, unchanged) keeps its original meaning exactly.
 * Reused with an explicit override by PropertiesPanel's SourceFields
 * (2026-09-10) and CommandFields (2026-09-10, Command feature): a
 * Source's signal-gated input must be fed by a `'command'` node, never
 * a `'sensor'` directly (Falcon: "sensor node only senses and triggers
 * signal[,] the command node is the one has command on it") — the
 * `gateId` param name is a holdover from when Gate was the only kind
 * this mattered for, but the check itself was always generic over any
 * target node id and, now, over what kind is allowed to drive it. */
export function hasSignalInput(
  gateId: NodeId,
  allEdges: EdgeDef[],
  allNodes: NodeDef[],
  requiredSourceKind: NodeDef['kind'] = 'sensor',
): boolean {
  const nodesById = new Map(allNodes.map((n) => [n.id, n] as const));
  return allEdges.some(
    (e) =>
      e.target === gateId && e.active && e.edgeKind === 'signal' && nodesById.get(e.source)?.kind === requiredSourceKind,
  );
}
