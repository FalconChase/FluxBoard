import type { Item } from '../types';
import type { NodeBehavior, OnItemArrival, PerTickHook } from './contract';
import { targetBufferIsFull } from './backpressure';

/**
 * Counter (design doc §4.8/§5.7 follow-up, 2026-09-10 — Falcon: "i
 * want to add additional feature to source node like it will
 * deactivate by using sensor nodes condition like say a new counter
 * node this node only acts as a counter like it only counts what pass
 * to it unlike buffer/silo that stores items this one just counts
 * what passes or whatever pass to it. this is compatible to be docked
 * with sensor and source node, this node only has one input port and
 * one output port and the rest can be docking port/wire port"): 1
 * real item input, 1 real item output, no storage of its own — every
 * arriving item is immediately forwarded onward, exactly like Gate
 * while open, except a Counter never refuses on its own account; it
 * only ever refuses because the DOWNSTREAM target has no room (the
 * same `targetBufferIsFull` check distributor.ts/buffer.ts already
 * use — see backpressure.ts). `state.count` only increments on an
 * arrival that's actually ACCEPTED (forwarded) this tick, never one
 * that gets parked for retry, so a jammed downstream never double-
 * counts the same physical item once it finally goes through.
 *
 * Not a routing/logic node on its own — it exists to be WATCHED: a
 * Sensor docked or wired to a Counter (portCapacity.ts's
 * isDockCompatible / App.tsx's isCopperCompatible, both extended
 * 2026-09-10) reads `count` as a metric (sensor.ts's readMetric),
 * exactly the same shape a Sensor already uses to watch a Buffer's
 * `queue.length`. That Sensor can then drive a Gate, OR — new as of
 * this same feature — a Source's own signal-gated input directly (see
 * SimEngine's `sourceCanSpawnThisTick`), closing the loop Falcon
 * described: deactivate a Source "by using sensor node's condition
 * ... say a new counter node."
 *
 * The live count itself is never surfaced anywhere in this file or in
 * PropertiesPanel — it's already the canvas badge (nodeSkin.ts's
 * getBadgeCount, the same live-runtime-state badge Buffer's queue
 * length already uses), so there's nothing to duplicate.
 */
const onItemArrival: OnItemArrival = (item, _node, state, outputEdges, _arrivalEdge, _makeItemId, ctx) => {
  const target = outputEdges.find((e) => e.active && e.edgeKind !== 'signal');
  if (!target) {
    return { newState: state, actions: [], accepted: false };
  }
  if (targetBufferIsFull(target, ctx)) {
    return { newState: state, actions: [], accepted: false };
  }

  const count = typeof state.count === 'number' ? state.count : 0;
  return {
    newState: { ...state, count: count + 1 },
    actions: [{ type: 'forward', edgeId: target.id, item }],
  };
};

/**
 * Reset (Falcon confirmed "resettable" over the AskUserQuestion
 * options): runs every tick, not just on arrival — see
 * NodeBehavior.onTick's own doc comment in contract.ts for the full
 * reasoning, in short: a Counter gating a Source through a Sensor can
 * otherwise deadlock, since no new arrival would happen until the
 * reset is seen, but the reset was only ever going to be seen ON a
 * new arrival. PropertiesPanel's "Reset count" button bumps
 * `config.resetSeq` as an ordinary config write (no dedicated
 * UI->runtime channel exists or is needed for this); this hook just
 * notices the bump — comparing against the last value it already
 * applied, so it fires exactly once per bump, not every tick forever
 * after — and zeroes `count`.
 *
 * Command-driven reset (2026-09-10, same-day follow-up — Falcon, after
 * watching a Sensor+Command pair stop a Source and asking why: "counter
 * node is just like a checkpoint between path[,] i want it to count
 * only role and can manually be resetable or by a command when docked
 * with command"): a SECOND, independent way to trigger the exact same
 * zero-out as the manual button above — a Command node docked/wired to
 * this Counter's new signal-only input slot (portCapacity.ts, maxInputs
 * bumped 1 -> 2) can fire it too, no click needed.
 *
 * `state.open` here is written the exact same generic way Source's/
 * Gate's/Command's own `open` already is — SimEngine's applyActions
 * writes it into whichever node a `'signal'` edge TARGETS, no
 * Counter-specific plumbing required (see command.ts's own doc comment
 * for the full mechanism). Command re-emits its relayed value EVERY
 * tick, unconditionally (level, not a one-shot pulse) — reading it
 * directly would zero the count on every tick for as long as Command
 * reads "commanded", never letting anything accumulate. So this only
 * fires on the RISING EDGE: `open` reads true this tick and did NOT
 * read true the tick before — mirroring the resetSeq bump's own
 * "fires exactly once" behavior, just detected from a runtime value
 * instead of a config write. `lastCommandOpen` is this hook's own
 * bookkeeping field for that comparison, tracked every tick (even when
 * neither reset fires) so a Command latched at `true` across many
 * ticks is never mistaken for a fresh rising edge again.
 *
 * Polarity: `true` (Command's own default — "no effect until
 * commanded", per command.ts) is deliberately what fires the reset
 * here, not `false` — a bare Command docked straight onto a Counter
 * with nothing wired to ITS OWN Sensor input already reads `true`, so
 * reading `true` as the trigger means docking one on, by itself,
 * immediately resets once (same zero-config immediacy as the manual
 * button), and every later Sensor-driven `true` after that does the
 * same again on its own new rising edge. If this reads backwards for
 * how you're wiring it, flip the Sensor's own comparator instead of
 * this — no swap of which edge is source/target.
 */
const onTick: PerTickHook = (node, state) => {
  const resetSeq = typeof node.config.resetSeq === 'number' ? node.config.resetSeq : 0;
  const lastResetSeq = typeof state.lastResetSeq === 'number' ? state.lastResetSeq : 0;
  const manualReset = resetSeq !== lastResetSeq;

  const commandOpen = state.open === true;
  const lastCommandOpen = state.lastCommandOpen === true;
  const commandReset = commandOpen && !lastCommandOpen;

  if (manualReset || commandReset) {
    return {
      newState: { ...state, count: 0, lastResetSeq: resetSeq, lastCommandOpen: commandOpen },
      actions: [],
    };
  }
  if (commandOpen !== lastCommandOpen) {
    return { newState: { ...state, lastCommandOpen: commandOpen }, actions: [] };
  }
  return { newState: state, actions: [] };
};

export const counterBehavior: NodeBehavior = { onItemArrival, onTick };
