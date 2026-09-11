import { describe, it, expect } from 'vitest';
import { GraphModel } from '../GraphModel';
import { SimEngine } from '../SimEngine';
import { nodeHandlers, type Action } from '../nodes/index';
import { buildWeightedSequence } from '../nodes/distributor';
import type { NodeDef, EdgeDef, Item } from '../types';

/**
 * Milestone 3 target tests (design doc §9 step 3): distributor,
 * sorter, mixer, buffer/overflow — each against the shared
 * onItemArrival contract, still schematic (no rendering involved).
 *
 * Node handlers are pure functions, so most of this file unit-tests
 * them directly (precise control over state/edges, no tick-timing
 * choreography needed); a few SimEngine-level tests cover end-to-end
 * routing and item conservation through a real graph.
 */

function node(id: string, kind: NodeDef['kind'], config: Record<string, unknown> = {}): NodeDef {
  return { id, kind, config };
}

function edge(id: string, source: string, target: string, overrides: Partial<EdgeDef> = {}): EdgeDef {
  return {
    id,
    source,
    target,
    sourcePort: overrides.sourcePort ?? 0,
    targetPort: overrides.targetPort ?? 0,
    flowRate: overrides.flowRate ?? 1,
    active: overrides.active ?? true,
  };
}

const item = (id: string, type = 'widget'): Item => ({ id, type });
let seq = 0;
const makeItemId = () => `gen-${++seq}`;

/** Narrows a generic Action (a discriminated union) to the 'signal'
 * variant for tests that know, by construction, that's the only kind
 * a Sensor's evaluateSignals ever produces. */
function asSignal(a: Action): Extract<Action, { type: 'signal' }> {
  if (a.type !== 'signal') throw new Error(`expected a 'signal' action, got '${a.type}'`);
  return a;
}

describe('distributor', () => {
  const handler = nodeHandlers.distributor!.onItemArrival!;

  it('round-robins across active output edges in port order', () => {
    const n = node('dist', 'distributor');
    const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
    const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
    const arrival = edge('e0', 'src', 'dist');

    let state = {};
    const r1 = handler(item('i1'), n, state, [eA, eB], arrival, makeItemId);
    state = r1.newState;
    expect(r1.actions).toEqual([{ type: 'forward', edgeId: 'eA', item: item('i1') }]);

    const r2 = handler(item('i2'), n, state, [eA, eB], arrival, makeItemId);
    state = r2.newState;
    expect(r2.actions).toEqual([{ type: 'forward', edgeId: 'eB', item: item('i2') }]);

    const r3 = handler(item('i3'), n, state, [eA, eB], arrival, makeItemId);
    expect(r3.actions).toEqual([{ type: 'forward', edgeId: 'eA', item: item('i3') }]);
    expect(r3.newState.routedCount).toBe(3); // skin badge reads this (design doc §4.5)
  });

  it('broadcast mode forwards a fresh-id copy onto every active output edge', () => {
    const n = node('dist', 'distributor', { mode: 'broadcast' });
    const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
    const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
    const arrival = edge('e0', 'src', 'dist');

    const result = handler(item('i1', 'bolt'), n, {}, [eA, eB], arrival, makeItemId);
    expect(result.actions).toHaveLength(2);
    expect(result.actions.every((a) => a.type === 'forward')).toBe(true);
    expect(result.actions.map((a) => (a as { edgeId: string }).edgeId).sort()).toEqual(['eA', 'eB']);
    // Broadcast copies get fresh ids (they're not the same item instance).
    const ids = result.actions.map((a) => (a as { item: Item }).item.id);
    expect(new Set(ids).size).toBe(2);
    expect(result.actions.every((a) => (a as { item: Item }).item.type === 'bolt')).toBe(true);
  });

  it('refuses the item (accepted: false) when no output edge is active — never dropped', () => {
    const n = node('dist', 'distributor');
    const eInactive = edge('e1', 'dist', 'snk', { active: false });
    const arrival = edge('e0', 'src', 'dist');

    const result = handler(item('i1'), n, {}, [eInactive], arrival, makeItemId);
    expect(result.accepted).toBe(false);
    expect(result.actions).toHaveLength(0);
  });

  /**
   * 2026-09-10 — Falcon: "the distributor node keeps accepting items
   * even nowhere to be distribute direction for like it simply
   * accepts endlessly." Before this, "has an active output edge" was
   * the whole check — a full downstream buffer was invisible to it.
   * These build a minimal fake ctx (just the two reads
   * `targetBufferIsFull` actually needs) rather than a real
   * GraphModel/SimEngine, matching this describe block's own
   * pure-function-unit-test style; the SimEngine-level reproduction
   * of the full screenshot (source -> distributor -> buffer) is
   * covered separately.
   */
  it('refuses the item (accepted: false) once its round-robin target buffer is already at capacity', () => {
    const n = node('dist', 'distributor');
    const eA = edge('eA', 'dist', 'bufA', { sourcePort: 0 });
    const arrival = edge('e0', 'src', 'dist');
    const fullBuffer = node('bufA', 'buffer', { capacity: 2 });
    const ctx = {
      getNode: (id: string) => (id === 'bufA' ? fullBuffer : undefined),
      getNodeState: (id: string) => (id === 'bufA' ? { queue: [item('q1'), item('q2')] } : undefined),
    };

    const result = handler(item('i1'), n, {}, [eA], arrival, makeItemId, ctx);
    expect(result.accepted).toBe(false);
    expect(result.actions).toHaveLength(0);
    // Must not have advanced rrIndex/routedCount either -- a refused
    // arrival should leave state exactly as it was, so the retry next
    // tick re-checks the same edge rather than skipping ahead.
    expect(result.newState).toEqual({});
  });

  it('still routes normally once that same target buffer has room again', () => {
    const n = node('dist', 'distributor');
    const eA = edge('eA', 'dist', 'bufA', { sourcePort: 0 });
    const arrival = edge('e0', 'src', 'dist');
    const roomyBuffer = node('bufA', 'buffer', { capacity: 2 });
    const ctx = {
      getNode: (id: string) => (id === 'bufA' ? roomyBuffer : undefined),
      getNodeState: (id: string) => (id === 'bufA' ? { queue: [item('q1')] } : undefined), // 1 of 2 slots used
    };

    const result = handler(item('i1'), n, {}, [eA], arrival, makeItemId, ctx);
    expect(result.accepted).not.toBe(false);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'eA', item: item('i1') }]);
  });

  it('broadcast mode holds ALL copies if even one active target buffer is full, rather than dropping just that copy', () => {
    const n = node('dist', 'distributor', { mode: 'broadcast' });
    const eA = edge('eA', 'dist', 'bufA', { sourcePort: 0 });
    const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 }); // not a buffer -- always has "room"
    const arrival = edge('e0', 'src', 'dist');
    const fullBuffer = node('bufA', 'buffer', { capacity: 1 });
    const ctx = {
      getNode: (id: string) => (id === 'bufA' ? fullBuffer : undefined),
      getNodeState: (id: string) => (id === 'bufA' ? { queue: [item('q1')] } : undefined),
    };

    const result = handler(item('i1'), n, {}, [eA, eB], arrival, makeItemId, ctx);
    expect(result.accepted).toBe(false);
    expect(result.actions).toHaveLength(0);
  });

  it('a target that is not a buffer at all is never treated as full — unaffected by this check', () => {
    const n = node('dist', 'distributor');
    const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
    const arrival = edge('e0', 'src', 'dist');
    const ctx = {
      getNode: (id: string) => (id === 'snkA' ? node('snkA', 'sink') : undefined),
      getNodeState: () => undefined,
    };

    const result = handler(item('i1'), n, {}, [eA], arrival, makeItemId, ctx);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'eA', item: item('i1') }]);
  });

  describe('weighted round-robin (2026-09-10)', () => {
    it('buildWeightedSequence: unweighted ports default to weight 1 -- same cycle plain round-robin would produce', () => {
      const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
      const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
      expect(buildWeightedSequence([eA, eB], undefined)).toEqual([eA, eB]);
    });

    it('buildWeightedSequence: repeats each port its own weight times, in port order', () => {
      const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
      const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
      const eC = edge('eC', 'dist', 'snkC', { sourcePort: 2 });
      const seq = buildWeightedSequence([eA, eB, eC], { '0': 1, '1': 3, '2': 5 });
      expect(seq).toEqual([eA, eB, eB, eB, eC, eC, eC, eC, eC]);
    });

    it('buildWeightedSequence: a port weighted 0 is skipped entirely', () => {
      const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
      const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
      expect(buildWeightedSequence([eA, eB], { '0': 0, '1': 2 })).toEqual([eB, eB]);
    });

    it('onItemArrival: routes 1:3:5 across three ports over a full 9-item cycle, then repeats', () => {
      const n = node('dist', 'distributor', { mode: 'weighted', weights: { '0': 1, '1': 3, '2': 5 } });
      const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
      const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
      const eC = edge('eC', 'dist', 'snkC', { sourcePort: 2 });
      const arrival = edge('e0', 'src', 'dist');

      const targets: string[] = [];
      let state: Record<string, unknown> = {};
      for (let i = 0; i < 18; i++) {
        const r = handler(item(`i${i}`), n, state, [eA, eB, eC], arrival, makeItemId);
        state = r.newState;
        targets.push((r.actions[0] as { edgeId: string }).edgeId);
      }
      const oneCycle = ['eA', 'eB', 'eB', 'eB', 'eC', 'eC', 'eC', 'eC', 'eC'];
      expect(targets).toEqual([...oneCycle, ...oneCycle]);
    });

    it('onItemArrival: a port weighted 0 never gets picked', () => {
      const n = node('dist', 'distributor', { mode: 'weighted', weights: { '0': 0, '1': 1 } });
      const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
      const eB = edge('eB', 'dist', 'snkB', { sourcePort: 1 });
      const arrival = edge('e0', 'src', 'dist');

      let state: Record<string, unknown> = {};
      for (let i = 0; i < 4; i++) {
        const r = handler(item(`i${i}`), n, state, [eA, eB], arrival, makeItemId);
        state = r.newState;
        expect((r.actions[0] as { edgeId: string }).edgeId).toBe('eB');
      }
    });

    it('onItemArrival: refuses (accepted: false), without advancing state, when every active port is weighted 0', () => {
      const n = node('dist', 'distributor', { mode: 'weighted', weights: { '0': 0 } });
      const eA = edge('eA', 'dist', 'snkA', { sourcePort: 0 });
      const arrival = edge('e0', 'src', 'dist');

      const result = handler(item('i1'), n, {}, [eA], arrival, makeItemId);
      expect(result.accepted).toBe(false);
      expect(result.newState).toEqual({});
    });

    it('onItemArrival: holds on the same weighted slot (state unchanged) when its target buffer is full, same convention as plain round-robin', () => {
      const n = node('dist', 'distributor', { mode: 'weighted', weights: { '0': 2 } });
      const eA = edge('eA', 'dist', 'bufA', { sourcePort: 0 });
      const arrival = edge('e0', 'src', 'dist');
      const fullBuffer = node('bufA', 'buffer', { capacity: 1 });
      const ctx = {
        getNode: (id: string) => (id === 'bufA' ? fullBuffer : undefined),
        getNodeState: (id: string) => (id === 'bufA' ? { queue: [item('q1')] } : undefined),
      };

      const result = handler(item('i1'), n, {}, [eA], arrival, makeItemId, ctx);
      expect(result.accepted).toBe(false);
      expect(result.newState).toEqual({});
    });
  });
});

