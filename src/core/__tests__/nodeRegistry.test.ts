import { describe, it, expect } from 'vitest';
import { GraphModel } from '../GraphModel';
import { SimEngine } from '../SimEngine';
import { nodeHandlers, type Action } from '../nodes/index';
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
