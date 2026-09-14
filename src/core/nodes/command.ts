import type { NodeDef } from '../types';
import type { Action, NodeBehavior, PerTickHook } from './contract';

/**
 * Command (design doc §4.8 follow-up; upgraded 2026-09-11 from a plain
 * signal relay into the full VERB + DURATION actuator worked out in
 * the Time/Counter/Command design session) — the universal actuator:
 * the ONLY node kind allowed to apply an effect to another node. A
 * Sensor never touches a Gate/Source/Counter/Time directly any more
 * (see gate.ts's own doc comment on the breaking change, and
 * persistence.ts's migrateSensorGateToCommand for the load-time
 * splice of any pre-existing Sensor->Gate wire) — every one of those
 * targets is driven exclusively through a Command.
 *
 * Two orthogonal config axes (node.config):
 *  - `verb` — which action to apply, meaningful only for a Gate or a
 *    Source target: 'open' | 'close' (Gate), 'activate' | 'deactivate'
 *    | 'reset' (Source — the third option added 2026-09-11, see below).
 *    Picks POLARITY: which raw sensor level (true) maps to which
 *    physical state. Falls back to `defaultVerbForTargetKind` when
 *    unset, so an old saved Command (built before this config existed)
 *    keeps behaving exactly as it did — the old code always treated
 *    "signal true" as "open"/"activate", which is exactly
 *    'open'/'activate''s behavior here too. A Counter/Time target has
 *    no real verb choice (only ever "reset" — a momentary action with
 *    no natural opposite), so this field is simply ignored for those.
 *  - `duration` — 'latch' (default, matching every pre-existing
 *    Command's only prior behavior) | 'pulse'. Latch: the commanded
 *    state continuously mirrors the current sensor level, exactly like
 *    the original relay — holds until a later signal reverses it.
 *    Pulse: fires a one-shot trigger on each RISING edge of the
 *    (post-polarity) commanded value, letting the target itself decide
 *    what "one shot" means (Gate: exactly one item let through; Source:
 *    one forced spawn bypassing cooldown) — see gate.ts/source.ts.
 *    Ignored for a Counter/Time target: a reset is already a one-shot
 *    action under the OLD Latch-only behavior (the target's own
 *    rising-edge detection on the relayed boolean already fires it
 *    exactly once per signal, never repeatedly while held), so there is
 *    nothing a Pulse mode would do differently — no UI or logic branch
 *    needed for it there. Also ignored for a Source target with
 *    verb 'reset' (see below) — same "a reset is already momentary"
 *    reasoning, extended to Source's third verb.
 *
 * Source's 'reset' verb (2026-09-11 follow-up — Falcon, after finding
 * a spawn-limited Source could never be reused: "why does the source
 * can never get reused ... even i tried to activate it back manually",
 * confirmed via AskUserQuestion: "Manual button + Command-driven
 * reset"): a Source target's ONLY other verb choice besides activate/
 * deactivate, picked explicitly (never the default — see
 * `defaultVerbForTargetKind`, unchanged, so an existing activate/
 * deactivate Command keeps doing exactly that). Routed like Counter/
 * Time above — duration ignored, raw sensor level relayed every tick —
 * but into a NEW `'resetSignal'` action (contract.ts) instead of
 * `'signal'`, so it lands in the target's `resetSignal` field rather
 * than `open`. That split matters specifically for Source: `open` is
 * already its own activate/deactivate gate, so a single Command
 * flipping between "reset" and "activate/deactivate" would otherwise
 * make an ordinary gate toggle also blow away the spawn tally (or vice
 * versa). Keeping them on separate fields lets a Source have ONE
 * Command wired for ongoing activate/deactivate and a SEPARATE, second
 * Command wired purely to reset — portCapacity.ts's `maxInputs` bumped
 * 1 -> 2 for exactly this — with neither stepping on the other.
 * source.ts's new `onTick` does the same rising-edge-fires-once
 * detection on `resetSignal` that counter.ts's onTick already does on
 * `open` (Counter never needed a split — nothing else on a Counter
 * competes for that field).
 *
 * Still level-based on its OWN input side, unconditionally, every tick
 * (Sensor's own `evaluateSignals` continues to write straight into
 * `state.open` here, the exact same generic mechanism Gate used to
 * receive directly) — only the OUTPUT side gained real behavior.
 */

/** Falls back to a sensible verb for a target kind that has no
 * meaningful choice, or when `node.config.verb` hasn't been set yet
 * (every Command built before this config existed). Exported so
 * PropertiesPanel's dropdown can pre-fill the same default it's
 * actually running with, rather than guessing separately. Still
 * 'activate' for a Source — 'reset' is a deliberate, explicit pick
 * only, never a default (see this file's header comment on the new
 * verb). */
export function defaultVerbForTargetKind(kind: NodeDef['kind'] | undefined): string {
  if (kind === 'gate') return 'open';
  if (kind === 'source') return 'activate';
  return 'reset';
}

const evaluateSignals: PerTickHook = (node, state, outputEdges, _dt, _makeItemId, ctx) => {
  const sensorLevel = state.open === true;

  const out = outputEdges.find((e) => e.active && e.edgeKind === 'signal');
  const targetKind = out ? ctx?.getNode(out.target)?.kind : undefined;

  // Counter/Time reset: unchanged from Command's original relay —
  // duration mode doesn't apply (see this file's own header comment),
  // so this always just mirrors the current sensor level; the target's
  // own onTick does the rising-edge-fires-once detection, exactly as
  // it always has.
  if (targetKind === 'counter' || targetKind === 'time') {
    const actions: Action[] = out ? [{ type: 'signal', edgeId: out.id, value: sensorLevel }] : [];
    return { newState: state, actions };
  }

  const verb = typeof node.config.verb === 'string' ? node.config.verb : defaultVerbForTargetKind(targetKind);

  // Source's 'reset' verb (2026-09-11 follow-up, this file's own
  // header comment has the full rationale): same "duration doesn't
  // apply, relay raw level, target does its own rising-edge detection"
  // shape as Counter/Time above, just emitting 'resetSignal' instead
  // of 'signal' so it lands in `resetSignal`, never `open`.
  if (targetKind === 'source' && verb === 'reset') {
    const actions: Action[] = out ? [{ type: 'resetSignal', edgeId: out.id, value: sensorLevel }] : [];
    return { newState: state, actions };
  }

  const duration = node.config.duration === 'pulse' ? 'pulse' : 'latch';
  const inverted = verb === 'close' || verb === 'deactivate';
  const commandedOn = inverted ? !sensorLevel : sensorLevel;

  if (duration === 'latch') {
    const actions: Action[] = out ? [{ type: 'signal', edgeId: out.id, value: commandedOn }] : [];
    return { newState: state, actions };
  }

  // Pulse: fire once on each rising edge of the (post-polarity)
  // commanded value — needs its OWN edge tracking, since `state.open`
  // above is the raw pre-polarity sensor level, not this.
  const lastCommandedOn = state.lastCommandedOn === true;
  const commandRisingEdge = commandedOn && !lastCommandedOn;
  const actions: Action[] = out && commandRisingEdge ? [{ type: 'pulse', edgeId: out.id }] : [];
  return { newState: { ...state, lastCommandedOn: commandedOn }, actions };
};

export const commandBehavior: NodeBehavior = { evaluateSignals };