describe('merger', () => {
  const handler = nodeHandlers.merger!.onItemArrival!;

  it('forwards an item arriving on ANY input edge straight out the single active output edge', () => {
    const n = node('merge', 'merger');
    const eOut = edge('eOut', 'merge', 'snk', { sourcePort: 0 });
    const arrivalA = edge('eA', 'srcA', 'merge');
    const arrivalB = edge('eB', 'srcB', 'merge');

    const r1 = handler(item('i1'), n, {}, [eOut], arrivalA, makeItemId);
    expect(r1.actions).toEqual([{ type: 'forward', edgeId: 'eOut', item: item('i1') }]);
    expect(r1.newState.mergedCount).toBe(1); // skin badge policy: not surfaced (only buffer shows a count), but still tracked

    const r2 = handler(item('i2'), n, r1.newState, [eOut], arrivalB, makeItemId);
    expect(r2.actions).toEqual([{ type: 'forward', edgeId: 'eOut', item: item('i2') }]);
    expect(r2.newState.mergedCount).toBe(2);
  });

  it('refuses the item (accepted: false) when the output edge is inactive — never dropped', () => {
    const n = node('merge', 'merger');
    const eOut = edge('eOut', 'merge', 'snk', { active: false });
    const arrival = edge('eA', 'srcA', 'merge');

    const result = handler(item('i1'), n, {}, [eOut], arrival, makeItemId);
    expect(result.accepted).toBe(false);
    expect(result.actions).toHaveLength(0);
  });
});

describe('sorter', () => {
  const handler = nodeHandlers.sorter!.onItemArrival!;

  it('routes by first-match rule to the matching output port', () => {
    const n = node('sort', 'sorter', { rules: [{ itemType: 'bolt', outputPort: 1 }], defaultPort: 0 });
    const eDefault = edge('eDefault', 'sort', 'snkDefault', { sourcePort: 0 });
    const eBolt = edge('eBolt', 'sort', 'snkBolt', { sourcePort: 1 });
    const arrival = edge('e0', 'src', 'sort');

    const result = handler(item('i1', 'bolt'), n, {}, [eDefault, eBolt], arrival, makeItemId);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'eBolt', item: item('i1', 'bolt') }]);
    expect(result.newState.routedCount).toBe(1); // skin badge reads this (design doc §4.5)
  });

  it('falls through to defaultPort when no rule matches', () => {
    const n = node('sort', 'sorter', { rules: [{ itemType: 'bolt', outputPort: 1 }], defaultPort: 0 });
    const eDefault = edge('eDefault', 'sort', 'snkDefault', { sourcePort: 0 });
    const arrival = edge('e0', 'src', 'sort');

    const result = handler(item('i1', 'nut'), n, {}, [eDefault], arrival, makeItemId);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'eDefault', item: item('i1', 'nut') }]);
  });

  it('unmatchedPolicy "hold" (default) parks the item instead of dropping it', () => {
    const n = node('sort', 'sorter', { rules: [{ itemType: 'nut', outputPort: 0 }] });
    const arrival = edge('e0', 'src', 'sort');

    const result = handler(item('i1', 'bolt'), n, {}, [], arrival, makeItemId);
    expect(result.accepted).toBe(false);
    expect(result.actions).toHaveLength(0);
  });

  it('unmatchedPolicy "drop" destroys the item and tracks droppedCount', () => {
    const n = node('sort', 'sorter', { rules: [], unmatchedPolicy: 'drop' });
    const arrival = edge('e0', 'src', 'sort');

    const result = handler(item('i1'), n, {}, [], arrival, makeItemId);
    expect(result.accepted).not.toBe(false);
    expect(result.actions).toHaveLength(0);
    expect(result.newState.droppedCount).toBe(1);
  });

  it('FBP003: a matched-but-gated-off edge is treated as unmatched (held, not force-through)', () => {
    const n = node('sort', 'sorter', { rules: [{ itemType: 'bolt', outputPort: 0 }] });
    const eGated = edge('e1', 'sort', 'snk', { sourcePort: 0, active: false });
    const arrival = edge('e0', 'src', 'sort');

    const result = handler(item('i1', 'bolt'), n, {}, [eGated], arrival, makeItemId);
    expect(result.accepted).toBe(false);
  });

  it('SimEngine integration: gated sorter output un-gates and delivers on the next arrival check', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 5, itemType: 'bolt' }));
    graph.addNode(node('sort', 'sorter', { rules: [{ itemType: 'bolt', outputPort: 0 }] }));
    graph.addNode(node('snk', 'sink'));
    graph.addEdge(edge('e0', 'src', 'sort'));
    graph.addEdge(edge('e1', 'sort', 'snk', { active: false }));

    const engine = new SimEngine(graph);
    for (let i = 0; i < 7; i++) engine.tick(1); // one item spawns, arrives, held at sorter

    expect(engine.getItemsInFlight()).toHaveLength(1);
    expect(engine.getNodeState('snk')?.consumedCount ?? 0).toBe(0);

    graph.setEdgeActive('e1', true);
    engine.tick(1); // forwarded onto e1
    engine.tick(1); // delivered to sink

    expect(engine.getNodeState('snk')?.consumedCount).toBe(1);
    expect(engine.getItemsInFlight()).toHaveLength(0);
  });
});

describe('mixer', () => {
  const handler = nodeHandlers.mixer!.onItemArrival!;

  it('queues arrivals per port and does not fire until every recipe port matches', () => {
    const n = node('mix', 'mixer', { recipe: { 0: 'a', 1: 'b' }, outputType: 'combo' });
    const outEdge = edge('eOut', 'mix', 'snk');
    const arrivalA = edge('eA', 'srcA', 'mix', { targetPort: 0 });
    const arrivalB = edge('eB', 'srcB', 'mix', { targetPort: 1 });

    const r1 = handler(item('a1', 'a'), n, {}, [outEdge], arrivalA, makeItemId);
    expect(r1.actions).toHaveLength(0); // only port 0 filled, recipe incomplete

    const r2 = handler(item('b1', 'b'), n, r1.newState, [outEdge], arrivalB, makeItemId);
    expect(r2.actions).toHaveLength(1);
    expect(r2.actions[0]).toMatchObject({ type: 'send', edgeId: 'eOut' });
    expect((r2.actions[0] as { item: Item }).item.type).toBe('combo');
    expect(r1.newState.producedCount ?? 0).toBe(0); // recipe incomplete: no fire yet
    expect(r2.newState.producedCount).toBe(1); // skin badge reads this (design doc §4.5)
  });

  it('checks output-edge availability BEFORE consuming inputs: a blocked recipe just waits', () => {
    const n = node('mix', 'mixer', { recipe: { 0: 'a', 1: 'b' }, outputType: 'combo' });
    const blockedOut = edge('eOut', 'mix', 'snk', { active: false });
    const arrivalA = edge('eA', 'srcA', 'mix', { targetPort: 0 });
    const arrivalB = edge('eB', 'srcB', 'mix', { targetPort: 1 });

    const r1 = handler(item('a1', 'a'), n, {}, [blockedOut], arrivalA, makeItemId);
    const r2 = handler(item('b1', 'b'), n, r1.newState, [blockedOut], arrivalB, makeItemId);

    // Recipe is complete but output is gated: no action fired, and
    // both inputs are still sitting in the node's own buffer state —
    // not destroyed with nothing to show for it.
    expect(r2.actions).toHaveLength(0);
    const buffers = r2.newState.buffers as Record<number, Item[]>;
    expect(buffers[0]).toHaveLength(1);
    expect(buffers[1]).toHaveLength(1);
  });

  it('2026-09-10 ("the ports are named according to compass"): finds its one output edge by activity alone, whatever its sourcePort is — no config.outputPort needed', () => {
    // Ports are now the physical anchor a wire is drawn from
    // (App.tsx's edge-creation sites); a mixer's single output edge
    // could land on any of the 8 sides. Before this fix, mixer.ts only
    // ever looked for `sourcePort === config.outputPort` (default 0) —
    // an output edge sitting at a non-zero anchor, with no matching
    // config.outputPort set, would have silently never been found.
    const n = node('mix', 'mixer', { recipe: { 0: 'a', 1: 'b' }, outputType: 'combo' });
    const outEdge = edge('eOut', 'mix', 'snk', { sourcePort: 6 }); // e.g. drawn from the N side
    const arrivalA = edge('eA', 'srcA', 'mix', { targetPort: 0 });
    const arrivalB = edge('eB', 'srcB', 'mix', { targetPort: 1 });

    const r1 = handler(item('a1', 'a'), n, {}, [outEdge], arrivalA, makeItemId);
    const r2 = handler(item('b1', 'b'), n, r1.newState, [outEdge], arrivalB, makeItemId);

    expect(r2.actions).toHaveLength(1);
    expect(r2.actions[0]).toMatchObject({ type: 'send', edgeId: 'eOut' });
    expect((r2.actions[0] as { item: Item }).item.type).toBe('combo');
  });
});

