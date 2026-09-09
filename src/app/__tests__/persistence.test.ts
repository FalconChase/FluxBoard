import { describe, it, expect } from 'vitest';
import { GraphModel } from '../../core/GraphModel';
import { FloorLayout } from '../../floor/floorLayout';
import { SkinConfig } from '../../skin/SkinConfig';
import { ObjectRegistry } from '../../skin/ObjectRegistry';
import { GroupRegistry } from '../../skin/GroupRegistry';
import { SketchLayer } from '../sketchLayer';
import { AnnotationLayer } from '../annotationLayer';
import { serializeState, clearAllStores, populateState, makeBlankProjectData, newProjectId, type CanvasSettings } from '../persistence';

/**
 * Save/load (Falcon, 2026-09-03: "my progress lost or gets unsaved
 * like when i minimised the app... why is this?", later the same day:
 * "the file tab... create new projects, manages, and contains the
 * existing/saved projects"). These tests cover the pure serialize/
 * clear/populate logic shared by both the single-project and multi-
 * project code paths — the part that's testable without the real
 * Tauri fs plugin (loadManifest/saveManifest/loadProjectFile/
 * saveProjectFile/deleteProjectFile/loadLegacySave are thin, no-op-
 * outside-Tauri wrappers around actual disk I/O, verified separately
 * by Falcon via `npm run tauri:dev`).
 */

function buildSampleState(): {
  graph: GraphModel;
  floorLayout: FloorLayout;
  skinConfig: SkinConfig;
  sketchLayer: SketchLayer;
  annotationLayer: AnnotationLayer;
  objectRegistry: ObjectRegistry;
  groupRegistry: GroupRegistry;
  settings: CanvasSettings;
} {
  const graph = new GraphModel();
  const floorLayout = new FloorLayout();
  const skinConfig = new SkinConfig();
  const sketchLayer = new SketchLayer();
  const annotationLayer = new AnnotationLayer();
  const objectRegistry = new ObjectRegistry();
  const groupRegistry = new GroupRegistry();

  graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 1.1, itemType: 'widget' } });
  graph.addNode({ id: 'dist', kind: 'distributor', config: { mode: 'roundRobin' } });
  graph.addNode({ id: 'merge', kind: 'merger', config: {} });
  graph.addNode({ id: 'snk1', kind: 'sink', config: {} });

  floorLayout.setNodePosition('src', { x: -420, y: -60 });
  floorLayout.setNodePosition('dist', { x: -160, y: -60 });
  floorLayout.setNodePosition('merge', { x: 100, y: -60 });
  floorLayout.setNodePosition('snk1', { x: 380, y: -60 });

  graph.addEdge({ id: 'e1', source: 'src', target: 'dist', sourcePort: 0, targetPort: 0, flowRate: 0.2, active: true });
  graph.addEdge({ id: 'e2', source: 'dist', target: 'merge', sourcePort: 0, targetPort: 0, flowRate: 0.2, active: true });
  graph.addEdge({ id: 'e3', source: 'merge', target: 'snk1', sourcePort: 0, targetPort: 0, flowRate: 0.2, active: true });

  floorLayout.setEdgeCurve('e1', 'src', 'dist', 0.2);
  floorLayout.setEdgeCurve('e2', 'dist', 'merge', 0); // linear path type
  floorLayout.setEdgeCurve('e3', 'merge', 'snk1', 0.25);

  skinConfig.setEdgeSkin('e1', { style: 'conveyor', color: '#3d7fff', strokeWidth: 12, itemOrientation: 'parallel' });
  skinConfig.setEdgeSkin('e2', { style: 'transparent', itemOrientation: 'static' });
  skinConfig.setEdgeSkin('e3', {
    style: 'glassTube',
    color: '#17b3a3',
    strokeWidth: 16,
    itemOrientation: 'circling',
    spinSpeed: 3.2,
  });
  skinConfig.setNodeLocked('dist', true);
  skinConfig.setNodeZIndex('merge', 3);

  sketchLayer.add({ id: 'sk1', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } });
  annotationLayer.add({ id: 'an1', position: { x: 10, y: 20 }, icon: 'flag', label: 'checkpoint' });

  objectRegistry.create({ name: 'Widget', shape: 'square', size: 9, color: '#3d7fff' }, 'widget');

  groupRegistry.create('group-1', ['src', 'dist'], [], []);

  const settings: CanvasSettings = { gridSpacing: 64, tickIntervalMs: 400 };
  return { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings };
}

