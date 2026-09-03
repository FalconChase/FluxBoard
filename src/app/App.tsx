import { useEffect, useMemo, useRef, useState } from 'react';
import { FloorLayout } from '../floor/floorLayout';
import { FluxCanvas, type FluxCanvasHandle } from './FluxCanvas';
import { GraphModel } from '../core/GraphModel';
import type { EdgeId, NodeId, NodeKind } from '../core/types';
import type { Point } from '../floor/bezier';
import { SkinConfig } from '../skin/SkinConfig';
import { getPortCapacity } from '../core/nodes/portCapacity';
import type { EdgeStyle } from '../skin/pathSkin';
import { LeftPanel, type LeftPanelTab } from './LeftPanel';
import { PropertiesPanel } from './PropertiesPanel';
import type { Selection } from './selection';
import { SketchLayer } from './sketchLayer';

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

/** Sensible starting config per kind when a new node is placed from
 * the palette — the same defaults each node handler itself falls back
 * to when a field is missing (design doc §4.2), so a freshly-placed
 * node behaves identically to one whose config the panel hasn't been
 * touched for yet. */
function defaultConfigFor(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'source':
      return { cooldown: 2, itemType: 'widget' };
    case 'distributor':
      return { mode: 'roundRobin' };
    case 'sorter':
      return { rules: [], defaultPort: 0, unmatchedPolicy: 'hold' };
    case 'mixer':
      return { recipe: {}, outputPort: 0, outputType: 'item' };
    case 'buffer':
      return { capacity: 3, overflowPolicy: 'block' };
    case 'sink':
      return {};
    default:
      return {};
  }
}

