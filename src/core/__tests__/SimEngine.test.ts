import { describe, it, expect } from 'vitest';
import { GraphModel } from '../GraphModel';
import { SimEngine } from '../SimEngine';

/**
 * Milestone 1 target test (design doc §9, step 1): one source, one
 * sink, run N ticks, assert every spawned item is eventually consumed
 * and none are lost or duplicated (item conservation).
 */
function buildSourceSinkGraph(overrides?: { cooldown?: number; flowRate?: number }) {
  const graph = new GraphModel();
  graph.addNode({
    id: 'src',
    kind: 'source',
    config: { cooldown: overrides?.cooldown ?? 3, itemType: 'widget' },
  });
  graph.addNode({ id: 'snk', kind: 'sink', config: {} });
  graph.addEdge({
    id: 'e1',
    source: 'src',
    target: 'snk',
    sourcePort: 0,
    targetPort: 0,
    flowRate: overrides?.flowRate ?? 0.5,
    active: true,
  });
  return graph;
}

describe('SimEngine (Milestone 1): source -> sink', () => {
  it('constructs without throwing', () => {
    const graph = new GraphModel();
    expect(() => new SimEngine(graph)).not.toThrow();
  });

  it('spawns an item after the configured cooldown', () => {
    const graph = buildSourceSinkGraph({ cooldown: 2 });
    const engine = new SimEngine(graph);

    for (let i = 0; i < 3; i++) engine.tick(1);

    const events = engine.drainEvents();
    expect(events.filter((e) => e.kind === 'spawned')).toHaveLength(1);
    expect(engine.getItemsInFlight()).toHaveLength(1);
  });

  it('moves an item toward progress 1 and delivers it to the sink', () => {
    const graph = buildSourceSinkGraph({ cooldown: 0, flowRate: 0.5 });
    const engine = new SimEngine(graph);
    const item1 = () => engine.getItemsInFlight().find((i) => i.item.id === 'item-1');

    engine.tick(1); // spawns item-1 at progress 0
    expect(item1()?.progress).toBe(0);

    engine.tick(1); // advances 0 -> 0.5
    expect(item1()?.progress).toBeCloseTo(0.5);

    engine.tick(1); // advances 0.5 -> 1.0 and is delivered this tick
    expect(item1()).toBeUndefined();

    const sinkState = engine.getNodeState('snk');
    expect(sinkState?.consumedCount).toBe(1);
  });

  it('conserves items over a long run: spawned == consumed + inFlight', () => {
    const graph = buildSourceSinkGraph({ cooldown: 2, flowRate: 0.34 });
    const engine = new SimEngine(graph);

    let spawned = 0;
    let consumed = 0;

    for (let i = 0; i < 500; i++) {
      engine.tick(1);
      for (const event of engine.drainEvents()) {
        if (event.kind === 'spawned') spawned += 1;
        if (event.kind === 'consumed') consumed += 1;
      }
    }

    const inFlight = engine.getItemsInFlight().length;
    expect(spawned).toBe(consumed + inFlight);
    expect(spawned).toBeGreaterThan(0);

    const sinkState = engine.getNodeState('snk');
    expect(sinkState?.consumedCount).toBe(consumed);
  });

  it('never deadlocks: the source keeps spawning across many ticks', () => {
    const graph = buildSourceSinkGraph({ cooldown: 1, flowRate: 1 });
    const engine = new SimEngine(graph);

    for (let i = 0; i < 100; i++) engine.tick(1);

    const sinkState = engine.getNodeState('snk');
    expect((sinkState?.consumedCount as number) ?? 0).toBeGreaterThanOrEqual(45);
  });

  it('holds progress on a gated-off edge instead of losing or forcing it through', () => {
    const graph = buildSourceSinkGraph({ cooldown: 0, flowRate: 0.3 });
    const engine = new SimEngine(graph);
    const item1 = () => engine.getItemsInFlight().find((i) => i.item.id === 'item-1');

    engine.tick(1); // spawns item-1 at progress 0
    expect(item1()?.progress).toBe(0);

    engine.tick(1); // advances 0 -> 0.3
    expect(item1()?.progress).toBeCloseTo(0.3);

    graph.setEdgeActive('e1', false);
    engine.tick(1);
    engine.tick(1);
    expect(item1()?.progress).toBeCloseTo(0.3); // held, not lost or forced through

    graph.setEdgeActive('e1', true);
    engine.tick(1);
    expect(item1()?.progress).toBeCloseTo(0.6); // resumes from where it was gated
  });
});
