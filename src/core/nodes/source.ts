import type { Item } from '../types';
import type { RuntimeState } from '../NodeRuntimeState';
import type { NodeBehavior, PerTickHook } from './contract';

/**
 * Source — 0 inputs, so it never receives onItemArrival; SimEngine
 * calls trySpawn once per tick instead (design doc §4.2, §4.3).
 *
 * Pulse mode (2026-09-11, Command's Pulse duration mode targeting a
 * Source — confirmed: "force an immediate spawn bypassing the
 * cooldown, then reset the cooldown from that point"): a `'pulse'`
 * Action bumps `state.pulseSeq` (SimEngine's applyActions) instead of
 * writing `open`. A pending, unconsumed pulse (`pulseSeq` ahead of
 * `lastConsumedPulseSeq`) bypasses ONLY the cooldown check below —
 * every other gate SimEngine's own `sourceCanSpawnThisTick` already
 * applies (the manual `active` switch, the signal-gated `open` level,
 * the spawn limit, item-spacing room) still has to allow spawning for
 * `trySpawn` to even be called this tick, same as ever; the pulse just
 * means "don't also make it wait out the cooldown." Consumed the same
 * tick it fires a spawn (whether pulse-triggered or the cooldown had
 * already reached 0 anyway) — a pulse that arrives while every other
 * gate is closed simply stays pending until spawning becomes possible
 * again, rather than being lost.
 */
const trySpawn: PerTickHook = (node, state, outputEdges, dt, makeItemId) => {
  const cooldown = typeof node.config.cooldown === 'number' ? node.config.cooldown : 1;
  const itemType = typeof node.config.itemType === 'string' ? node.config.itemType : 'item';
  const cooldownRemaining = typeof state.cooldownRemaining === 'number' ? state.cooldownRemaining : cooldown;

  const pulseSeq = typeof state.pulseSeq === 'number' ? state.pulseSeq : 0;
  const lastConsumedPulseSeq = typeof state.lastConsumedPulseSeq === 'number' ? state.lastConsumedPulseSeq : 0;
  const pulseTriggered = pulseSeq > lastConsumedPulseSeq;

  if (!pulseTriggered && cooldownRemaining > 0) {
    return { newState: { ...state, cooldownRemaining: cooldownRemaining - dt }, actions: [] };
  }

  // v1: single-output source. Picks the first active REAL (non-signal)
  // edge; if none is active/available, the item simply isn't spawned
  // this tick (backs up naturally rather than being lost or
  // force-created). Explicitly excludes edgeKind: 'signal' (2026-09-11
  // wire/path-port-split follow-up) -- a Source can now carry an
  // active signal edge to a watching Sensor (maxWireOutputs, see
  // portCapacity.ts) at the same time as its real product-path edge,
  // and a spawned item must never be sent down the Sensor's signal
  // wire. Same exclusion buffer.ts/counter.ts/gate.ts already apply to
  // their own real-item output lookups, for the same reason.
  const target = outputEdges.find((e) => e.active && e.edgeKind !== 'signal');
  if (!target) {
    return { newState: state, actions: [] };
  }

  const item: Item = { id: makeItemId(), type: itemType };
  const spawnedCount = typeof state.spawnedCount === 'number' ? state.spawnedCount : 0;
  // "reset the cooldown from that point" — cooldownRemaining is set to
  // the full cooldown either way (a pulse-triggered spawn or an
  // ordinary one that just finished counting down), so the next
  // ordinary spawn is timed from THIS spawn, not from whenever the old
  // cooldown would otherwise have reached 0.
  const newState: RuntimeState = { ...state, cooldownRemaining: cooldown, spawnedCount: spawnedCount + 1 };
  if (pulseTriggered) newState.lastConsumedPulseSeq = pulseSeq;
  return {
    newState,
    actions: [{ type: 'send', edgeId: target.id, item }],
  };
};

/**
 * Reset `spawnedCount` (2026-09-11 follow-up — Falcon, after finding a
 * spawn-limited Source could never be reused: "why does the source can
 * never get reused like once it deactivated when limited spawn count
 * all spawned ... even i tried to activate it back manually", confirmed
 * via AskUserQuestion: "Manual button + Command-driven reset"). Two
 * independent ways, exactly mirroring counter.ts's own onTick:
 *  - Manual (PropertiesPanel's "Reset spawn count" button): bumps
 *    `config.resetSeq` as an ordinary config write; this hook notices
 *    the bump and zeroes `spawnedCount` the very next tick.
 *  - Command-driven (dock or wire a SECOND Command node onto this
 *    Source's now-2-slot input — portCapacity.ts's `maxInputs` bumped
 *    1 -> 2 — with its own Verb set to "Reset spawn count"): fires the
 *    exact same zero-out, triggered by that Command's own Sensor
 *    condition instead of a click.
 *
 * Runs UNCONDITIONALLY every tick, same as counter.ts's onTick and for
 * the identical reason: `trySpawn` above only runs when SimEngine's
 * `sourceCanSpawnThisTick` already allows it, and a spawn-limit-
 * exhausted Source is PRECISELY the case where that gate stays closed
 * forever — a reset living inside `trySpawn` would then never be seen
 * at all, the exact deadlock counter.ts's own onTick doc comment
 * already warns about.
 *
 * Reads `state.resetSignal`, never `state.open` — Source's `open`
 * field is already spoken for (this same node's own activate/
 * deactivate gate, written by a DIFFERENT Command). Using a separate
 * field is what lets both Commands coexist without one silently
 * undoing the other's job (see contract.ts's `'resetSignal'` action
 * and command.ts's new 'reset' verb for the full mechanism) — only a
 * Command with verb 'reset' ever writes `resetSignal` at all, so this
 * check is inert (`resetSignal` stays `undefined`, never `true`) for
 * every Source that doesn't have one wired in, exactly like Counter's
 * own onTick is inert without a Command docked to it.
 *
 * Rising-edge detection (`resetCommandOpen && !lastCommandResetOpen`),
 * not a raw level read, for the same reason counter.ts's own onTick
 * checks a rising edge on `open` rather than the level directly: a
 * Command relays its Sensor's condition every tick unconditionally, so
 * reading the level directly would re-zero `spawnedCount` on every
 * tick the condition holds true, never letting anything accumulate.
 */
const onTick: PerTickHook = (node, state) => {
  const resetSeq = typeof node.config.resetSeq === 'number' ? node.config.resetSeq : 0;
  const lastResetSeq = typeof state.lastResetSeq === 'number' ? state.lastResetSeq : 0;
  const manualReset = resetSeq !== lastResetSeq;

  const resetCommandOpen = state.resetSignal === true;
  const lastCommandResetOpen = state.lastCommandResetOpen === true;
  const commandReset = resetCommandOpen && !lastCommandResetOpen;

  if (manualReset || commandReset) {
    return {
      newState: { ...state, spawnedCount: 0, lastResetSeq: resetSeq, lastCommandResetOpen: resetCommandOpen },
      actions: [],
    };
  }
  if (resetCommandOpen !== lastCommandResetOpen) {
    return { newState: { ...state, lastCommandResetOpen: resetCommandOpen }, actions: [] };
  }
  return { newState: state, actions: [] };
};

export const sourceBehavior: NodeBehavior = { trySpawn, onTick };
