import { describe, expect, it } from 'vitest';
import { GraphModel } from '../../core/GraphModel';
import { SimEngine } from '../../core/SimEngine';
import { InterpolatedSimDriver } from '../interpolatedSim';

function buildGraph(): GraphModel {
  const graph = new GraphModel();
  graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 0, itemType: 'widget' } });
  graph.addNode({ id: 'snk', kind: 'sink', config: {} });
  graph.addEdge({
    id: 'e1',
    source: 'src',
    target: 'snk',
    sourcePort: 0,
    targetPort: 0,
    flowRate: 0.5,
    active: true,
  });
  return graph;
}

describe('InterpolatedSimDriver', () => {
  it('does not tick on the first update call (establishes the clock baseline)', () => {
    const engine = new SimEngine(buildGraph());
    const driver = new InterpolatedSimDriver(engine, 100);
    driver.update(1000);
    expect(engine.getTick()).toBe(0);
  });

  it('ticks the engine exactly once per full interval elapsed', () => {
    const engine = new SimEngine(buildGraph());
    const driver = new InterpolatedSimDriver(engine, 100);

    driver.update(0);
    driver.update(50); // half an interval, no tick yet
    expect(engine.getTick()).toBe(0);

    driver.update(100); // now a full interval has elapsed
    expect(engine.getTick()).toBe(1);

    driver.update(320); // 2.2 more intervals elapsed -> 2 more ticks
    expect(engine.getTick()).toBe(3);
  });

  it('interpolates progress smoothly between ticks rather than snapping', () => {
    const engine = new SimEngine(buildGraph());
    const driver = new InterpolatedSimDriver(engine, 100);

    driver.update(0);
    driver.update(100); // tick 1: item-1 spawns at progress 0
    driver.update(200); // tick 2: item-1 reaches progress 0.5; interpolation window is now [prev=0, curr=0.5]

    const atTick2 = driver.getRenderItems().find((i) => i.id === 'item-1');
    expect(atTick2?.progress).toBeCloseTo(0);

    driver.update(250); // halfway through the tick2->tick3 window
    const halfway = driver.getRenderItems().find((i) => i.id === 'item-1');
    expect(halfway?.progress).toBeGreaterThan(0);
    expect(halfway?.progress).toBeLessThan(0.5);

    driver.update(300); // tick 3: item-1 reaches progress 1.0 and is delivered/removed
    expect(driver.getRenderItems().find((i) => i.id === 'item-1')).toBeUndefined();
  });

  it('never reports a negative or NaN progress for a freshly spawned item', () => {
    const engine = new SimEngine(buildGraph());
    const driver = new InterpolatedSimDriver(engine, 100);
    driver.update(0);
    driver.update(100);
    for (const item of driver.getRenderItems()) {
      expect(Number.isNaN(item.progress)).toBe(false);
      expect(item.progress).toBeGreaterThanOrEqual(0);
    }
  });

  it('RUN/HOLD: freezes item progress while held, resumes cleanly without a jump', () => {
    // Slower flowRate than the other tests so item-1 is still in flight
    // several ticks in, not delivered partway through this test.
    const graph = new GraphModel();
    graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 0, itemType: 'widget' } });
    graph.addNode({ id: 'snk', kind: 'sink', config: {} });
    graph.addEdge({
      id: 'e1',
      source: 'src',
      target: 'snk',
      sourcePort: 0,
      targetPort: 0,
      flowRate: 0.2,
      active: true,
    });
    const engine = new SimEngine(graph);
    const driver = new InterpolatedSimDriver(engine, 100);

    driver.update(0);
    driver.update(100); // tick 1: item-1 spawns
    driver.update(200); // tick 2: item-1 at progress 0.2
    const beforeHold = driver.getRenderItems().find((i) => i.id === 'item-1')?.progress;
    expect(beforeHold).toBeDefined();

    driver.pause();
    expect(driver.isRunning()).toBe(false);

    // A lot of "real" time passes while held — none of it should reach the sim.
    driver.update(500);
    driver.update(5000);
    expect(engine.getTick()).toBe(2);
    expect(driver.getRenderItems().find((i) => i.id === 'item-1')?.progress).toBeCloseTo(beforeHold!);

    driver.resume();
    expect(driver.isRunning()).toBe(true);

    // Resuming shouldn't replay the 4800ms that elapsed while held as a
    // burst of ticks — exactly one more tick's worth of real time should
    // produce exactly one more tick.
    driver.update(5100);
    expect(engine.getTick()).toBe(3);
    const afterResume = driver.getRenderItems().find((i) => i.id === 'item-1')?.progress;
    expect(afterResume).toBeGreaterThan(beforeHold!);
  });

  it('regression FBB002: an item forwarded onto a new edge mid-tick renders at the new edge\'s own position, not a backward-crawling blend of the old edge\'s progress against it', () => {
    // src -e1(0.4)-> dist -e2(0.3)-> snk. item-1 crosses e1 in 3 ticks
    // (0 -> 0.4 -> 0.8), then on tick 4 finishes e1, is delivered to
    // the distributor, and forwarded onto e2 at progress 0 — all
    // within that same tick. prevSnapshot (captured before tick 4)
    // still has item-1 at {edgeId: e1, progress: 0.8}; currSnapshot
    // (after tick 4) has it at {edgeId: e2, progress: 0}. Blending
    // those as one curve (the old bug) would render it at 0.8 along
    // e2 right after the tick, sliding back to 0 as the interpolation
    // window advances — a visible "bounce back" with nothing to do
    // with the actual simulation.
    const graph = new GraphModel();
    graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 0, itemType: 'widget' } });
    graph.addNode({ id: 'dist', kind: 'distributor', config: {} });
    graph.addNode({ id: 'snk', kind: 'sink', config: {} });
    graph.addEdge({ id: 'e1', source: 'src', target: 'dist', sourcePort: 0, targetPort: 0, flowRate: 0.4, active: true });
    graph.addEdge({ id: 'e2', source: 'dist', target: 'snk', sourcePort: 0, targetPort: 0, flowRate: 0.3, active: true });

    const engine = new SimEngine(graph);
    const driver = new InterpolatedSimDriver(engine, 100);

    driver.update(0);
    driver.update(100); // tick 1: item-1 spawns on e1 at progress 0
    driver.update(200); // tick 2: item-1 -> 0.4
    driver.update(300); // tick 3: item-1 -> 0.8

    driver.update(400); // tick 4: item-1 finishes e1, forwarded onto e2 at progress 0 — same tick
    const rightAfterForward = driver.getRenderItems().find((i) => i.id === 'item-1');
    expect(rightAfterForward?.edgeId).toBe('e2');
    expect(rightAfterForward?.progress).toBeCloseTo(0); // NOT ~0.8

    driver.update(450); // halfway through the tick4->tick5 window
    const halfway = driver.getRenderItems().find((i) => i.id === 'item-1');
    expect(halfway?.edgeId).toBe('e2');
    expect(halfway!.progress).toBeLessThan(0.1); // holds near the edge's start — no backward crawl

    driver.update(500); // tick 5: item-1 is now genuinely advancing along e2
    const afterNextTick = driver.getRenderItems().find((i) => i.id === 'item-1');
    expect(afterNextTick!.progress).toBeGreaterThanOrEqual(0);
    expect(afterNextTick!.edgeId).toBe('e2');
  });
});