describe('persistence', () => {
  it('serializeState captures every node/edge with its position, exact anchors, bow, skin and sketches', () => {
    const { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings } = buildSampleState();
    const saved = serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);

    expect(saved.nodes).toHaveLength(4);
    expect(saved.edges).toHaveLength(3);
    expect(saved.sketches).toHaveLength(1);
    expect(saved.edgeGeometry['e2']!.bow).toBe(0); // linear path type preserved
    expect(saved.nodeSkin['dist']!.locked).toBe(true);
    expect(saved.nodeSkin['merge']!.zIndex).toBe(3);
    expect(saved.groups).toEqual([{ id: 'group-1', nodeIds: ['src', 'dist'], edgeIds: [], sketchIds: [] }]);
    expect(saved.annotations).toEqual([{ id: 'an1', position: { x: 10, y: 20 }, icon: 'flag', label: 'checkpoint' }]);
    expect(saved.settings).toEqual(settings);
  });

  it('clearAllStores empties all four stores in place (same instances, zero content)', () => {
    const { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry } = buildSampleState();
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);

    expect(graph.getAllNodes()).toHaveLength(0);
    expect(graph.getAllEdges()).toHaveLength(0);
    expect(sketchLayer.getAll()).toHaveLength(0);
    expect(annotationLayer.getAll()).toHaveLength(0);
    expect(floorLayout.getNodePosition('src')).toBeUndefined();
    expect(floorLayout.getEdgeCurve('e1')).toBeUndefined();
    expect(groupRegistry.getAll()).toHaveLength(0);
  });

  it('serialize -> clear -> populate -> re-serialize round-trips byte-for-byte identically', () => {
    const { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings } = buildSampleState();
    const original = serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);

    // A real save goes through JSON.stringify/parse on disk — round-trip that too.
    const roundTripped = JSON.parse(JSON.stringify(original));

    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
    const restoredSettings = populateState(roundTripped, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
    const resaved = serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, restoredSettings);

    expect(resaved).toEqual(original);
  });

  it('restores edges at their EXACT saved anchors, not the nearest-free auto-pick', () => {
    const { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings } = buildSampleState();
    const saved = serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);
    const originalAnchors = { ...saved.edgeGeometry['e1']! };

    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
    populateState(saved, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);

    const anchors = floorLayout.getEdgeAnchors('e1')!;
    expect(anchors.sourceAnchor).toBe(originalAnchors.sourceAnchor);
    expect(anchors.targetAnchor).toBe(originalAnchors.targetAnchor);
  });

  it('loading a different saved graph onto already-populated stores leaves zero leftover state from the old graph', () => {
    // Simulates the real App.tsx flow: the demo graph is already live
    // in these instances when a load happens.
    const { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry } = buildSampleState();

    const freshGraph = new GraphModel();
    const freshFloor = new FloorLayout();
    const freshSkin = new SkinConfig();
    const freshSketches = new SketchLayer();
    const freshAnnotations = new AnnotationLayer();
    const freshObjects = new ObjectRegistry();
    const freshGroups = new GroupRegistry();
    freshGraph.addNode({ id: 'user-node-1', kind: 'buffer', config: { capacity: 5 } });
    freshFloor.setNodePosition('user-node-1', { x: 5, y: 5 });
    const savedB = serializeState(freshGraph, freshFloor, freshSkin, freshSketches, freshAnnotations, freshObjects, freshGroups, {
      gridSpacing: 32,
      tickIntervalMs: 250,
    });

    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
    const restoredSettings = populateState(savedB, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);

    expect(graph.getAllNodes().map((n) => n.id)).toEqual(['user-node-1']);
    expect(graph.getNode('src')).toBeUndefined(); // old demo node gone
    expect(sketchLayer.getAll()).toHaveLength(0); // old sketch gone
    expect(annotationLayer.getAll()).toHaveLength(0); // old annotation gone
    expect(restoredSettings).toEqual({ gridSpacing: 32, tickIntervalMs: 250 });
  });

  // Multiple named projects (Falcon, 2026-09-03: "the file tab...
  // create new projects, manages, and contains the existing/saved
  // projects"). Actual disk I/O (loadManifest/saveProjectFile/etc.)
  // is Tauri-only and untestable here (same as saveToDisk/loadFromDisk
  // always were) — these cover the pure logic each of those wraps.
  describe('multi-project helpers', () => {
    it('makeBlankProjectData produces an empty graph with the given settings', () => {
      const settings: CanvasSettings = { gridSpacing: 8, tickIntervalMs: 400 };
      const blank = makeBlankProjectData(settings);

      expect(blank.nodes).toHaveLength(0);
      expect(blank.edges).toHaveLength(0);
      expect(blank.sketches).toHaveLength(0);
      expect(blank.settings).toEqual(settings);
    });

    it('a blank project round-trips through populateState just like any other saved graph', () => {
      const { graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry } = buildSampleState();
      const blank = makeBlankProjectData({ gridSpacing: 8, tickIntervalMs: 400 });

      clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
      const settings = populateState(blank, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);

      expect(graph.getAllNodes()).toHaveLength(0);
      expect(settings).toEqual({ gridSpacing: 8, tickIntervalMs: 400 });
    });

    it('newProjectId generates unique, non-empty ids', () => {
      const ids = new Set(Array.from({ length: 500 }, () => newProjectId()));
      expect(ids.size).toBe(500);
      for (const id of ids) expect(id.length).toBeGreaterThan(0);
    });
  });
});
