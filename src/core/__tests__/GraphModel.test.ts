import { describe, it, expect } from 'vitest';
import { GraphModel } from '../GraphModel';

/**
 * Milestone 5 target tests: the small mutators the properties panel
 * calls (design doc §4.6) — updateNodeConfig, setEdgeFlowRate,
 * updateEdgePorts — plus getAllEdges(), which the skin-layer renderer
 * added in Milestone 4 relies on.
 */
function buildGraph(): GraphModel {
  const graph = new GraphModel();
  graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 2, itemType: 'widget' } });
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
  return graph;
}

describe('GraphModel', () => {
  it('getAllEdges returns every edge added', () => {
    const graph = buildGraph();
    expect(graph.getAllEdges().map((e) => e.id)).toEqual(['e1']);
  });

  it('updateNodeConfig shallow-merges into the node\'s existing config, preserving untouched fields', () => {
    const graph = buildGraph();
    graph.updateNodeConfig('src', { cooldown: 5 });
    expect(graph.getNode('src')?.config).toEqual({ cooldown: 5, itemType: 'widget' });
  });

  it('updateNodeConfig throws for an unknown node', () => {
    const graph = buildGraph();
    expect(() => graph.updateNodeConfig('nope', { cooldown: 1 })).toThrow();
  });

  it('setEdgeFlowRate updates only flowRate, leaving active/ports untouched', () => {
    const graph = buildGraph();
    graph.setEdgeFlowRate('e1', 0.9);
    const edge = graph.getEdge('e1');
    expect(edge?.flowRate).toBe(0.9);
    expect(edge?.active).toBe(true);
    expect(edge?.sourcePort).toBe(0);
  });

  it('updateEdgePorts updates only the given fields', () => {
    const graph = buildGraph();
    graph.updateEdgePorts('e1', { targetPort: 3 });
    const edge = graph.getEdge('e1');
    expect(edge?.targetPort).toBe(3);
    expect(edge?.sourcePort).toBe(0); // untouched

    graph.updateEdgePorts('e1', { sourcePort: 2, targetPort: 4 });
    expect(graph.getEdge('e1')?.sourcePort).toBe(2);
    expect(graph.getEdge('e1')?.targetPort).toBe(4);
  });

  it('updateEdgePorts/setEdgeFlowRate throw for an unknown edge', () => {
    const graph = buildGraph();
    expect(() => graph.updateEdgePorts('nope', { sourcePort: 1 })).toThrow();
    expect(() => graph.setEdgeFlowRate('nope', 1)).toThrow();
  });

  it('removeEdge deletes the edge and drops it from the source node\'s out-edge list', () => {
    const graph = buildGraph();
    graph.removeEdge('e1');
    expect(graph.getEdge('e1')).toBeUndefined();
    expect(graph.getAllEdges()).toEqual([]);
    expect(graph.outputEdges('src')).toEqual([]);
  });

  it('removeEdge on an unknown id is a no-op, not an error', () => {
    const graph = buildGraph();
    expect(() => graph.removeEdge('nope')).not.toThrow();
    expect(graph.getAllEdges().map((e) => e.id)).toEqual(['e1']);
  });

  it('removeNode deletes the node and cascades to every edge touching it, returning their ids', () => {
    const graph = buildGraph();
    graph.addNode({ id: 'snk2', kind: 'sink', config: {} });
    graph.addEdge({
      id: 'e2',
      source: 'src',
      target: 'snk2',
      sourcePort: 1,
      targetPort: 0,
      flowRate: 0.3,
      active: true,
    });

    const removed = graph.removeNode('src');

    expect(removed.sort()).toEqual(['e1', 'e2']);
    expect(graph.getNode('src')).toBeUndefined();
    expect(graph.getAllEdges()).toEqual([]);
    // snk/snk2 remain — only src and its edges were removed
    expect(graph.getNode('snk')).toBeDefined();
    expect(graph.getNode('snk2')).toBeDefined();
  });

  it('removeNode also cascades an edge where the node is only the target', () => {
    const graph = buildGraph();
    const removed = graph.removeNode('snk');
    expect(removed).toEqual(['e1']);
    expect(graph.getAllEdges()).toEqual([]);
    expect(graph.getNode('src')).toBeDefined();
  });

  it('removeNode on an unknown id is a no-op and returns an empty array', () => {
    const graph = buildGraph();
    expect(graph.removeNode('nope')).toEqual([]);
    expect(graph.getAllEdges().map((e) => e.id)).toEqual(['e1']);
  });
});
