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
 *  - source: bumped 0 -> 1 inputs (2026-09-10 — Falcon: "i want to add
 *    additional feature to source node like it will deactivate by
 *    using sensor nodes condition"): source.ts still has no
 *    onItemArrival at all, so this one new input slot is NEVER a real
 *    physical item port — it exists purely for a Command node's
 *    signal (SimEngine's `sourceCanSpawnThisTick` reads `state.open`
 *    the exact same generic way Gate does). App.tsx's own
 *    `isSourceSignalTarget` guard is what actually keeps a real item
 *    edge — or a signal edge from anything but a Command — from ever
 *    landing here (this numeric cap alone can't tell edge kinds or
 *    source kinds apart, same limitation gate's coarse `maxInputs: 2`
 *    already accepted) — this bump just makes room for the one
 *    legitimate Command->Source signal edge the feature needs.
 *  - counter: bumped 1 -> 2 inputs (2026-09-10, same-day Command
 *    follow-up — Falcon, after asking why a Sensor+Command pair
 *    stopped a Source: "counter node is just like a checkpoint between
 *    path[,] i want it to count only role and can manually be
 *    resetable or by a command when docked with command"): the
 *    original 1 was the real item input (a Counter has no
 *    onItemArrival branching by port, so more would be ambiguous, same
 *    reasoning as gate's single real input slot); the 2nd is room for
 *    a Command node's reset signal, the exact same "bump the numeric
 *    cap, let App.tsx's kind-aware guard do the real restricting"
 *    pattern source's own 0 -> 1 bump above already used. 2 outputs
 *    unchanged (1 real item out + 1 optional copper "watch" output to
 *    a Sensor, exactly buffer's "2 real + 1 copper" pattern minus the
 *    optional-overflow slot buffer alone has).
 *  - command (2026-09-10 follow-up — Falcon: "the command node is the
 *    one has command on it ... it is compatible only with wire and
 *    dockable to source node and sensor node"): 1 input (a signal
 *    from its ONE Sensor, Falcon's pick — "one-to-one, like Gate" over
 *    allowing several), 1 output (a signal to whatever it commands —
 *    originally its one Source, extended the same session to also
 *    cover its one Counter, see the dock-pair note below). Zero
 *    physical ports at all — command.ts has no onItemArrival, same
 *    conservation rationale as Sensor's own fully-copper ports; unlike
 *    Sensor, Command's real restriction (which kinds it may pair
 *    with) is tight enough to also give it a real numeric cap here,
 *    not just the compatibility-check-only treatment Sensor needed.
 *  - transform (2026-09-10 — "now i want to introduce the transform
 *    node"): 1 real item input, 1 real item output, confirmed —
 *    transform.ts's onItemArrival only ever looks up ONE output edge
 *    (same single-target-lookup shape as Mixer/Merger's single output
 *    above), and it's a plain relabel-then-forward with no recipe
 *    buffering that would need more than one arriving stream. No
 *    signal/copper ports at all — it's an ordinary flow node, not part
 *    of the Sensor/Gate/Command trigger system, so it gets no dock
 *    compatibility below either (place a wire, same as Distributor/
 *    Sorter/Mixer).
 */
export const NATURAL_PORT_CAPACITY: Record<NodeKind, PortCapacity> = {
  source: { maxInputs: 1, maxOutputs: 1 },
  sink: { maxOutputs: 0 },
  distributor: {},
  merger: { maxOutputs: 1 },
  sorter: {},
  mixer: { maxOutputs: 1 },
  buffer: { maxOutputs: 3 },
  gate: { maxInputs: 2, maxOutputs: 2 },
  sensor: {},
  counter: { maxInputs: 2, maxOutputs: 2 },
  command: { maxInputs: 1, maxOutputs: 1 },
  transform: { maxInputs: 1, maxOutputs: 1 },
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
 * direction either). Three pairs originally:
 *  - gate <-> buffer (the original pair)
 *  - buffer <-> buffer ("silo-silo" — two Silos docked together share
 *    an instant huge-flowRate item edge, same mechanism as gate<->
 *    buffer, so a docked pair effectively acts like one bigger buffer
 *    chain)
 *  - buffer <-> sensor ("silo-sensor" — NOT an item edge at all; the
 *    dock is a copper/signal connection so the Sensor auto-watches
 *    that Silo, App.tsx's handleDockNodes gives this pair edgeKind:
 *    'signal' rather than 'dock' for exactly that reason)
 * Extended 2026-09-10 (Falcon, confirming Counter's dock pairs via
 * AskUserQuestion: "Source, Sensor, and Buffer/Silo too") with three
 * more:
 *  - counter <-> source (a real item dock, same "huge flowRate seam"
 *    mechanism as gate<->buffer — a Source's spawned item can dock
 *    straight into a Counter tallying everything it produces)
 *  - counter <-> buffer (also a real item dock — same "one real in,
 *    one real out, no per-port routing" shape as Gate, so App.tsx's
 *    handleDockNodes reuses Gate's own already-wired-side direction
 *    heuristic for this pair too, not the plain stationary/dragged
 *    default buffer<->buffer uses)
 *  - counter <-> sensor ("counter-sensor" — NOT an item edge, exactly
 *    like silo-sensor above: the Sensor auto-watches the Counter's
 *    `count` instead of a Silo's `queue.length`. App.tsx's
 *    handleDockNodes already generalizes to this pair for free, since
 *    its silo/sensor direction logic never actually checked "buffer"
 *    specifically, only "the non-Sensor side")
 * Extended again 2026-09-10, same session, for the new Command node
 * (Falcon: "it is compatible only with wire and dockable to source
 * node and sensor node"):
 *  - command <-> sensor — NOT an item edge, but the OPPOSITE direction
 *    convention from counter<->sensor/silo<->sensor above: those are
 *    "watched" pairs (the non-Sensor side is the edge SOURCE, since
 *    it's the thing being read); this is a "commanded" pair, so the
 *    SENSOR is always the edge source and Command always the target —
 *    the same direction Sensor already has wiring to Gate, just now
 *    also reachable by docking.
 *  - command <-> source — also not an item edge (Source has no real
 *    physical input at all — see its own maxInputs note above);
 *    Command is always the edge source, Source always the target, no
 *    ambiguity to read either way.
 * Extended again 2026-09-10, same session, for Command's new reset
 * relationship with Counter (Falcon: "i want it to count only role and
 * can manually be resetable or by a command when docked with command"):
 *  - command <-> counter — also not an item edge (this fills Counter's
 *    NEW signal-only input slot, see its maxInputs note above, never
 *    the real item one already in use for ordinary item producers).
 *    Same direction as command <-> source: Command is always the edge
 *    source, Counter always the target — no physical-side ambiguity to
 *    read the way gate<->buffer/counter<->buffer need, since this dock
 *    never touches Counter's real item ports at all.
 * Every other pairing is explicitly left for a later discussion, same
 * "closed, easy-to-extend list" deferral the copper-path rule already
 * used for anything beyond Sensor/Gate/Buffer/Counter/Source/Command —
 * see isCopperCompatible in App.tsx for that sibling rule. Lives here
 * (not App.tsx) because FluxCanvas.tsx also needs it, to know which
 * nearby node counts as a valid drag-to-snap target while a node is
 * mid-drag, not just at the moment a dock is created. */
export function isDockCompatible(kindA: NodeKind, kindB: NodeKind): boolean {
  if (kindA === 'gate' && kindB === 'buffer') return true;
  if (kindA === 'buffer' && kindB === 'gate') return true;
  if (kindA === 'buffer' && kindB === 'buffer') return true;
  if (kindA === 'buffer' && kindB === 'sensor') return true;
  if (kindA === 'sensor' && kindB === 'buffer') return true;
  if (kindA === 'counter' && kindB === 'source') return true;
  if (kindA === 'source' && kindB === 'counter') return true;
  if (kindA === 'counter' && kindB === 'buffer') return true;
  if (kindA === 'buffer' && kindB === 'counter') return true;
  if (kindA === 'counter' && kindB === 'sensor') return true;
  if (kindA === 'sensor' && kindB === 'counter') return true;
  if (kindA === 'command' && kindB === 'sensor') return true;
  if (kindA === 'sensor' && kindB === 'command') return true;
  if (kindA === 'command' && kindB === 'source') return true;
  if (kindA === 'source' && kindB === 'command') return true;
  if (kindA === 'command' && kindB === 'counter') return true;
  if (kindA === 'counter' && kindB === 'command') return true;
  return false;
}