describe('buffer', () => {
  const arrival = nodeHandlers.buffer!.onItemArrival!;
  const drain = nodeHandlers.buffer!.tryDrain!;

  it('queues items up to capacity, then refuses (accepted: false, "block" policy default)', () => {
    const n = node('buf', 'buffer', { capacity: 2 });
    const r1 = arrival(item('i1'), n, {}, [], edge('e0', 'src', 'buf'), makeItemId);
    const r2 = arrival(item('i2'), n, r1.newState, [], edge('e0', 'src', 'buf'), makeItemId);
    const r3 = arrival(item('i3'), n, r2.newState, [], edge('e0', 'src', 'buf'), makeItemId);

    expect((r2.newState.queue as Item[]).length).toBe(2);
    expect(r3.accepted).toBe(false);
  });

  it('overflowPolicy "divert" forwards the overflowing item straight to the overflow edge', () => {
    const n = node('buf', 'buffer', { capacity: 1, overflowPolicy: 'divert', overflowPort: 1 });
    const overflowEdge = edge('eOverflow', 'buf', 'snkOverflow', { sourcePort: 1 });

    const r1 = arrival(item('i1'), n, {}, [overflowEdge], edge('e0', 'src', 'buf'), makeItemId);
    expect(r1.newState.queue).toEqual([item('i1')]);

    const r2 = arrival(item('i2'), n, r1.newState, [overflowEdge], edge('e0', 'src', 'buf'), makeItemId);
    expect(r2.accepted).not.toBe(false);
    expect(r2.actions).toEqual([{ type: 'forward', edgeId: 'eOverflow', item: item('i2') }]);
    // The buffer's own queue is untouched by the diverted item.
    expect(r2.newState.queue).toEqual([item('i1')]);
  });

  it('tryDrain releases one queued item per tick onto an active output edge', () => {
    const n = node('buf', 'buffer', { capacity: 10, outputPort: 0 });
    const outEdge = edge('eOut', 'buf', 'snk', { sourcePort: 0 });
    const r1 = arrival(item('i1'), n, {}, [outEdge], edge('e0', 'src', 'buf'), makeItemId);
    const r2 = arrival(item('i2'), n, r1.newState, [outEdge], edge('e0', 'src', 'buf'), makeItemId);

    const d1 = drain(n, r2.newState, [outEdge], 1, makeItemId);
    expect(d1.actions).toEqual([{ type: 'forward', edgeId: 'eOut', item: item('i1') }]);
    expect((d1.newState.queue as Item[]).length).toBe(1);

    const d2 = drain(n, d1.newState, [outEdge], 1, makeItemId);
    expect(d2.actions).toEqual([{ type: 'forward', edgeId: 'eOut', item: item('i2') }]);
    expect((d2.newState.queue as Item[]).length).toBe(0);
  });

  it('tryDrain is a no-op when no active output edge exists (holds the queue)', () => {
    const n = node('buf', 'buffer', { capacity: 10, outputPort: 0 });
    const r1 = arrival(item('i1'), n, {}, [], edge('e0', 'src', 'buf'), makeItemId);
    const d1 = drain(n, r1.newState, [], 1, makeItemId);
    expect(d1.actions).toHaveLength(0);
    expect(d1.newState.queue).toEqual([item('i1')]);
  });

  /** Silo↔Sensor copper wiring/docking (design doc §5.7, 2026-09-09
   * follow-up) means a Buffer can now legitimately have a
   * `edgeKind: 'signal'` edge alongside its real item outputs — these
   * two tests are the fix for the exact class of bug the Gate docking
   * bug was (see App.tsx's handleDockNodes doc comment): a real item
   * must never be routable onto that copper edge no matter what
   * sourcePort it happens to share, or it gets stuck forever (a
   * Sensor has no onItemArrival at all). */
  it('tryDrain never selects a signal-kind edge as its real output, even sharing the same sourcePort', () => {
    const n = node('buf', 'buffer', { capacity: 10, outputPort: 0 });
    const watchEdge: EdgeDef = { ...edge('toSensor', 'buf', 'sensor', { sourcePort: 0 }), edgeKind: 'signal' };
    const r1 = arrival(item('i1'), n, {}, [watchEdge], edge('e0', 'src', 'buf'), makeItemId);
    const d1 = drain(n, r1.newState, [watchEdge], 1, makeItemId);
    expect(d1.actions).toHaveLength(0); // no real output available -- holds the queue, never forwards onto the copper edge
    expect(d1.newState.queue).toEqual([item('i1')]);
  });

  /** Docked Silo chains (design doc §5.8, 2026-09-09 follow-up —
   * Falcon, testing a chain of docked Silos: "only the last silo gets
   * filled then the rest never get filled no matter how many items
   * already passed through"). Root cause: tryDrain used to dequeue and
   * forward with no idea whether the target Buffer had room -- fine
   * for an ordinary edge (a refused item just visibly parks at
   * progress 1 outside the target), but a dock edge's huge flowRate
   * plus FluxCanvas hiding dock-edge item tokens meant a refused item
   * vanished forever: gone from the draining Silo's own queue already,
   * never reflected in the target's queue either. */
  it('holds its queue (does not dequeue) when the immediate downstream Buffer is already at capacity', () => {
    const n = node('buf', 'buffer', { capacity: 10, outputPort: 0 });
    const outEdge = edge('eOut', 'buf', 'fullTarget', { sourcePort: 0 });
    const ctx = {
      getNode: () => node('fullTarget', 'buffer', { capacity: 2 }),
      getNodeState: () => ({ queue: [item('a'), item('b')] }), // already at its capacity of 2
    };
    const r1 = arrival(item('i1'), n, {}, [outEdge], edge('e0', 'src', 'buf'), makeItemId);
    const d1 = drain(n, r1.newState, [outEdge], 1, makeItemId, ctx);
    expect(d1.actions).toHaveLength(0);
    expect(d1.newState.queue).toEqual([item('i1')]); // still queued, never dequeued into limbo
  });

  it('drains normally once the downstream Buffer has room again', () => {
    const n = node('buf', 'buffer', { capacity: 10, outputPort: 0 });
    const outEdge = edge('eOut', 'buf', 'target', { sourcePort: 0 });
    const ctx = {
      getNode: () => node('target', 'buffer', { capacity: 2 }),
      getNodeState: () => ({ queue: [item('a')] }), // 1 of 2 -- room for one more
    };
    const r1 = arrival(item('i1'), n, {}, [outEdge], edge('e0', 'src', 'buf'), makeItemId);
    const d1 = drain(n, r1.newState, [outEdge], 1, makeItemId, ctx);
    expect(d1.actions).toEqual([{ type: 'forward', edgeId: 'eOut', item: item('i1') }]);
    expect(d1.newState.queue).toEqual([]);
  });

  it('the downstream-capacity peek only applies to buffer targets -- a non-buffer target always drains eagerly', () => {
    const n = node('buf', 'buffer', { capacity: 10, outputPort: 0 });
    const outEdge = edge('eOut', 'buf', 'snk', { sourcePort: 0 });
    const ctx = { getNode: () => node('snk', 'sink'), getNodeState: () => undefined };
    const r1 = arrival(item('i1'), n, {}, [outEdge], edge('e0', 'src', 'buf'), makeItemId);
    const d1 = drain(n, r1.newState, [outEdge], 1, makeItemId, ctx);
    expect(d1.actions).toEqual([{ type: 'forward', edgeId: 'eOut', item: item('i1') }]);
  });

  it('overflowPolicy "divert" never diverts onto a signal-kind edge sharing the overflow sourcePort', () => {
    const n = node('buf', 'buffer', { capacity: 1, overflowPolicy: 'divert', overflowPort: 1 });
    const watchEdge: EdgeDef = { ...edge('toSensor', 'buf', 'sensor', { sourcePort: 1 }), edgeKind: 'signal' };
    const r1 = arrival(item('i1'), n, {}, [watchEdge], edge('e0', 'src', 'buf'), makeItemId);
    const r2 = arrival(item('i2'), n, r1.newState, [watchEdge], edge('e0', 'src', 'buf'), makeItemId);
    expect(r2.accepted).toBe(false); // no real overflow edge available -- backpressure, never onto the copper edge
    expect(r2.newState.queue).toEqual([item('i1')]);
  });

  it('SimEngine integration: conserves items end-to-end (spawned === consumed + inFlight + buffered)', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 1, itemType: 'widget' }));
    graph.addNode(node('buf', 'buffer', { capacity: 3, outputPort: 0 }));
    graph.addNode(node('snk', 'sink'));
    graph.addEdge(edge('e0', 'src', 'buf', { flowRate: 0.5 }));
    graph.addEdge(edge('e1', 'buf', 'snk', { flowRate: 0.34 }));

    const engine = new SimEngine(graph);
    let spawned = 0;
    let consumed = 0;
    for (let i = 0; i < 200; i++) {
      engine.tick(1);
      for (const event of engine.drainEvents()) {
        if (event.kind === 'spawned') spawned += 1;
        if (event.kind === 'consumed') consumed += 1;
      }
    }

    const inFlight = engine.getItemsInFlight().length;
    const buffered = (engine.getNodeState('buf')?.queue as unknown[] | undefined)?.length ?? 0;
    expect(spawned).toBe(consumed + inFlight + buffered);
    expect(spawned).toBeGreaterThan(0);
    expect(consumed).toBeGreaterThan(0);
  });

  /** SimEngine-level version of the docked-Silo-chain regression above
   * — a real graph, not just a direct handler call. A capacity-limited
   * chain of 4 docked Silos, the last one a true dead end, reproduces
   * Falcon's exact screenshot: before the targetBufferIsFull peek in
   * tryDrain, this ended with siloSource/silo2/silo3 all reading 0 and
   * 17 of the 20 seeded items permanently stuck invisible in flight —
   * confirmed empirically against the pre-fix buffer.ts. */
  it('a chain of 4 docked Silos fills each one to its own capacity, cascading backward, with nothing stuck invisibly in flight', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0, itemType: 'widget' }));
    graph.addNode(node('siloSource', 'buffer', { capacity: 250 }));
    graph.addNode(node('silo2', 'buffer', { capacity: 3 }));
    graph.addNode(node('silo3', 'buffer', { capacity: 3 }));
    graph.addNode(node('silo4', 'buffer', { capacity: 3 })); // dead end -- no edge beyond it
    graph.addEdge(edge('src->siloSource', 'src', 'siloSource', { flowRate: 5 }));
    graph.addEdge({ ...edge('siloSource->silo2', 'siloSource', 'silo2'), flowRate: 1000, edgeKind: 'dock' });
    graph.addEdge({ ...edge('silo2->silo3', 'silo2', 'silo3'), flowRate: 1000, edgeKind: 'dock' });
    graph.addEdge({ ...edge('silo3->silo4', 'silo3', 'silo4'), flowRate: 1000, edgeKind: 'dock' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 100; i++) engine.tick(0.05);

    const q = (id: string) => ((engine.getNodeState(id)?.queue as Item[] | undefined)?.length ?? 0);
    expect(q('silo2')).toBe(3);
    expect(q('silo3')).toBe(3);
    expect(q('silo4')).toBe(3);
    // Before the fix, siloSource eagerly forwarded everything and ended
    // up empty (0) with the rest permanently stuck invisible in flight
    // instead of held here — a nonzero backlog is exactly the visible
    // "this Silo is backed up" feedback that was missing.
    expect(q('siloSource')).toBeGreaterThan(0);
  });
});

