import type { EdgeDef, NodeId } from '../types';
import type { NodeBehavior, PerTickHook, Action } from './contract';

/**
 * Sensor (design doc §4.8, 2026-09-09 node-design session) — "like a
 * neuron": reads a condition and fires a level-based signal pulse
 * down every active `edgeKind: 'signal'` output edge to whatever
 * Gate(s) it's connected to. Carries no physical item, needs no
 * conservation accounting, and has no `onItemArrival` at all — an
 * item wired into a Sensor would be silently lost (see
 * portCapacity.ts's `maxInputs: 0` for this kind).
 *
 * v1 condition config (node.config):
 *  - watchNodeId: the id of the node whose runtime state to read (the
 *    worked example from the design discussion: an adjacent Silo —
 *    just a `buffer` node, §4.2 — at larger capacity). FALLBACK ONLY
 *    as of the auto-watch follow-up below — see watchedNodeIds.
 *  - metric: what to read off that node's state. 'queueLength' (a
 *    buffer/silo's live `queue.length`) was the only v1 metric;
 *    'count' (a Counter's live running tally, `state.count` —
 *    counter.ts) was added 2026-09-10 alongside the Counter node
 *    itself. Unrecognized or missing reads as 0.
 *  - comparator + threshold: how the read value is compared. Defaults
 *    to 'gte' / 0 (always true) so a freshly-placed, unconfigured
 *    Sensor doesn't silently do nothing — see defaultConfigFor in
 *    App.tsx for the friendlier placed-node default. Exactly ONE
 *    shared comparator+threshold per Sensor node, applied to every
 *    node it watches — see watchedNodeIds' doc comment for why that
 *    makes Falcon's "one node at a time, or multiple with the same
 *    condition" true by construction rather than something enforced.
 *  - testPulseSeq / testPulseDuration (2026-09-10 follow-up — Falcon:
 *    "i want sensor node with a temporary activate button for
 *    temporary and testing purposes[,] this transmit power
 *    temporarily"): a manual test override, bumped by
 *    PropertiesPanel's "Force ON" button — see evaluateSignals below
 *    for the full countdown mechanism. Not part of the Sensor's real
 *    condition at all, purely a debugging aid.
 *
 * Level-based, not edge-triggered: every tick this re-evaluates the
 * condition and re-broadcasts its CURRENT truth value, rather than
 * latching a one-shot pulse a Gate would need its own state machine
 * to remember. A connected Gate's `open` state simply tracks whatever
 * this Sensor last evaluated, one tick behind (SimEngine runs
 * `evaluateSignals` in the same per-tick-hooks pass as trySpawn/
 * tryDrain, after that tick's item arrivals have already been
 * delivered) — deliberately simple for a first pass; a true pulse/
 * latch model is a natural follow-up if Falcon wants edge-triggered
 * behavior later.
 *
 * Auto-watch (design doc §5.7, 2026-09-09 follow-up — "the sensor
 * nodes should auto-watch the node it is connected to or docked to"
 * / "the copper wires direction now matters ... the ingoing means the
 * node source to watch"): an active `edgeKind: 'signal'` edge whose
 * TARGET is this Sensor names a watched node (the edge's SOURCE) —
 * whether that edge was hand-drawn or created by drag-to-dock makes no
 * difference, both end up as an ordinary edgeKind: 'signal' edge (see
 * App.tsx's handleCreateEdge / handleDockNodes). This is now the
 * PRIMARY source of truth whenever at least one such edge exists;
 * `config.watchNodeId` is only consulted as a fallback for a Sensor
 * with zero incoming watch edges, so an already-saved graph that only
 * ever used the manual "Watch node" dropdown keeps behaving exactly as
 * it did before this existed.
 */
export function watchedNodeIds(inputEdges: EdgeDef[]): NodeId[] {
  return inputEdges.filter((e) => e.active && e.edgeKind === 'signal').map((e) => e.source);
}

function readMetric(metric: unknown, watchedState: Record<string, unknown> | undefined): number {
  if (metric === 'queueLength' || metric === undefined) {
    const queue = watchedState?.queue;
    return Array.isArray(queue) ? queue.length : 0;
  }
  if (metric === 'count') {
    const count = watchedState?.count;
    return typeof count === 'number' ? count : 0;
  }
  return 0;
}

