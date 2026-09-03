import { useMemo } from 'react';
import { FloorLayout } from '../floor/floorLayout';
import { FluxCanvas } from './FluxCanvas';
import { GraphModel } from '../core/GraphModel';
import { SkinConfig } from '../skin/SkinConfig';

/**
 * Milestone 4 demo graph (design doc §9 step 4): source -> distributor
 * -> {buffer -> sink, sink} — small enough to read at a glance, but
 * enough kinds and edges to show every skin-layer piece at once:
 *
 *  - all 6 octagon node kinds except sorter/mixer (source, sink x2,
 *    distributor, buffer) with their icons and live counter badges
 *  - all 3 edge styles (conveyor, glassTube, transparent)
 *  - all 3 item orientation modes (parallel, circling, static)
 */
function buildDemoGraph(): GraphModel {
  const graph = new GraphModel();
  graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 1.1, itemType: 'widget' } });
  graph.addNode({ id: 'dist', kind: 'distributor', config: { mode: 'roundRobin' } });
  graph.addNode({ id: 'buf', kind: 'buffer', config: { capacity: 4 } });
  graph.addNode({ id: 'snk1', kind: 'sink', config: {} });
  graph.addNode({ id: 'snk2', kind: 'sink', config: {} });

  graph.addEdge({
    id: 'e-src-dist',
    source: 'src',
    target: 'dist',
    sourcePort: 0,
    targetPort: 0,
    flowRate: 0.22,
    active: true,
  });
  graph.addEdge({
    id: 'e-dist-buf',
    source: 'dist',
    target: 'buf',
    sourcePort: 0,
    targetPort: 0,
    flowRate: 0.16,
    active: true,
  });
  graph.addEdge({
    id: 'e-dist-snk2',
    source: 'dist',
    target: 'snk2',
    sourcePort: 1,
    targetPort: 0,
    flowRate: 0.16,
    active: true,
  });
  graph.addEdge({
    id: 'e-buf-snk1',
    source: 'buf',
    target: 'snk1',
    sourcePort: 0,
    targetPort: 0,
    flowRate: 0.24,
    active: true,
  });
  return graph;
}

function buildDemoFloorLayout(): FloorLayout {
  const layout = new FloorLayout();
  layout.setNodePosition('src', { x: -420, y: -60 });
  layout.setNodePosition('dist', { x: -160, y: -60 });
  layout.setNodePosition('buf', { x: 100, y: -180 });
  layout.setNodePosition('snk1', { x: 380, y: -180 });
  layout.setNodePosition('snk2', { x: 60, y: 100 });

  layout.setEdgeCurve('e-src-dist', 'src', 'dist', 0.2);
  layout.setEdgeCurve('e-dist-buf', 'dist', 'buf', 0.2);
  layout.setEdgeCurve('e-dist-snk2', 'dist', 'snk2', 0.25);
  layout.setEdgeCurve('e-buf-snk1', 'buf', 'snk1', 0.2);
  return layout;
}

function buildDemoSkinConfig(): SkinConfig {
  const skin = new SkinConfig();
  // Conveyor, riding the belt facing the direction of travel.
  skin.setEdgeSkin('e-src-dist', {
    style: 'conveyor',
    color: '#3d7fff',
    strokeWidth: 12,
    itemOrientation: 'parallel',
  });
  // Glass tube, items spinning freely inside it.
  skin.setEdgeSkin('e-dist-buf', {
    style: 'glassTube',
    color: '#17b3a3',
    strokeWidth: 16,
    itemOrientation: 'circling',
    spinSpeed: 3.2,
  });
  // Transparent (the base state — no skin), items held at a fixed
  // facing so the bare movement layer is easy to see on its own.
  skin.setEdgeSkin('e-dist-snk2', {
    style: 'transparent',
    itemOrientation: 'static',
  });
  // A second conveyor in a different color, to show the style isn't
  // one-size-fits-all.
  skin.setEdgeSkin('e-buf-snk1', {
    style: 'conveyor',
    color: '#f2a93c',
    strokeWidth: 12,
    itemOrientation: 'parallel',
  });
  return skin;
}

export function App() {
  const graph = useMemo(() => buildDemoGraph(), []);
  const floorLayout = useMemo(() => buildDemoFloorLayout(), []);
  const skinConfig = useMemo(() => buildDemoSkinConfig(), []);

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
        <strong>FluxBoard</strong> — Milestone 4: skin layer. Octagon nodes with icons/badges,
        conveyor/glass-tube/transparent paths. Drag to pan, scroll to zoom.
      </header>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <FluxCanvas graph={graph} floorLayout={floorLayout} skinConfig={skinConfig} />
      </div>
    </div>
  );
}
