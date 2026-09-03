import { describe, it, expect } from 'vitest';
import { GraphModel } from '../GraphModel';
import { SimEngine } from '../SimEngine';
import { nodeHandlers } from '../nodes/index';
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