function compare(value: number, comparator: unknown, threshold: number): boolean {
  switch (comparator) {
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'lt':
      return value < threshold;
    case 'eq':
      return value === threshold;
    case 'gte':
    default:
      return value >= threshold;
  }
}

const evaluateSignals: PerTickHook = (node, state, outputEdges, dt, _makeItemId, ctx) => {
  const threshold = typeof node.config.threshold === 'number' ? node.config.threshold : 0;

  // Auto-watch takes priority over the manual dropdown whenever any
  // incoming watch edge exists (see this file's header comment and
  // watchedNodeIds above); ctx.getInputEdges is optional purely for
  // older/simpler test call-sites (contract.ts's own doc comment) —
  // a real SimEngine tick always supplies it.
  const autoWatched = ctx?.getInputEdges ? watchedNodeIds(ctx.getInputEdges(node.id)) : [];
  const legacyWatchNodeId = typeof node.config.watchNodeId === 'string' ? node.config.watchNodeId : undefined;
  const watchIds = autoWatched.length > 0 ? autoWatched : legacyWatchNodeId ? [legacyWatchNodeId] : [];

  // OR across every watched node (Falcon: "a sensor can only work one
  // node at a time or if multiple but the same condition") -- a
  // Sensor only ever has the one comparator+threshold above, so
  // "the same condition" holds by construction; firing once ANY
  // watched node meets it covers the common "either feeder backs up"
  // case without needing per-edge condition config.
  let value = 0;
  let conditionMet = false;
  for (const id of watchIds) {
    const watchedState = ctx?.getNodeState(id);
    const v = readMetric(node.config.metric, watchedState);
    value = v;
    if (compare(v, node.config.comparator, threshold)) {
      conditionMet = true;
    }
  }
  // No watched node at all (freshly placed, nothing wired/docked/
  // configured yet) -- same "always true" default as before this
  // existed, so an unconfigured Sensor still drives whatever it's
  // wired to rather than silently doing nothing.
  if (watchIds.length === 0) {
    conditionMet = compare(0, node.config.comparator, threshold);
  }

  // Test pulse (2026-09-10 follow-up — Falcon: "i want sensor node
  // with a temporary activate button for temporary and testing
  // purposes[,] this transmit power temporarily"): a manual override
  // that forces `conditionMet` to true for a fixed real-world duration,
  // regardless of what the actual watched condition reads -- lets
  // Falcon test a downstream Gate/Command/Counter chain by hand,
  // without needing a real watched node to actually cross a threshold.
  // Same "config bump + a per-tick hook notices it" channel Counter's
  // manual Reset button already uses (PropertiesPanel has no other way
  // to reach into runtime state) — `testPulseSeq` is the bump,
  // `testPulseDuration` (seconds) how long the override lasts once
  // fired. A fresh bump (including a RE-press while one is already
  // counting down) restarts the countdown at the full duration rather
  // than stacking; letting it run out simply resumes normal per-tick
  // evaluation with nothing left over to revert.
  const testPulseSeq = typeof node.config.testPulseSeq === 'number' ? node.config.testPulseSeq : 0;
  const lastTestPulseSeq = typeof state.lastTestPulseSeq === 'number' ? state.lastTestPulseSeq : 0;
  const testPulseDuration =
    typeof node.config.testPulseDuration === 'number' && node.config.testPulseDuration > 0
      ? node.config.testPulseDuration
      : 2;
  let testPulseRemaining = typeof state.testPulseRemaining === 'number' ? state.testPulseRemaining : 0;
  if (testPulseSeq !== lastTestPulseSeq) {
    testPulseRemaining = testPulseDuration;
  }
  const testPulseActive = testPulseRemaining > 0;
  if (testPulseActive) {
    conditionMet = true;
  }
  const nextTestPulseRemaining = testPulseActive ? Math.max(0, testPulseRemaining - dt) : 0;

  const signalEdges = outputEdges.filter((e) => e.active && e.edgeKind === 'signal');
  const actions: Action[] = signalEdges.map((e) => ({ type: 'signal', edgeId: e.id, value: conditionMet }));

  return {
    newState: {
      ...state,
      lastValue: value,
      lastConditionMet: conditionMet,
      watchedNodeIds: watchIds,
      lastTestPulseSeq: testPulseSeq,
      testPulseRemaining: nextTestPulseRemaining,
    },
    actions,
  };
};

export const sensorBehavior: NodeBehavior = { evaluateSignals };