describe('distributor + sorter SimEngine integration', () => {
  it('round-robins end-to-end and both sinks eventually consume a comparable share', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0, itemType: 'widget' }));
    graph.addNode(node('dist', 'distributor'));
    graph.addNode(node('snkA', 'sink'));
    graph.addNode(node('snkB', 'sink'));
    graph.addEdge(edge('e0', 'src', 'dist'));
    graph.addEdge(edge('eA', 'dist', 'snkA', { sourcePort: 0 }));
    graph.addEdge(edge('eB', 'dist', 'snkB', { sourcePort: 1 }));

    const engine = new SimEngine(graph);
    for (let i = 0; i < 30; i++) engine.tick(1);

    const a = (engine.getNodeState('snkA')?.consumedCount as number) ?? 0;
    const b = (engine.getNodeState('snkB')?.consumedCount as number) ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it('2026-09-10 regression: stops routing into a full downstream buffer instead of accepting endlessly', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0, itemType: 'widget', active: true }));
    graph.addNode(node('dist', 'distributor'));
    graph.addNode(node('buf', 'buffer', { capacity: 3 }));
    graph.addEdge(edge('e0', 'src', 'dist'));
    graph.addEdge(edge('e1', 'dist', 'buf', { sourcePort: 0 }));

    const engine = new SimEngine(graph);
    for (let i = 0; i < 30; i++) engine.tick(1);

    // The buffer's own capacity must never be exceeded, and the
    // distributor must have stopped accepting once it was full rather
    // than continuing to route into it every tick.
    expect((engine.getNodeState('buf')?.queue as unknown[] | undefined)?.length ?? 0).toBeLessThanOrEqual(3);
    const routedWhileFull = (engine.getNodeState('dist')?.routedCount as number) ?? 0;
    expect(routedWhileFull).toBeLessThanOrEqual(3);

    for (let i = 0; i < 20; i++) engine.tick(1); // buffer stays full, nothing drains it
    expect((engine.getNodeState('dist')?.routedCount as number) ?? 0).toBe(routedWhileFull);
  });
});

describe('merger SimEngine integration', () => {
  it('two sources merge into one sink with items conserved end-to-end (the mirror of the distributor test above)', () => {
    const graph = new GraphModel();
    graph.addNode(node('srcA', 'source', { cooldown: 0, itemType: 'widget' }));
    graph.addNode(node('srcB', 'source', { cooldown: 0, itemType: 'widget' }));
    graph.addNode(node('merge', 'merger'));
    graph.addNode(node('snk', 'sink'));
    graph.addEdge(edge('eA', 'srcA', 'merge', { sourcePort: 0 }));
    graph.addEdge(edge('eB', 'srcB', 'merge', { sourcePort: 0 }));
    graph.addEdge(edge('eOut', 'merge', 'snk'));

    const engine = new SimEngine(graph);
    let spawned = 0;
    let consumed = 0;
    for (let i = 0; i < 30; i++) {
      engine.tick(1);
      for (const event of engine.drainEvents()) {
        if (event.kind === 'spawned') spawned += 1;
        if (event.kind === 'consumed') consumed += 1;
      }
    }

    const inFlight = engine.getItemsInFlight().length;
    expect(spawned).toBe(consumed + inFlight); // merger holds nothing of its own, unlike buffer
    expect(spawned).toBeGreaterThan(0);
    expect(consumed).toBeGreaterThan(0);
    // Both sources actually fed the merger — not just one of them.
    expect((engine.getNodeState('srcA')?.spawnedCount as number) ?? 0).toBeGreaterThan(0);
    expect((engine.getNodeState('srcB')?.spawnedCount as number) ?? 0).toBeGreaterThan(0);
  });
});

/**
 * Trigger system (design doc §4.8, §5.5, 2026-09-09 node-design
 * session). Gate/Sensor are a distinct pair from the six kinds above:
 * Gate has only onItemArrival (no per-tick hook), Sensor has only
 * evaluateSignals (no onItemArrival at all — see portCapacity's
 * maxInputs: 0). A 'signal' Action never becomes an in-flight item;
 * SimEngine writes it straight into the TARGET node's runtime state.
 */
describe('gate', () => {
  const handler = nodeHandlers.gate!.onItemArrival!;
  const outEdge = edge('out', 'g', 'sink');

  it('refuses an arrival while closed (default: no state.open at all)', () => {
    const result = handler(item('i1'), node('g', 'gate'), {}, [outEdge], edge('in', 'src', 'g'), makeItemId);
    expect(result.accepted).toBe(false);
  });

  it('refuses an arrival while explicitly closed', () => {
    const result = handler(item('i1'), node('g', 'gate'), { open: false }, [outEdge], edge('in', 'src', 'g'), makeItemId);
    expect(result.accepted).toBe(false);
  });

  it('forwards immediately while open, and counts it', () => {
    const result = handler(item('i1'), node('g', 'gate'), { open: true }, [outEdge], edge('in', 'src', 'g'), makeItemId);
    expect(result.accepted).not.toBe(false);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'out', item: item('i1') }]);
    expect(result.newState.forwardedCount).toBe(1);
  });

  it('refuses when open but no physical output edge exists', () => {
    const result = handler(item('i1'), node('g', 'gate'), { open: true }, [], edge('in', 'src', 'g'), makeItemId);
    expect(result.accepted).toBe(false);
  });

  it('ignores a signal-kind edge as a physical forwarding target', () => {
    const signalOnly = edge('sig', 'g', 'sensor2', { }) as EdgeDef;
    (signalOnly as EdgeDef).edgeKind = 'signal';
    const result = handler(item('i1'), node('g', 'gate'), { open: true }, [signalOnly], edge('in', 'src', 'g'), makeItemId);
    expect(result.accepted).toBe(false);
  });
});

