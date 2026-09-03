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

export const NATURAL_PORT_CAPACITY: Record<NodeKind, PortCapacity> = {
  source: { maxInputs: 0, maxOutputs: 1 },
  sink: { maxOutputs: 0 },
  distributor: {},
  merger: { maxOutputs: 1 },
  sorter: {},
  mixer: { maxOutputs: 1 },
  buffer: { maxOutputs: 2 },
};

export function getPortCapacity(kind: NodeKind): PortCapacity {
  return NATURAL_PORT_CAPACITY[kind];
}