export function App() {
  const graph = useMemo(() => buildDemoGraph(), []);
  const floorLayout = useMemo(() => buildDemoFloorLayout(), []);
  const skinConfig = useMemo(() => buildDemoSkinConfig(), []);
  const sketchLayer = useMemo(() => new SketchLayer(), []);

  // Milestone 5 (minimal-chrome scope, FBP008 resolved): selection +
  // node placement + body-to-body wiring. graph/floorLayout/skinConfig
  // are mutated directly (they're the single source of truth, design
  // doc §4.6) — the canvas picks up any change on its next animation
  // frame with no extra plumbing; only selection/placement state needs
  // to be real React state, since the palette/properties panel need to
  // re-render on those.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [placementKind, setPlacementKind] = useState<NodeKind | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const nextIdRef = useRef(1);

  // UI chrome (Falcon's wireframe, claude/build-log.md): left-panel
  // tabs, the PATHS palette's armed style, and the canvas/simulation
  // settings the properties panel's new second section edits. isRunning
  // mirrors FluxCanvas's own RUN/HOLD state so the bottom bar's
  // Play/Pause button can show the right label — the actual toggle is
  // called through fluxCanvasRef since the sim driver only exists
  // inside FluxCanvas's own effect.
  const [leftTab, setLeftTab] = useState<LeftPanelTab>('nodes');
  const [armedEdgeStyle, setArmedEdgeStyle] = useState<EdgeStyle | null>(null);
  // Planning sketches (Falcon, 2026-09-03): pure visual scratch lines,
  // no simulation meaning, not tied to any node — sketchArmed mirrors
  // placementKind/armedEdgeStyle's arm-then-act flow but the "act" is
  // just a drag anywhere on the canvas (see FluxCanvas's onCreateSketch).
  const [sketchArmed, setSketchArmed] = useState(false);
  const [gridSpacing, setGridSpacing] = useState(64);
  const [tickIntervalMs, setTickIntervalMs] = useState(400);
  const [isRunning, setIsRunning] = useState(true);
  const fluxCanvasRef = useRef<FluxCanvasHandle | null>(null);

  // Move/delete/snap feature set: Delete/Backspace removes whatever is
  // selected, F8 toggles snap-to-grid. Both are window-level so they
  // work with focus anywhere on the canvas (which isn't a focusable
  // element itself) — guarded so typing in a properties-panel text
  // field (e.g. Backspace while editing an item type) never deletes
  // the selected node/edge instead of a character.
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'F8') {
        e.preventDefault();
        setSnapToGrid((v) => !v);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget(e.target)) {
        e.preventDefault();
        handleDeleteSelection();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // handleDeleteSelection and selection close over current state on
    // every render already (plain function, not memoized) — omitted
    // from deps deliberately, same reasoning FluxCanvas's own effect
    // documents for its interaction props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDeleteSelection(): void {
    if (!selection) return;
    if (selection.type === 'node') {
      const removedEdgeIds = graph.removeNode(selection.id);
      floorLayout.removeNodePosition(selection.id);
      skinConfig.removeNode(selection.id);
      for (const edgeId of removedEdgeIds) {
        floorLayout.removeEdgeCurve(edgeId);
        skinConfig.removeEdge(edgeId);
      }
    } else if (selection.type === 'sketch') {
      sketchLayer.remove(selection.id);
    } else {
      graph.removeEdge(selection.id);
      floorLayout.removeEdgeCurve(selection.id);
      skinConfig.removeEdge(selection.id);
    }
    setSelection(null);
  }

  function handlePlaceNode(kind: NodeKind, worldPoint: Point): void {
    const id = `user-node-${nextIdRef.current++}`;
    graph.addNode({ id, kind, config: defaultConfigFor(kind) });
    floorLayout.setNodePosition(id, worldPoint);
    setSelection({ type: 'node', id });
    setPlacementKind(null);
  }

  function handleCreateEdge(sourceNodeId: NodeId, targetNodeId: NodeId): void {
    // Per-socket wiring (Falcon, 2026-09-03): max 8 paths per node,
    // one per octagon side. Checked BEFORE creating anything so a
    // node that's already full silently rejects the drag rather than
    // leaving a logic-layer edge with no floor-layer curve to render.
    if (!floorLayout.hasFreeAnchorSlot(sourceNodeId) || !floorLayout.hasFreeAnchorSlot(targetNodeId)) {
      return;
    }

    // Per-kind "nature" caps (Falcon, 2026-09-03: a source only ever
    // has one output) — also checked before creating anything, same
    // silent-rejection style as the anchor cap above.
    const sourceNode = graph.getNode(sourceNodeId);
    const targetNode = graph.getNode(targetNodeId);
    if (!sourceNode || !targetNode) return;
    const sourceCap = getPortCapacity(sourceNode.kind);
    const targetCap = getPortCapacity(targetNode.kind);
    if (sourceCap.maxOutputs !== undefined && graph.outputEdges(sourceNodeId).length >= sourceCap.maxOutputs) {
      return;
    }
    if (targetCap.maxInputs !== undefined && graph.inputEdges(targetNodeId).length >= targetCap.maxInputs) {
      return;
    }

    const id = `user-edge-${nextIdRef.current++}`;
    graph.addEdge({
      id,
      source: sourceNodeId,
      target: targetNodeId,
      sourcePort: 0,
      targetPort: 0,
      flowRate: 0.15,
      active: true,
    });
    floorLayout.setEdgeCurve(id, sourceNodeId, targetNodeId, 0.15);
    setSelection({ type: 'edge', id });
  }

  // NODES and PATHS arming are mutually exclusive — arming one clears
  // the other, so the canvas's pointer state machine never has to
  // decide which one wins.
  function handleArmNodeKind(kind: NodeKind | null): void {
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setPlacementKind(kind);
  }

  function handleArmEdgeStyle(style: EdgeStyle | null): void {
    setPlacementKind(null);
    setSketchArmed(false);
    setArmedEdgeStyle(style);
  }

  function handleArmSketch(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(armed);
  }

  function handleApplyEdgeStyle(edgeId: EdgeId, style: EdgeStyle): void {
    skinConfig.setEdgeSkin(edgeId, { style });
    setArmedEdgeStyle(null);
  }

  function handleCreateSketch(from: Point, to: Point): void {
    const id = `sketch-${nextIdRef.current++}`;
    sketchLayer.add({ id, from, to });
    setSelection({ type: 'sketch', id });
    setSketchArmed(false);
  }

  function handlePlayPauseClick(): void {
    fluxCanvasRef.current?.toggleRunning();
  }

  const instructionText = placementKind
    ? `Click the canvas to place a ${placementKind}.`
    : armedEdgeStyle
      ? `Click an existing path to apply the ${armedEdgeStyle} style.`
      : sketchArmed
        ? 'Drag anywhere on the canvas to sketch a planning path (no simulation meaning).'
        : selection?.type === 'node'
          ? 'Node selected — drag to move it (if unlocked), Shift+drag to wire, Delete to remove.'
          : selection?.type === 'edge'
            ? 'Path selected — edit it in the properties panel, Delete to remove.'
            : selection?.type === 'sketch'
              ? 'Sketch selected — Delete to remove. Planning guide only, no simulation meaning.'
              : 'Click a node or path to select it, choose something from the left panel to add, or Shift+drag from one node to another to connect them.';

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
      <header
        style={{
          padding: '0.6rem 1rem',
          borderBottom: '1px solid #e5e4e7',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span>
          <strong>FluxBoard</strong> — node/path/object registry, properties panel, wiring, drag-to-move. See the
          instruction strip at the bottom for what to do next.
        </span>
        <button
          type="button"
          onClick={() => setSnapToGrid((v) => !v)}
          title="Toggle snap-to-grid (F8)"
          style={{
            flexShrink: 0,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            borderRadius: 6,
            border: '1px solid ' + (snapToGrid ? '#2563eb' : '#d8d7dd'),
            background: snapToGrid ? '#2563eb' : '#f6f6f8',
            color: snapToGrid ? '#fff' : '#3c3c43',
            cursor: 'pointer',
          }}
        >
          ⌗ Snap to grid (F8) {snapToGrid ? 'ON' : 'OFF'}
        </button>
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftPanel
          activeTab={leftTab}
          onTabChange={setLeftTab}
          armedKind={placementKind}
          onArmKind={handleArmNodeKind}
          armedEdgeStyle={armedEdgeStyle}
          onArmEdgeStyle={handleArmEdgeStyle}
          sketchArmed={sketchArmed}
          onArmSketch={handleArmSketch}
        />
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <FluxCanvas
            ref={fluxCanvasRef}
            graph={graph}
            floorLayout={floorLayout}
            skinConfig={skinConfig}
            tickIntervalMs={tickIntervalMs}
            selection={selection}
            onSelect={setSelection}
            placementKind={placementKind}
            onPlaceNode={handlePlaceNode}
            onCreateEdge={handleCreateEdge}
            snapToGrid={snapToGrid}
            gridSpacing={gridSpacing}
            armedEdgeStyle={armedEdgeStyle}
            onApplyEdgeStyle={handleApplyEdgeStyle}
            onRunningChange={setIsRunning}
            sketchLayer={sketchLayer}
            sketchArmed={sketchArmed}
            onCreateSketch={handleCreateSketch}
          />
        </div>
        <PropertiesPanel
          selection={selection}
          graph={graph}
          skinConfig={skinConfig}
          floorLayout={floorLayout}
          sketchLayer={sketchLayer}
          onDelete={handleDeleteSelection}
          gridSpacing={gridSpacing}
          onGridSpacingChange={setGridSpacing}
          tickIntervalMs={tickIntervalMs}
          onTickIntervalMsChange={setTickIntervalMs}
        />
      </div>
      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0.5rem 1rem',
          borderTop: '1px solid #e5e4e7',
          fontSize: 12,
        }}
      >
        <button
          type="button"
          onClick={handlePlayPauseClick}
          style={{
            flexShrink: 0,
            padding: '5px 14px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            border: '1px solid ' + (isRunning ? '#d8555a' : '#2f8f57'),
            borderRadius: 6,
            background: isRunning ? '#ff5d5d' : '#2ecc71',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {isRunning ? '⏸ Hold' : '▶ Run'}
        </button>
        <span style={{ color: '#6b6b73', flex: 1 }}>{instructionText}</span>
      </footer>
    </div>
  );
}
