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
});