describe('sensor', () => {
  const handler = nodeHandlers.sensor!.evaluateSignals!;
  // `inputEdges` defaults to [] (no auto-watch wiring) so every
  // pre-existing test below — none of which pass it — keeps exercising
  // the legacy config.watchNodeId fallback path exactly as before the
  // auto-watch follow-up (design doc §5.7) existed.
  const ctx = (states: Record<string, Record<string, unknown>>, inputEdges: EdgeDef[] = []) => ({
    getNode: () => undefined,
    getNodeState: (id: string) => states[id],
    getInputEdges: () => inputEdges,
  });
  const signalEdge = (id: string, active = true): EdgeDef => ({ ...edge(id, 's', 'g', { active }), edgeKind: 'signal' });

  it('defaults to an always-true condition (0 >= 0) when unconfigured', () => {
    const result = handler(node('s', 'sensor'), {}, [signalEdge('a')], 0.1, makeItemId, ctx({}));
    expect(result.actions).toEqual([{ type: 'signal', edgeId: 'a', value: true }]);
    expect(result.newState).toMatchObject({ lastValue: 0, lastConditionMet: true });
  });

  it('reads the watched node\'s queue length as its metric', () => {
    const cfg = { watchNodeId: 'silo', metric: 'queueLength', comparator: 'gte', threshold: 2 };
    const result = handler(node('s', 'sensor', cfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ silo: { queue: [1, 2, 3] } }));
    expect(result.newState.lastValue).toBe(3);
    expect(asSignal(result.actions[0]!).value).toBe(true);
  });

  it.each([
    ['gte', 5, 5, true], ['gte', 4, 5, false],
    ['lte', 5, 5, true], ['lte', 6, 5, false],
    ['gt', 6, 5, true], ['gt', 5, 5, false],
    ['lt', 4, 5, true], ['lt', 5, 5, false],
    ['eq', 5, 5, true], ['eq', 4, 5, false],
  ] as Array<[string, number, number, boolean]>)(
    'comparator %s: len=%i vs threshold=%i => %s',
    (comparator: string, len: number, threshold: number, expected: boolean) => {
      const cfg = { watchNodeId: 'w', metric: 'queueLength', comparator, threshold };
      const result = handler(node('s', 'sensor', cfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: new Array(len).fill(0) } }));
      expect(asSignal(result.actions[0]!).value).toBe(expected);
    },
  );

  it('broadcasts to every active signal edge and skips inactive ones and plain item edges', () => {
    const cfg = { watchNodeId: 'w', metric: 'queueLength', comparator: 'gte', threshold: 1 };
    const outs: EdgeDef[] = [signalEdge('a'), signalEdge('b'), signalEdge('c', false), edge('d', 's', 'g')];
    const result = handler(node('s', 'sensor', cfg), {}, outs, 0.1, makeItemId, ctx({ w: { queue: [1] } }));
    expect(result.actions.map((a) => asSignal(a).edgeId).sort()).toEqual(['a', 'b']);
  });

  it('reads 0 for an unrecognized metric or a missing watchNodeId', () => {
    const missingMetric = handler(
      node('s', 'sensor', { watchNodeId: 'w', metric: 'somethingElse', comparator: 'eq', threshold: 0 }),
      {}, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: [1, 2, 3] } }),
    );
    expect(missingMetric.newState.lastValue).toBe(0);

    const missingWatch = handler(
      node('s', 'sensor', { comparator: 'eq', threshold: 0 }),
      {}, [signalEdge('a')], 0.1, makeItemId, ctx({}),
    );
    expect(missingWatch.newState.lastValue).toBe(0);
  });

  /** 'count' metric (2026-09-10 follow-up, added alongside the Counter
   * node) — reads a watched node's `state.count` instead of its
   * `queue.length`, same shape as 'queueLength' otherwise. */
  it("reads the watched node's count as its metric", () => {
    const cfg = { watchNodeId: 'counter1', metric: 'count', comparator: 'gte', threshold: 3 };
    const belowThreshold = handler(node('s', 'sensor', cfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ counter1: { count: 2 } }));
    expect(belowThreshold.newState.lastValue).toBe(2);
    expect(asSignal(belowThreshold.actions[0]!).value).toBe(false);

    const atThreshold = handler(node('s', 'sensor', cfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ counter1: { count: 3 } }));
    expect(atThreshold.newState.lastValue).toBe(3);
    expect(asSignal(atThreshold.actions[0]!).value).toBe(true);
  });

  /** Auto-watch (design doc §5.7, 2026-09-09 follow-up — "the sensor
   * nodes should auto-watch the node it is connected to or docked
   * to"): an incoming edgeKind: 'signal' edge into this Sensor names
   * the watched node via its SOURCE, taking priority over the manual
   * config.watchNodeId dropdown whenever at least one exists. */
  describe('auto-watch from incoming copper edges', () => {
    const watchEdge = (id: string, source: string, active = true): EdgeDef => ({
      ...edge(id, source, 's', { active }),
      edgeKind: 'signal',
    });

    it('derives the watched node from a single incoming signal edge, ignoring config.watchNodeId', () => {
      const cfg = { watchNodeId: 'decoy', metric: 'queueLength', comparator: 'gte', threshold: 2 };
      const result = handler(
        node('s', 'sensor', cfg), {}, [signalEdge('out')], 0.1, makeItemId,
        ctx({ silo: { queue: [1, 2, 3] }, decoy: { queue: [] } }, [watchEdge('in', 'silo')]),
      );
      expect(result.newState.lastValue).toBe(3);
      expect(asSignal(result.actions[0]!).value).toBe(true);
    });

    it('OR-combines multiple watched nodes — fires if ANY of them meets the shared condition', () => {
      const cfg = { metric: 'queueLength', comparator: 'gte', threshold: 3 };
      const inputs = [watchEdge('inA', 'siloA'), watchEdge('inB', 'siloB')];

      const neitherMet = handler(
        node('s', 'sensor', cfg), {}, [signalEdge('out')], 0.1, makeItemId,
        ctx({ siloA: { queue: [1] }, siloB: { queue: [1] } }, inputs),
      );
      expect(asSignal(neitherMet.actions[0]!).value).toBe(false);

      const oneMet = handler(
        node('s', 'sensor', cfg), {}, [signalEdge('out')], 0.1, makeItemId,
        ctx({ siloA: { queue: [1] }, siloB: { queue: [1, 2, 3] } }, inputs),
      );
      expect(asSignal(oneMet.actions[0]!).value).toBe(true);
    });

    it('ignores an inactive incoming edge and a plain (non-signal) incoming edge as a watch source', () => {
      const cfg = { metric: 'queueLength', comparator: 'gte', threshold: 1 };
      const inputs: EdgeDef[] = [
        watchEdge('inactive', 'siloA', false),
        edge('plain', 'siloB', 's'), // no edgeKind -- an ordinary item edge, not a watch source
      ];
      const result = handler(
        node('s', 'sensor', cfg), {}, [signalEdge('out')], 0.1, makeItemId,
        ctx({ siloA: { queue: [1] }, siloB: { queue: [1] } }, inputs),
      );
      // Neither counts as a watch source, so this falls back to the
      // "no watched node" always-evaluate-against-0 default.
      expect(result.newState.lastValue).toBe(0);
    });

    it('falls back to config.watchNodeId when ctx.getInputEdges is absent (older/simpler call sites)', () => {
      const cfg = { watchNodeId: 'w', metric: 'queueLength', comparator: 'gte', threshold: 2 };
      const noInputEdgesCtx = { getNode: () => undefined, getNodeState: (id: string) => ({ w: { queue: [1, 2] } })[id] };
      const result = handler(node('s', 'sensor', cfg), {}, [signalEdge('out')], 0.1, makeItemId, noInputEdgesCtx);
      expect(result.newState.lastValue).toBe(2);
      expect(asSignal(result.actions[0]!).value).toBe(true);
    });
  });

  /** Test pulse (2026-09-10 follow-up — Falcon: "i want sensor node
   * with a temporary activate button for temporary and testing
   * purposes[,] this transmit power temporarily"): PropertiesPanel's
   * "Force ON" button bumps `config.testPulseSeq`; these tests set it
   * directly, same as every other config-driven behavior in this file. */
  describe('test pulse', () => {
    const falseCfg = { watchNodeId: 'w', metric: 'queueLength', comparator: 'eq', threshold: 999 }; // never true for real

    it('a fresh testPulseSeq bump forces conditionMet=true even when the real condition reads false', () => {
      const cfg = { ...falseCfg, testPulseSeq: 1 };
      const result = handler(node('s', 'sensor', cfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: [1] } }));
      expect(asSignal(result.actions[0]!).value).toBe(true);
      expect(result.newState.testPulseRemaining).toBeCloseTo(2 - 0.1, 5); // default duration is 2s
    });

    it('respects a configured testPulseDuration instead of the 2s default', () => {
      const cfg = { ...falseCfg, testPulseSeq: 1, testPulseDuration: 5 };
      const result = handler(node('s', 'sensor', cfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: [1] } }));
      expect(result.newState.testPulseRemaining).toBeCloseTo(5 - 0.1, 5);
    });

    it('counts down every tick and reverts to the real (false) condition once it expires', () => {
      const cfg = { ...falseCfg, testPulseSeq: 1, testPulseDuration: 0.3 };
      let state: Record<string, unknown> = {};
      let lastValue: boolean | undefined;
      for (let i = 0; i < 5; i++) {
        const result = handler(node('s', 'sensor', cfg), state, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: [1] } }));
        state = result.newState;
        lastValue = asSignal(result.actions[0]!).value;
      }
      // 5 ticks * 0.1s = 0.5s, past the 0.3s pulse -- back to the real
      // (never-true) condition.
      expect(lastValue).toBe(false);
      expect(state.testPulseRemaining).toBe(0);
    });

    it('pressing again while a pulse is still counting down restarts the timer instead of stacking', () => {
      const cfg1 = { ...falseCfg, testPulseSeq: 1, testPulseDuration: 1 };
      const first = handler(node('s', 'sensor', cfg1), {}, [signalEdge('a')], 0.5, makeItemId, ctx({ w: { queue: [1] } }));
      expect(first.newState.testPulseRemaining).toBeCloseTo(0.5, 5); // 1s - 0.5s elapsed

      // A second press (bumped seq) with only 0.5s left on the clock --
      // restarts at the full 1s rather than adding on top.
      const cfg2 = { ...falseCfg, testPulseSeq: 2, testPulseDuration: 1 };
      const second = handler(node('s', 'sensor', cfg2), first.newState, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: [1] } }));
      expect(second.newState.testPulseRemaining).toBeCloseTo(0.9, 5); // 1s - 0.1s, not 0.4s
      expect(asSignal(second.actions[0]!).value).toBe(true);
    });

    it('testPulseSeq at its default (0, never pressed) never overrides the real condition', () => {
      const result = handler(node('s', 'sensor', falseCfg), {}, [signalEdge('a')], 0.1, makeItemId, ctx({ w: { queue: [1] } }));
      expect(asSignal(result.actions[0]!).value).toBe(false);
      expect(result.newState.testPulseRemaining).toBe(0);
    });
  });
});

