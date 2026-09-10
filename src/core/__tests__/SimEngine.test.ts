import { describe, it, expect } from 'vitest';
import { GraphModel } from '../GraphModel';
import { SimEngine } from '../SimEngine';
import type { EdgeDef } from '../types';

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

    // spawnedCount (design doc §4.5 — skin badge reads this directly,
    // no event-stream tallying needed on the skin side).
    const sourceState = engine.getNodeState('src');
    expect(sourceState?.spawnedCount).toBe(spawned);
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

/**
 * No-overlap item spacing (design doc §5.8 follow-up, 2026-09-09 —
 * Falcon: "is it possible to never overlap the items ... i want them
 * to behave like objects like it respects the size of the object
 * along a path"; then, same day: "i want it to be by default to
 * respect item sizes"). Default ON per edge, opt-out via an explicit
 * `respectItemSize: false`; the minimum gap is each item's own size
 * plus the size of whichever item is directly ahead of it (his other
 * choice), converted from world units into a progress fraction via
 * the edge's bridged `pathLength` — see EdgeDef.respectItemSize/
 * pathLength's own doc comments in types.ts.
 */
describe('SimEngine: no-overlap item spacing', () => {
  function buildSpacingGraph(edgeOverrides?: Partial<Pick<EdgeDef, 'respectItemSize' | 'pathLength'>>) {
    const graph = new GraphModel();
    graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 0, itemType: 'widget' } });
    graph.addNode({ id: 'snk', kind: 'sink', config: {} });
    graph.addEdge({
      id: 'e1',
      source: 'src',
      target: 'snk',
      sourcePort: 0,
      targetPort: 0,
      flowRate: 0.02,
      active: true,
      ...edgeOverrides,
    });
    return graph;
  }

  /** Worst-case (smallest) world-space distance between any two
   * adjacent in-flight items currently on `edgeId`, or Infinity if
   * fewer than two are in flight — the same invariant a viewer would
   * judge "do these tokens overlap on screen" by. */
  function worstGapWorld(engine: SimEngine, edgeId: string, pathLength: number): number {
    const onEdge = engine
      .getItemsInFlight()
      .filter((i) => i.edgeId === edgeId)
      .sort((a, b) => b.progress - a.progress);
    let worst = Infinity;
    for (let i = 1; i < onEdge.length; i++) {
      const gapWorld = (onEdge[i - 1]!.progress - onEdge[i]!.progress) * pathLength;
      if (gapWorld < worst) worst = gapWorld;
    }
    return worst;
  }

  const itemSizeOf = () => 3; // every 'widget' -- combined gap requirement is 3 + 3 = 6 world units

  it('keeps every pair of items on an opted-in edge at least their combined size apart, across a long continuous-spawn run', () => {
    const graph = buildSpacingGraph({ respectItemSize: true, pathLength: 50 });
    const engine = new SimEngine(graph);

    let worst = Infinity;
    for (let t = 0; t < 200; t++) {
      engine.tick(1, itemSizeOf);
      worst = Math.min(worst, worstGapWorld(engine, 'e1', 50));
    }

    expect(worst).toBeGreaterThanOrEqual(6 - 1e-9);
  });

  it('still conserves and eventually delivers every item despite holding trailing items back', () => {
    const graph = buildSpacingGraph({ respectItemSize: true, pathLength: 50 });
    const engine = new SimEngine(graph);

    let spawned = 0;
    let consumed = 0;
    for (let t = 0; t < 500; t++) {
      engine.tick(1, itemSizeOf);
      for (const event of engine.drainEvents()) {
        if (event.kind === 'spawned') spawned += 1;
        if (event.kind === 'consumed') consumed += 1;
      }
    }

    const inFlight = engine.getItemsInFlight().length;
    expect(spawned).toBe(consumed + inFlight);
    expect(consumed).toBeGreaterThan(0);
  });

  it('defaults ON: an edge with no respectItemSize flag at all still enforces spacing once pathLength is bridged in', () => {
    const graph = buildSpacingGraph({ pathLength: 50 }); // no respectItemSize field at all
    const engine = new SimEngine(graph);

    let worst = Infinity;
    for (let t = 0; t < 200; t++) {
      engine.tick(1, itemSizeOf);
      worst = Math.min(worst, worstGapWorld(engine, 'e1', 50));
    }

    expect(worst).toBeGreaterThanOrEqual(6 - 1e-9);
  });

  it('can still be explicitly disabled per edge: respectItemSize: false keeps the old free-overlap behavior, even with pathLength bridged and a size resolver supplied', () => {
    const graph = buildSpacingGraph({ respectItemSize: false, pathLength: 50 });
    const engine = new SimEngine(graph);

    let worst = Infinity;
    for (let t = 0; t < 200; t++) {
      engine.tick(1, itemSizeOf);
      worst = Math.min(worst, worstGapWorld(engine, 'e1', 50)); // 50 used only as a nominal yardstick here
    }

    expect(worst).toBeLessThan(6); // the same overlap Falcon originally reported
  });

  it('does nothing when the caller omits the size resolver, even on an opted-in edge (every pre-existing tick(dt) call site keeps working unchanged)', () => {
    const graph = buildSpacingGraph({ respectItemSize: true, pathLength: 50 });
    const engine = new SimEngine(graph);

    let worst = Infinity;
    for (let t = 0; t < 200; t++) {
      engine.tick(1); // no itemSizeOf
      worst = Math.min(worst, worstGapWorld(engine, 'e1', 50));
    }

    expect(worst).toBeLessThan(6);
  });

  it('does nothing until pathLength has been bridged in, even when respectItemSize is already on', () => {
    const graph = buildSpacingGraph({ respectItemSize: true }); // no pathLength yet
    const engine = new SimEngine(graph);

    let worst = Infinity;
    for (let t = 0; t < 200; t++) {
      engine.tick(1, itemSizeOf);
      worst = Math.min(worst, worstGapWorld(engine, 'e1', 50));
    }

    expect(worst).toBeLessThan(6);
  });
});

