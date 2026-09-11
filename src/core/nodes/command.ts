import type { NodeBehavior, PerTickHook } from './contract';

/**
 * Command (design doc §4.8 follow-up, 2026-09-10 — Falcon: "sensor
 * node only senses and triggers signal[,] the command node is the
 * one has command on it ... if a command node receives a signal it
 * will do a command to the node attached to it say source node ...
 * the command node turn[s] ... deactivates or activates the source
 * node whenever it receives signal"): a pure signal RELAY, sitting
 * between a Sensor and a Source the exact same place Gate sits
 * between a Sensor and item flow — Sensor only ever senses+signals,
 * it never touches a Source directly (see SimEngine's
 * sourceCanSpawnThisTick / App.tsx's isSourceSignalTarget, both
 * updated the same day this file was added to require the edge's
 * SOURCE be a 'command' node, not a 'sensor').
 *
 * Mechanically dead simple, and deliberately so: `state.open` here is
 * SET the exact same generic way Gate's is (SimEngine's applyActions
 * writes it for ANY signal edge's target, Command included, whenever
 * a Sensor's evaluateSignals fires onto an edge that targets this
 * node) — reusing that existing plumbing instead of inventing a
 * dedicated "command" Action kind. This hook is the other half:
 * every tick, unconditionally (level-based, same "re-evaluate and
 * re-broadcast" philosophy as Sensor's own evaluateSignals, not a
 * one-shot edge-triggered pulse), it reads that last-received value
 * back out and re-emits it as a fresh `'signal'` Action onto its own
 * outgoing edge to a Source.
 *
 * Default, before this Command has ever received anything (freshly
 * placed, or its Sensor hasn't ticked yet) — Falcon confirmed via
 * AskUserQuestion: "no effect until commanded". `state.open !== false`
 * mirrors Source's own default-open convention exactly (undefined
 * reads as open/true, only an explicit `false` closes it), so a
 * Command with nothing feeding it in yet leaves its Source spawning
 * normally rather than silently blocking it.
 *
 * Docking/wiring a Command TO a Sensor has no effect ON that Sensor
 * (Falcon: "command can be docked to a sensor node but it wont do
 * anything to sensor node") — that's not a special case handled here,
 * it falls straight out of `outputEdges` only ever containing edges
 * where THIS node is the source: with correct docking direction
 * (App.tsx's handleDockNodes always makes the Sensor the edge's
 * SOURCE into a Command, never the reverse — same convention Sensor
 * already has with Gate), a Command's outputEdges only ever reach
 * toward whatever it's actually commanding (a Source), never back
 * toward the Sensor that feeds it.
 */
const relaySignal: PerTickHook = (_node, state, outputEdges) => {
  const commanded = state.open !== false;
  const outs = outputEdges.filter((e) => e.active && e.edgeKind === 'signal');
  const actions = outs.map((e) => ({ type: 'signal' as const, edgeId: e.id, value: commanded }));
  return { newState: state, actions };
};

export const commandBehavior: NodeBehavior = { evaluateSignals: relaySignal };