describe('gate + sensor: SimEngine integration', () => {
  it('an always-true Sensor lets items flow end-to-end through a Gate, with exact conservation', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.2, itemType: 'widget' }));
    graph.addNode(node('gate', 'gate'));
    graph.addNode(node('sink', 'sink'));
    graph.addNode(node('sensor', 'sensor', { comparator: 'gte', threshold: 0 }));
    graph.addEdge(edge('src->gate', 'src', 'gate', { flowRate: 2 }));
    graph.addEdge(edge('gate->sink', 'gate', 'sink', { flowRate: 2 }));
    graph.addEdge({ ...edge('sensor->gate', 'sensor', 'gate', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 200; i++) engine.tick(0.05);

    const sinkState = engine.getNodeState('sink');
    const gateState = engine.getNodeState('gate');
    const stillBetween = engine.getItemsInFlight().filter((f) => f.edgeId === 'gate->sink').length;

    expect(gateState?.open).toBe(true);
    expect((sinkState?.consumedCount as number) ?? 0).toBeGreaterThan(0);
    expect(gateState?.forwardedCount).toBe(((sinkState?.consumedCount as number) ?? 0) + stillBetween);
  });

  it('a Gate wired to zero Sensors can never open, by construction — items back up, none reach the sink', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.2, itemType: 'widget' }));
    graph.addNode(node('gate', 'gate'));
    graph.addNode(node('sink', 'sink'));
    graph.addEdge(edge('src->gate', 'src', 'gate', { flowRate: 2 }));
    graph.addEdge(edge('gate->sink', 'gate', 'sink', { flowRate: 2 }));

    const engine = new SimEngine(graph);
    for (let i = 0; i < 200; i++) engine.tick(0.05);

    expect(engine.getNodeState('gate')?.open).not.toBe(true);
    expect(engine.getNodeState('sink')).toBeUndefined();
    expect(engine.getItemsInFlight().length).toBeGreaterThan(0);
  });

  it("a 'signal' action writes the TARGET gate's state, never the emitting sensor's, and only to active signal edges", () => {
    const graph = new GraphModel();
    graph.addNode(node('sensor', 'sensor', { comparator: 'gte', threshold: 0 }));
    graph.addNode(node('gateA', 'gate'));
    graph.addNode(node('gateB', 'gate'));
    graph.addEdge({ ...edge('sensor->A', 'sensor', 'gateA', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('sensor->B', 'sensor', 'gateB', { flowRate: 0, active: false }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    engine.tick(0.05);

    expect(engine.getNodeState('sensor')?.open).toBeUndefined();
    expect(engine.getNodeState('gateA')?.open).toBe(true);
    expect(engine.getNodeState('gateB')).toBeUndefined();
  });
});

/**
 * Counter (2026-09-10 — Falcon: "a new counter node this node only
 * acts as a counter like it only counts what pass to it unlike
 * buffer/silo that stores items"): onItemArrival forwards immediately
 * and counts, subject to the same downstream-capacity check
 * distributor/buffer already use; onTick handles the config-token
 * reset (see counter.ts's and contract.ts's own doc comments).
 */
describe('counter', () => {
  const handler = nodeHandlers.counter!.onItemArrival!;
  const onTick = nodeHandlers.counter!.onTick!;
  const outEdge = edge('out', 'c', 'sink');
  const ctxFor = (states: Record<string, Record<string, unknown>>, nodes: Record<string, NodeDef>) => ({
    getNode: (id: string) => nodes[id],
    getNodeState: (id: string) => states[id],
  });

  it('forwards an arrival immediately and increments count from 0', () => {
    const result = handler(item('i1'), node('c', 'counter'), {}, [outEdge], edge('in', 'src', 'c'), makeItemId, ctxFor({}, {}));
    expect(result.accepted).not.toBe(false);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'out', item: item('i1') }]);
    expect(result.newState.count).toBe(1);
  });

  it('keeps incrementing count across repeated arrivals', () => {
    let state: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      const result = handler(item(`i${i}`), node('c', 'counter'), state, [outEdge], edge('in', 'src', 'c'), makeItemId, ctxFor({}, {}));
      state = result.newState;
    }
    expect(state.count).toBe(5);
  });

  it('refuses when no physical output edge exists (signal-only edges ignored), without incrementing', () => {
    const signalOnly = { ...edge('sig', 'c', 'sensor2'), edgeKind: 'signal' as const };
    const result = handler(item('i1'), node('c', 'counter'), { count: 2 }, [signalOnly], edge('in', 'src', 'c'), makeItemId, ctxFor({}, {}));
    expect(result.accepted).toBe(false);
    expect(result.newState.count).toBe(2);
  });

  it("refuses when the downstream target is a full buffer — same targetBufferIsFull guard distributor uses — without incrementing", () => {
    const nodes = { buf: node('buf', 'buffer', { capacity: 2 }) };
    const states = { buf: { queue: [item('x'), item('y')] } };
    const result = handler(
      item('i1'), node('c', 'counter'), { count: 2 }, [edge('out', 'c', 'buf')], edge('in', 'src', 'c'), makeItemId,
      ctxFor(states, nodes),
    );
    expect(result.accepted).toBe(false);
    expect(result.newState.count).toBe(2);
  });

  it('forwards again once the downstream buffer has room, incrementing count on that acceptance', () => {
    const nodes = { buf: node('buf', 'buffer', { capacity: 2 }) };
    const states = { buf: { queue: [item('x')] } };
    const result = handler(
      item('i1'), node('c', 'counter'), { count: 2 }, [edge('out', 'c', 'buf')], edge('in', 'src', 'c'), makeItemId,
      ctxFor(states, nodes),
    );
    expect(result.accepted).not.toBe(false);
    expect(result.newState.count).toBe(3);
  });

  it('onTick leaves count untouched while resetSeq matches what was last applied', () => {
    const result = onTick(node('c', 'counter', { resetSeq: 0 }), { count: 4, lastResetSeq: 0 }, [], 0.1, makeItemId);
    expect(result.newState.count).toBe(4);
  });

  it('onTick zeroes count exactly once when resetSeq is bumped, then leaves it alone on later ticks', () => {
    const first = onTick(node('c', 'counter', { resetSeq: 1 }), { count: 7, lastResetSeq: 0 }, [], 0.1, makeItemId);
    expect(first.newState.count).toBe(0);
    expect(first.newState.lastResetSeq).toBe(1);

    // A later tick, count has since risen again from real arrivals —
    // resetSeq hasn't changed again, so onTick must not re-zero it.
    const second = onTick(node('c', 'counter', { resetSeq: 1 }), { count: 3, lastResetSeq: 1 }, [], 0.1, makeItemId);
    expect(second.newState.count).toBe(3);
  });

  it('onTick treats an unset resetSeq/lastResetSeq as 0 on both sides — a freshly placed Counter never self-resets', () => {
    const result = onTick(node('c', 'counter'), { count: 6 }, [], 0.1, makeItemId);
    expect(result.newState.count).toBe(6);
  });

  /**
   * Command-driven reset (2026-09-10, same-day follow-up — Falcon,
   * after asking why a Sensor+Command pair stopped a Source: "i want
   * it to count only role and can manually be resetable or by a
   * command when docked with command"): `state.open` is written the
   * exact same generic way a Command's relayed signal writes into
   * Source/Gate/Command's own `open` — these tests set it directly,
   * same as the resetSeq tests above set `config.resetSeq` directly,
   * with no SimEngine/Command involved.
   */
  it('onTick resets count on the RISING edge of an incoming Command signal (open: false -> true)', () => {
    const result = onTick(node('c', 'counter'), { count: 4, open: true, lastCommandOpen: false }, [], 0.1, makeItemId);
    expect(result.newState.count).toBe(0);
    expect(result.newState.lastCommandOpen).toBe(true);
  });

  it('onTick does NOT re-reset while the incoming Command signal stays true across ticks', () => {
    const first = onTick(node('c', 'counter'), { count: 4, open: true, lastCommandOpen: false }, [], 0.1, makeItemId);
    expect(first.newState.count).toBe(0);
    // A later tick: real arrivals have since ticked count back up, the
    // Command's signal is STILL true (level-based, re-emitted every
    // tick) — onTick must not re-zero it again.
    const second = onTick(node('c', 'counter'), { ...first.newState, count: 3 }, [], 0.1, makeItemId);
    expect(second.newState.count).toBe(3);
  });

  it('onTick does nothing when the incoming Command signal reads false (or is absent) — only a RISING edge to true resets', () => {
    const neverWired = onTick(node('c', 'counter'), { count: 4 }, [], 0.1, makeItemId);
    expect(neverWired.newState.count).toBe(4);

    const commandedFalse = onTick(node('c', 'counter'), { count: 4, open: false, lastCommandOpen: true }, [], 0.1, makeItemId);
    expect(commandedFalse.newState.count).toBe(4);
    expect(commandedFalse.newState.lastCommandOpen).toBe(false);
  });

  it('onTick resets again on a SECOND rising edge, after the signal has gone back to false in between', () => {
    // false -> true (reset #1)
    const first = onTick(node('c', 'counter'), { count: 4, open: true, lastCommandOpen: false }, [], 0.1, makeItemId);
    expect(first.newState.count).toBe(0);
    // true -> false (no reset, just tracks the new value)
    const middle = onTick(node('c', 'counter'), { ...first.newState, count: 2, open: false }, [], 0.1, makeItemId);
    expect(middle.newState.count).toBe(2);
    expect(middle.newState.lastCommandOpen).toBe(false);
    // false -> true again (reset #2)
    const second = onTick(node('c', 'counter'), { ...middle.newState, count: 2, open: true }, [], 0.1, makeItemId);
    expect(second.newState.count).toBe(0);
  });

  it('a manual resetSeq bump and a Command rising edge on the same tick both still just zero the count once', () => {
    const result = onTick(
      node('c', 'counter', { resetSeq: 1 }),
      { count: 9, lastResetSeq: 0, open: true, lastCommandOpen: false },
      [], 0.1, makeItemId,
    );
    expect(result.newState.count).toBe(0);
    expect(result.newState.lastResetSeq).toBe(1);
    expect(result.newState.lastCommandOpen).toBe(true);
  });
});