/**
 * Source auto-activation (design doc §5.9 follow-up, 2026-09-09 —
 * Falcon: "on source node's properties i want it off by default
 * meaning its not spawning any item unless toggled on or activate
 * even its connected by a path ... i want to implement an auto
 * deactivate on the source node once the path is filled", then,
 * confirming, "auto[-resume] ... once theres room"). Manual on/off
 * lives in `node.config.active` (undefined means the OLD always-on
 * behavior — only App.tsx's defaultConfigFor writes `active: false`
 * for a BRAND NEW source, so existing saves are untouched);
 * `autoDeactivated` distinguishes "the system paused this" (eligible
 * to auto-resume) from "a person paused this" (stays off until they
 * say otherwise) — see SimEngine.sourceActivationGate's own doc
 * comment.
 */
describe('SimEngine: source auto-activation', () => {
  function buildActivationGraph(sourceConfig?: Record<string, unknown>) {
    const graph = new GraphModel();
    graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 0, itemType: 'widget', ...sourceConfig } });
    graph.addNode({ id: 'snk', kind: 'sink', config: {} });
    // Room for exactly one item at a time: the very first spawn fills
    // the whole path, so "no room" is reachable in a couple of ticks
    // rather than a long congestion-building run.
    graph.addEdge({
      id: 'e1',
      source: 'src',
      target: 'snk',
      sourcePort: 0,
      targetPort: 0,
      flowRate: 0.001,
      active: true,
      pathLength: 10,
    });
    return graph;
  }

  const itemSizeOf = () => 6; // one item alone already needs the whole 10-unit path (6+6=12 > 10)

  it('a source with no `active` field at all still spawns immediately — old saves are untouched', () => {
    const graph = buildActivationGraph();
    const engine = new SimEngine(graph);

    engine.tick(1, itemSizeOf);

    expect(engine.getItemsInFlight()).toHaveLength(1);
  });

  it('active: false never spawns on its own, no matter how long it runs, even fully connected', () => {
    const graph = buildActivationGraph({ active: false });
    const engine = new SimEngine(graph);

    for (let t = 0; t < 10; t++) engine.tick(1, itemSizeOf);

    expect(engine.getItemsInFlight()).toHaveLength(0);
    expect(engine.getNodeState('src')?.spawnedCount ?? 0).toBe(0);
  });

  it('auto-deactivates once its path is full, marking it as the system’s doing', () => {
    const graph = buildActivationGraph({ active: true });
    const engine = new SimEngine(graph);

    for (let t = 0; t < 5; t++) engine.tick(1, itemSizeOf);

    expect(engine.getItemsInFlight()).toHaveLength(1); // only the one item that fit
    expect(graph.getNode('src')?.config.active).toBe(false);
    expect(graph.getNode('src')?.config.autoDeactivated).toBe(true);
  });

  it('auto-resumes on its own once room frees up, with no action from a person', () => {
    const graph = buildActivationGraph({ active: true, cooldown: 0 });
    const engine = new SimEngine(graph);

    for (let t = 0; t < 5; t++) engine.tick(1, itemSizeOf); // fills the path, auto-deactivates
    expect(graph.getNode('src')?.config.autoDeactivated).toBe(true);

    // Room-for-exactly-one with cooldown 0 settles into a repeating
    // fill/deactivate/deliver/resume cycle rather than a single
    // one-shot resume (correct for a bottleneck this tight) — sample
    // every tick for "was it ever resumed" rather than asserting one
    // final snapshot.
    let everResumed = false;
    for (let t = 0; t < 15000; t++) {
      engine.tick(1, itemSizeOf);
      if (graph.getNode('src')?.config.active !== false) everResumed = true;
    }

    expect(everResumed).toBe(true);
    expect(engine.getNodeState('snk')?.consumedCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(engine.getNodeState('src')?.spawnedCount ?? 0).toBeGreaterThan(1);
  });

  it('a manual off is never auto-resumed, even once the path is completely empty again', () => {
    const graph = buildActivationGraph({ active: true, cooldown: 0 });
    const engine = new SimEngine(graph);

    engine.tick(1, itemSizeOf); // spawns the one item that fits
    graph.updateNodeConfig('src', { active: false, autoDeactivated: false }); // a person turns it off themselves

    for (let t = 0; t < 15000; t++) engine.tick(1, itemSizeOf); // plenty of time for the item to clear

    expect(graph.getNode('src')?.config.active).toBe(false);
  });
});
