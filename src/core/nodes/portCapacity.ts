import type { NodeKind } from '../types';

/**
 * Per-kind "nature" wiring limits (Falcon, 2026-09-03: "the source node
 * should only have single output side... no need to rotate the node
 * since the user can just set or toggle which side to output"). These
 * are HARD caps enforced at wire-creation time (App.tsx's
 * handleCreateEdge, same rejection style as FloorLayout's 8-socket
 * cap) — not just a suggested default.
 *
 * Values are read directly off what each kind's own onItemArrival/
 * trySpawn handler actually does, not invented separately:
 *  - source: `trySpawn` has no onItemArrival at all (an arriving item
 *    would be silently lost — item-conservation-breaking), and only
 *    ever sends to ONE edge ("v1: single-output source" per
 *    source.ts's own comment). So 0 inputs, 1 output.
 *  - sink: has no output action at all — any output wire would never
 *    fire. 0 outputs. Inputs are left uncapped (nothing about a sink's
 *    behavior requires exactly one producer).
 *  - mixer: reads `node.config.outputPort` and looks up exactly ONE
 *    matching output edge — extra output edges would never be used.
 *    1 output. Inputs are left uncapped (recipes need one arrival per
 *    recipe port, by design more than one input).
 *  - buffer: a main output (port 0) plus an OPTIONAL overflow output
 *    (port 1, only used with overflowPolicy: 'divert') — 2 outputs
 *    covers both without tying the cap to config state that can
 *    change after wires already exist. Inputs uncapped.
 *  - distributor/sorter: both exist specifically to route one arriving
 *    stream across MANY output edges — no kind-specific cap on either
 *    side beyond the general 8-connections-per-node structural limit
 *    (FloorLayout's anchor system).
 *  - merger (Falcon, 2026-09-03: "the opposite of distributor"): the
 *    mirror image — MANY input edges merge into exactly ONE output
 *    edge (`merger.ts`'s `onItemArrival` looks up a single active
 *    output edge, same as source/mixer). 1 output, inputs uncapped.
 *
 * `undefined` = no kind-specific cap; only the general 8-socket
 * structural limit applies.
 */
export interface PortCapacity {
  maxInputs?: number;
  maxOutputs?: number;
}

/**
 * gate/sensor additions (design doc §4.8, 2026-09-09 node-design
 * session; revised 2026-09-09 for the copper-path wiring rule, design
 * doc §5.5):
 *  - gate: 1 physical item in + 1 mandatory signal-in from its Sensor
 *    = 2 inputs total (this cap doesn't yet distinguish edge KIND,
 *    same coarseness buffer's "2 outputs covers both main+overflow"
 *    cap already accepts). 1 physical output plus an optional copper
 *    output (a Gate may itself originate a copper path to another
 *    Sensor-side node) = 2 outputs.
 *  - sensor: has no onItemArrival at all -- a wired physical item
 *    input would be silently lost, same item-conservation rationale
 *    as source's 0 inputs above. But a Sensor's PORTS are now
 *    copper-path-only rather than input-less: the real restriction
 *    (copper wiring is the only thing allowed to touch a Sensor's
 *    ports at all, physical items included) is enforced by the
 *    node-kind compatibility check at wire-creation time
 *    (App.tsx's isCopperCompatible), not by this coarse numeric cap.
 *    Left fully uncapped here so legitimate copper in/out edges
 *    (Sensor<->Sensor, Sensor<->Gate, and now Sensor<->Buffer/Silo)
 *    are never blocked by a stale maxInputs: 0 left over from before
 *    copper existed -- a Sensor can watch several nodes at once
 *    (design doc §5.7), so both sides stay uncapped.
 *  - buffer: bumped 2 -> 3 (design doc §5.7, 2026-09-09 follow-up —
 *    "copper wire SHOULD now [be] compatible with silo node"): the
 *    original 2 covered main(port 0) + optional overflow(port 1)
 *    real item outputs; the 3rd slot is room for an optional copper
 *    "watch" output to a Sensor (the Sensor is the edge's TARGET —
 *    see sensor.ts's watchedNodeIds/evaluateSignals — so from the
 *    Buffer's own side this is just one more ordinary output edge).
 *    Not kind-distinguished any more than the original 2 were.
 */
export const NATURAL_PORT_CAPACITY: Record<NodeKind, PortCapacity> = {
  source: { maxInputs: 0, maxOutputs: 1 },
  sink: { maxOutputs: 0 },
  distributor: {},
  merger: { maxOutputs: 1 },
  sorter: {},
  mixer: { maxOutputs: 1 },
  buffer: { maxOutputs: 3 },
  gate: { maxInputs: 2, maxOutputs: 2 },
  sensor: {},
};

export function getPortCapacity(kind: NodeKind): PortCapacity {
  return NATURAL_PORT_CAPACITY[kind];
}

/**
 * Docking (design doc §5.6, 2026-09-09 follow-up — "allow docking...
 * attaching the node without needing to add a path in between... it
 * will act and behave like a single unit"; extended §5.7, 2026-09-09
 * follow-up — "the dockable/compatible node pairs for dock should be
 * silo-silo, silo-gates, silo-sensor"): which node-kind PAIRS may be
 * drag-to-snap docked, order-agnostic (a Gate can be wired as either a
 * Silo's in-gate or its out-gate; a Silo-Silo pair has no inherent
 * direction either). Three pairs total:
 *  - gate <-> buffer (the original pair)
 *  - buffer <-> buffer ("silo-silo" — two Silos docked together share
 *    an instant huge-flowRate item edge, same mechanism as gate<->
 *    buffer, so a docked pair effectively acts like one bigger buffer
 *    chain)
 *  - buffer <-> sensor ("silo-sensor" — NOT an item edge at all; the
 *    dock is a copper/signal connection so the Sensor auto-watches
 *    that Silo, App.tsx's handleDockNodes gives this pair edgeKind:
 *    'signal' rather than 'dock' for exactly that reason)
 * Every other pairing is explicitly left for a later discussion, same
 * "closed, easy-to-extend list" deferral the copper-path rule already
 * used for anything beyond Sensor/Gate/Buffer — see isCopperCompatible
 * in App.tsx for that sibling rule. Lives here (not App.tsx) because
 * FluxCanvas.tsx also needs it, to know which nearby node counts as a
 * valid drag-to-snap target while a node is mid-drag, not just at the
 * moment a dock is created. */
export function isDockCompatible(kindA: NodeKind, kindB: NodeKind): boolean {
  if (kindA === 'gate' && kindB === 'buffer') return true;
  if (kindA === 'buffer' && kindB === 'gate') return true;
  if (kindA === 'buffer' && kindB === 'buffer') return true;
  if (kindA === 'buffer' && kindB === 'sensor') return true;
  if (kindA === 'sensor' && kindB === 'buffer') return true;
  return false;
}