/**
 * Command (2026-09-10, same-day follow-up — Falcon: "sensor node only
 * senses and triggers signal[,] the command node is the one has
 * command on it"): a pure signal relay unit-tested the same way
 * Sensor's own evaluateSignals is above — precise control over state/
 * edges, no tick-timing choreography needed.
 */
describe('command', () => {
  const handler = nodeHandlers.command!.evaluateSignals!;
  const signalEdge = (id: string, active = true): EdgeDef => ({ ...edge(id, 'cmd', 'src', { active }), edgeKind: 'signal' });

  it('defaults to commanded=true (no effect until commanded) before it has ever received a signal', () => {
    const result = handler(node('cmd', 'command'), {}, [signalEdge('out')], 0.1, makeItemId);
    expect(result.actions).toEqual([{ type: 'signal', edgeId: 'out', value: true }]);
  });

  it('relays a received state.open === false as commanded=false', () => {
    const result = handler(node('cmd', 'command'), { open: false }, [signalEdge('out')], 0.1, makeItemId);
    expect(asSignal(result.actions[0]!).value).toBe(false);
  });

  it('relays a received state.open === true as commanded=true', () => {
    const result = handler(node('cmd', 'command'), { open: true }, [signalEdge('out')], 0.1, makeItemId);
    expect(asSignal(result.actions[0]!).value).toBe(true);
  });

  it('broadcasts to every active signal edge and skips inactive ones and plain item edges', () => {
    const outs: EdgeDef[] = [signalEdge('a'), signalEdge('b'), signalEdge('c', false), edge('d', 'cmd', 'src')];
    const result = handler(node('cmd', 'command'), { open: false }, outs, 0.1, makeItemId);
    expect(result.actions.map((a) => asSignal(a).edgeId).sort()).toEqual(['a', 'b']);
  });

  it('re-emits every tick unconditionally (level-based, not a one-shot pulse)', () => {
    const first = handler(node('cmd', 'command'), { open: false }, [signalEdge('out')], 0.1, makeItemId);
    const second = handler(node('cmd', 'command'), first.newState, [signalEdge('out')], 0.1, makeItemId);
    expect(asSignal(second.actions[0]!).value).toBe(false);
  });
});

/**
 * Source signal-gating + Counter + Command, end-to-end (2026-09-10 —
 * Falcon: "i want to add additional feature to source node like it
 * will deactivate by using sensor nodes condition like say a new
 * counter node"; revised the SAME day: "sensor node only senses and
 * triggers signal[,] the command node is the one has command on it
 * ... if a command node receives a signal it will do a command to the
 * node attached to it say source node"): the full chain the feature
 * exists for — a Counter tallies what a Source produces, a Sensor
 * watches that count and signals, and a Command node relays that
 * signal onward to actually activate/deactivate the Source. A Sensor
 * is never wired straight to a Source any more (App.tsx's
 * isSourceSignalTarget now requires the edge's source be a 'command'
 * node) — every test below that used to wire Sensor->Source directly
 * now wires Sensor->Command->Source instead.
 */
