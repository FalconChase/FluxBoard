import { useMemo } from 'react';
import { FloorLayout } from '../floor/floorLayout';
import { FluxCanvas } from './FluxCanvas';
import { GraphModel } from '../core/GraphModel';

/** Milestone 2 demo graph: the same one-source/one-sink topology as the
 * Milestone 1 console harness, now given real world-space positions. */
function buildDemoGraph(): GraphModel {
  const graph = new GraphModel();
  graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 3, itemType: 'widget' } });
  graph.addNode({ id: 'snk', kind: 'sink', config: {} });
  graph.addEdge({
    id: 'e1',
    source: 'src',
    target: 'snk',
    sourcePort: 0,
    targetPort: 0,
    flowRate: 0.12,
    active: true,
  });
  return graph;
}

function buildDemoFloorLayout(): FloorLayout {
  const layout = new FloorLayout();
  layout.setNodePosition('src', { x: -220, y: 0 });
  layout.setNodePosition('snk', { x: 220, y: 0 });
  layout.setEdgeCurve('e1', 'src', 'snk', 0.25);
  return layout;
}

export function App() {
  const graph = useMemo(() => buildDemoGraph(), []);
  const floorLayout = useMemo(() => buildDemoFloorLayout(), []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #e5e4e7', fontSize: 14 }}>
        <strong>FluxBoard</strong> — Milestone 2: flat canvas, one path. Drag to pan, scroll to zoom.
      </header>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <FluxCanvas graph={graph} floorLayout={floorLayout} />
      </div>
    </div>
  );
}