describe('source signal gate + counter + command: SimEngine integration', () => {
  it('an unwired source is completely unaffected — default state.open is OPEN, not closed like Gate', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.1, itemType: 'widget' }));
    graph.addNode(node('sink', 'sink'));
    graph.addEdge(edge('src->sink', 'src', 'sink', { flowRate: 2 }));

    const engine = new SimEngine(graph);
    for (let i = 0; i < 50; i++) engine.tick(0.05);

    expect(engine.getNodeState('src')?.open).toBeUndefined();
    expect((engine.getNodeState('sink')?.consumedCount as number) ?? 0).toBeGreaterThan(0);
  });

  it("a Sensor wired through a Command commands the Source exactly like a Gate — closes it when its condition reads false", () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.1, itemType: 'widget' }));
    graph.addNode(node('sink', 'sink'));
    graph.addNode(node('sensor', 'sensor', { comparator: 'eq', threshold: 999 })); // never true
    graph.addNode(node('cmd', 'command'));
    graph.addEdge(edge('src->sink', 'src', 'sink', { flowRate: 2 }));
    graph.addEdge({ ...edge('sensor->cmd', 'sensor', 'cmd', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('cmd->src', 'cmd', 'src', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 50; i++) engine.tick(0.05);

    expect(engine.getNodeState('src')?.open).toBe(false);
    expect(engine.getNodeState('sink')).toBeUndefined();
  });

  it("Source -> Counter -> Sink, with a Sensor watching the Counter's count and a Command relaying its signal to cut the Source off after N items", () => {
    const graph = new GraphModel();
    // Cooldown deliberately much longer than one tick (and flowRate
    // high enough that an item crosses each edge within a single tick,
    // same "instant" trick DOCK_FLOW_RATE uses in App.tsx): at most one
    // item is ever in flight at a time, so the one-tick-behind signal
    // lag sensor.ts's own doc comment describes (a Source's trySpawn
    // this tick still sees LAST tick's Command relay, since
    // evaluateSignals for THIS tick hasn't run for either Sensor or
    // Command yet when trySpawn does) never has a second spawn already
    // in flight to overshoot with — settles at exactly the threshold.
    // A tight cooldown/high-flowRate version of this same setup CAN
    // overshoot by more than one (proved out while writing this test);
    // that's correct backpressure-free behavior, not a bug, but it
    // makes "exactly N" the wrong thing to assert, so this test
    // deliberately avoids that regime instead of asserting a squishier
    // bound.
    graph.addNode(node('src', 'source', { cooldown: 0.3, itemType: 'widget' }));
    graph.addNode(node('counter', 'counter'));
    graph.addNode(node('sink', 'sink'));
    graph.addNode(node('sensor', 'sensor', { metric: 'count', comparator: 'lt', threshold: 5 })); // open while count < 5
    graph.addNode(node('cmd', 'command'));
    graph.addEdge(edge('src->counter', 'src', 'counter', { flowRate: 25 }));
    graph.addEdge(edge('counter->sink', 'counter', 'sink', { flowRate: 25 }));
    graph.addEdge({ ...edge('counter->sensor', 'counter', 'sensor', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('sensor->cmd', 'sensor', 'cmd', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('cmd->src', 'cmd', 'src', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 200; i++) engine.tick(0.05);

    // Settles at exactly 5 -- once the 5th item lands, the Sensor's
    // condition (count < 5) reads false, the Command relays that, and
    // the 6th spawn never happens (not "eventually way past 5").
    expect(engine.getNodeState('counter')?.count).toBe(5);
    expect(engine.getNodeState('src')?.open).toBe(false);
  });

  it('active: false still overrides an open Command signal — the manual switch and the signal are ANDed, not OR\'d', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.1, itemType: 'widget', active: false }));
    graph.addNode(node('sink', 'sink'));
    graph.addNode(node('sensor', 'sensor', { comparator: 'gte', threshold: 0 })); // always open
    graph.addNode(node('cmd', 'command'));
    graph.addEdge(edge('src->sink', 'src', 'sink', { flowRate: 2 }));
    graph.addEdge({ ...edge('sensor->cmd', 'sensor', 'cmd', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('cmd->src', 'cmd', 'src', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 50; i++) engine.tick(0.05);

    expect(engine.getNodeState('src')?.open).toBe(true); // the signal itself is open...
    expect(engine.getNodeState('sink')).toBeUndefined(); // ...but the manual switch still blocks it
  });
});

/**
 * Command-driven Counter reset, end-to-end (2026-09-10, same-day
 * follow-up — Falcon, after asking why a Sensor+Command pair stopped a
 * Source: "counter node is just like a checkpoint between path[,] i
 * want it to count only role and can manually be resetable or by a
 * command when docked with command"): confirms the Counter itself is
 * NEVER paused by any of this — it keeps counting throughout, exactly
 * the "checkpoint" role Falcon described — only its tally gets zeroed,
 * on demand, via a Command.
 */
describe('command-driven counter reset: SimEngine integration', () => {
  it('a bare Command docked to a Counter (no Sensor wired) resets it once on connection, then the Counter keeps counting normally — it is never paused', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.1, itemType: 'widget' }));
    graph.addNode(node('counter', 'counter'));
    graph.addNode(node('sink', 'sink'));
    graph.addNode(node('cmd', 'command'));
    graph.addEdge(edge('src->counter', 'src', 'counter', { flowRate: 2 }));
    graph.addEdge(edge('counter->sink', 'counter', 'sink', { flowRate: 2 }));
    graph.addEdge({ ...edge('cmd->counter', 'cmd', 'counter', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 50; i++) engine.tick(0.05);

    // Command's own default ("no effect until commanded" reads as
    // `true`, per command.ts) already fired the one-shot reset early
    // on -- but the Counter is never gated the way a Source is, so
    // items keep accumulating afterward: the running count should be
    // well above 0 by the end, not stuck at 0.
    expect((engine.getNodeState('counter')?.count as number) ?? 0).toBeGreaterThan(0);
    // The Source itself was never touched by any of this wiring.
    expect(engine.getNodeState('src')?.open).toBeUndefined();
  });

  it("a Sensor whose condition never trips relays 'false' through its Command forever — a rising edge to true never happens, so the Counter is never reset", () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.1, itemType: 'widget' }));
    graph.addNode(node('counter', 'counter'));
    graph.addNode(node('sink', 'sink'));
    graph.addNode(node('sensor', 'sensor', { comparator: 'eq', threshold: 999 })); // never true
    graph.addNode(node('cmd', 'command'));
    graph.addEdge(edge('src->counter', 'src', 'counter', { flowRate: 2 }));
    graph.addEdge(edge('counter->sink', 'counter', 'sink', { flowRate: 2 }));
    graph.addEdge({ ...edge('sensor->cmd', 'sensor', 'cmd', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('cmd->counter', 'cmd', 'counter', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 50; i++) engine.tick(0.05);

    // Never resets (no rising edge ever occurs) -- count climbs freely
    // the entire run, same as if no Command were attached at all.
    expect((engine.getNodeState('counter')?.count as number) ?? 0).toBeGreaterThan(5);
  });

  it("a Sensor's condition flipping true each time it re-checks resets the Counter on every rising edge, but never pauses its counting", () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.05, itemType: 'widget' }));
    graph.addNode(node('counter', 'counter'));
    graph.addNode(node('sink', 'sink'));
    // Watches the Counter's own count, flips true every time count
    // hits a multiple of 3 -- comparator 'eq' means it's only true on
    // the exact tick count===3, giving a clean, repeatable rising edge
    // each time the Counter reaches 3 again after a reset.
    graph.addNode(node('sensor', 'sensor', { metric: 'count', comparator: 'eq', threshold: 3 }));
    graph.addNode(node('cmd', 'command'));
    graph.addEdge(edge('src->counter', 'src', 'counter', { flowRate: 25 }));
    graph.addEdge(edge('counter->sink', 'counter', 'sink', { flowRate: 25 }));
    graph.addEdge({ ...edge('counter->sensor', 'counter', 'sensor', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('sensor->cmd', 'sensor', 'cmd', { flowRate: 0 }), edgeKind: 'signal' });
    graph.addEdge({ ...edge('cmd->counter', 'cmd', 'counter', { flowRate: 0 }), edgeKind: 'signal' });

    const engine = new SimEngine(graph);
    for (let i = 0; i < 300; i++) engine.tick(0.05);

    // The Counter itself is never gated -- items pass through it the
    // whole run, so plenty have reached the Sink even though the
    // Counter's own tally keeps getting zeroed along the way.
    expect((engine.getNodeState('sink')?.consumedCount as number) ?? 0).toBeGreaterThan(5);
    // Its live count never climbs past the reset threshold for long —
    // by the end of a long run it reads a small number (0-3), not
    // something that grew unboundedly the way it would with no
    // Command attached at all.
    expect((engine.getNodeState('counter')?.count as number) ?? 0).toBeLessThanOrEqual(3);
  });
});

describe('transform', () => {
  const handler = nodeHandlers.transform!.onItemArrival!;
  const outEdge = edge('out', 't', 'sink');
  const ctxFor = (states: Record<string, Record<string, unknown>>, nodes: Record<string, NodeDef>) => ({
    getNode: (id: string) => nodes[id],
    getNodeState: (id: string) => states[id],
  });

  it('relabels an arriving item to outputType and forwards it immediately, incrementing convertedCount', () => {
    const result = handler(
      item('i1', 'ore'), node('t', 'transform', { inputType: 'ore', outputType: 'steel' }), {}, [outEdge],
      edge('in', 'src', 't'), makeItemId, ctxFor({}, {}),
    );
    expect(result.accepted).not.toBe(false);
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'out', item: { id: 'i1', type: 'steel' } }]);
    expect(result.newState.convertedCount).toBe(1);
  });

  it('relabels an item that does NOT match config.inputType too -- inputType is a label, not a filter', () => {
    const result = handler(
      item('i1', 'anything'), node('t', 'transform', { inputType: 'ore', outputType: 'steel' }), {}, [outEdge],
      edge('in', 'src', 't'), makeItemId, ctxFor({}, {}),
    );
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'out', item: { id: 'i1', type: 'steel' } }]);
  });

  it('falls back to passing the item through unchanged when outputType is missing from config', () => {
    const result = handler(
      item('i1', 'widget'), node('t', 'transform', {}), {}, [outEdge], edge('in', 'src', 't'), makeItemId, ctxFor({}, {}),
    );
    expect(result.actions).toEqual([{ type: 'forward', edgeId: 'out', item: { id: 'i1', type: 'widget' } }]);
  });

  it('keeps incrementing convertedCount across repeated arrivals', () => {
    let state: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      const result = handler(
        item(`i${i}`, 'ore'), node('t', 'transform', { inputType: 'ore', outputType: 'steel' }), state, [outEdge],
        edge('in', 'src', 't'), makeItemId, ctxFor({}, {}),
      );
      state = result.newState;
    }
    expect(state.convertedCount).toBe(4);
  });

  it('refuses when no physical output edge exists, without converting or incrementing', () => {
    const result = handler(
      item('i1', 'ore'), node('t', 'transform', { inputType: 'ore', outputType: 'steel' }), { convertedCount: 2 }, [],
      edge('in', 'src', 't'), makeItemId, ctxFor({}, {}),
    );
    expect(result.accepted).toBe(false);
    expect(result.newState.convertedCount).toBe(2);
  });

  it('refuses when the downstream target is a full buffer -- same targetBufferIsFull guard Counter/Distributor use -- without converting or incrementing', () => {
    const nodes = { buf: node('buf', 'buffer', { capacity: 2 }) };
    const states = { buf: { queue: [item('x'), item('y')] } };
    const result = handler(
      item('i1', 'ore'), node('t', 'transform', { inputType: 'ore', outputType: 'steel' }), { convertedCount: 2 },
      [edge('out', 't', 'buf')], edge('in', 'src', 't'), makeItemId, ctxFor(states, nodes),
    );
    expect(result.accepted).toBe(false);
    expect(result.newState.convertedCount).toBe(2);
  });

  it('SimEngine integration: a Source -> Transform -> Sink chain delivers every item relabeled', () => {
    const graph = new GraphModel();
    graph.addNode(node('src', 'source', { cooldown: 0.1, itemType: 'ore' }));
    graph.addNode(node('t', 'transform', { inputType: 'ore', outputType: 'steel' }));
    graph.addNode(node('sink', 'sink'));
    graph.addEdge(edge('src->t', 'src', 't', { flowRate: 5 }));
    graph.addEdge(edge('t->sink', 't', 'sink', { flowRate: 5 }));

    const engine = new SimEngine(graph);
    for (let i = 0; i < 50; i++) engine.tick(0.05);

    expect((engine.getNodeState('sink')?.consumedCount as number) ?? 0).toBeGreaterThan(0);
    expect((engine.getNodeState('t')?.convertedCount as number) ?? 0).toBeGreaterThan(0);
  });
});
