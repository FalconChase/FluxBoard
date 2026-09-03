import { GraphModel } from '../core/GraphModel';
import { FloorLayout } from '../floor/floorLayout';
import { SkinConfig } from '../skin/SkinConfig';
import type { EdgeSkin } from '../skin/pathSkin';
import { SketchLayer, type Sketch } from './sketchLayer';
import type { EdgeId, NodeDef, EdgeDef, NodeId } from '../core/types';
import type { Point } from '../floor/bezier';

/**
 * Save/load (Falcon, 2026-09-03: "my progress lost or gets unsaved
 * like when i minimised the app or some other actions my set up gets
 * lost. why is this?"). Root cause: FluxBoard never had a
 * persistence layer — App.tsx built a fresh in-memory graph every
 * mount. This module is the fix: serialize the four mutable stores
 * (GraphModel/FloorLayout/SkinConfig/SketchLayer) plus the small bit
 * of App-level canvas/sim state, to and from one plain-JSON file on
 * disk via Tauri's fs plugin (FBD010 rev.2's "or plain JSON" option
 * — Falcon confirmed JSON over SQLite, 2026-09-03).
 *
 * Deliberately does NOT touch NodeRuntimeState (spawn timers, queues,
 * counters) — that's live simulation state, not saved design, the
 * same reasoning design doc §4.4 already gives for keeping it out of
 * GraphModel. A reload resumes the SAVED GRAPH, not a frozen replay
 * of the simulation moment it was saved at.
 */

const SAVE_FILE_NAME = 'fluxboard-save.json';
const SAVE_VERSION = 1;

export interface CanvasSettings {
  gridSpacing: number;
  tickIntervalMs: number;
}

interface EdgeGeometry {
  sourceAnchor: number;
  targetAnchor: number;
  bow: number;
}

interface NodeSkinEntry {
  zIndex: number;
  locked: boolean;
}

export interface SavedFile {
  version: number;
  nodes: NodeDef[];
  edges: EdgeDef[];
  nodePositions: Record<NodeId, Point>;
  edgeGeometry: Record<EdgeId, EdgeGeometry>;
  nodeSkin: Record<NodeId, NodeSkinEntry>;
  edgeSkin: Record<EdgeId, EdgeSkin>;
  sketches: Sketch[];
  settings: CanvasSettings;
}

/** Reads everything out of the four live stores (they're the single
 * source of truth, design doc §4.6 — this never keeps its own copy)
 * into one plain-JSON-serializable snapshot. */
export function serializeState(
  graph: GraphModel,
  floorLayout: FloorLayout,
  skinConfig: SkinConfig,
  sketchLayer: SketchLayer,
  settings: CanvasSettings,
): SavedFile {
  const nodes = graph.getAllNodes();
  const edges = graph.getAllEdges();

  const nodePositions: Record<NodeId, Point> = {};
  const nodeSkin: Record<NodeId, NodeSkinEntry> = {};
  for (const node of nodes) {
    const pos = floorLayout.getNodePosition(node.id);
    if (pos) nodePositions[node.id] = pos;
    nodeSkin[node.id] = { zIndex: skinConfig.getNodeZIndex(node.id), locked: skinConfig.getNodeLocked(node.id) };
  }

  const edgeGeometry: Record<EdgeId, EdgeGeometry> = {};
  const edgeSkin: Record<EdgeId, EdgeSkin> = {};
  for (const edge of edges) {
    const anchors = floorLayout.getEdgeAnchors(edge.id);
    if (anchors) {
      edgeGeometry[edge.id] = {
        sourceAnchor: anchors.sourceAnchor,
        targetAnchor: anchors.targetAnchor,
        bow: floorLayout.getEdgeBow(edge.id),
      };
    }
    edgeSkin[edge.id] = skinConfig.getEdgeSkin(edge.id);
  }

  return {
    version: SAVE_VERSION,
    nodes,
    edges,
    nodePositions,
    edgeGeometry,
    nodeSkin,
    edgeSkin,
    sketches: sketchLayer.getAll(),
    settings,
  };
}

/** Empties all four live stores in place — same cascade App.tsx's
 * handleDeleteSelection already uses for a single node (removeNode
 * returns the edge ids it cascaded away, so Floor/Skin can drop them
 * too), just run over every node. Existing store INSTANCES are kept
 * (never replaced) so App.tsx's stable useMemo singletons, and every
 * child component holding a reference to them, stay valid across a
 * load — only their contents change. Called right before
 * populateState so a load fully replaces whatever demo/previous graph
 * was showing, rather than merging into it. */
export function clearAllStores(
  graph: GraphModel,
  floorLayout: FloorLayout,
  skinConfig: SkinConfig,
  sketchLayer: SketchLayer,
): void {
  for (const node of graph.getAllNodes()) {
    const cascadedEdgeIds = graph.removeNode(node.id);
    floorLayout.removeNodePosition(node.id);
    skinConfig.removeNode(node.id);
    for (const edgeId of cascadedEdgeIds) {
      floorLayout.removeEdgeCurve(edgeId);
      skinConfig.removeEdge(edgeId);
    }
  }

  for (const sketch of sketchLayer.getAll()) {
    sketchLayer.remove(sketch.id);
  }
}

/** Populates the given (already-constructed, already-empty) stores
 * from a saved snapshot — mutates them in place rather than building
 * fresh instances, so callers can pass the SAME singleton instances
 * App.tsx has been using all along (see clearAllStores above for why
 * that matters). Nodes are added before their positions (FloorLayout
 * doesn't require it, but reads more naturally that way), and edges
 * are added — and their curves restored at the EXACT saved anchors
 * via FloorLayout.restoreEdgeCurve, not the nearest-free-anchor
 * auto-pick — only after every node exists (GraphModel.addEdge
 * validates both endpoints up front). Returns the saved canvas
 * settings for the caller to apply (grid spacing, tick interval)
 * since those live in App.tsx's own useState, not a store. */
export function populateState(
  saved: SavedFile,
  graph: GraphModel,
  floorLayout: FloorLayout,
  skinConfig: SkinConfig,
  sketchLayer: SketchLayer,
): CanvasSettings {
  for (const node of saved.nodes) {
    graph.addNode(node);
    const pos = saved.nodePositions[node.id];
    if (pos) floorLayout.setNodePosition(node.id, pos);
    const skin = saved.nodeSkin[node.id];
    if (skin) {
      skinConfig.setNodeZIndex(node.id, skin.zIndex);
      skinConfig.setNodeLocked(node.id, skin.locked);
    }
  }

  for (const edge of saved.edges) {
    graph.addEdge(edge);
    const geometry = saved.edgeGeometry[edge.id];
    if (geometry) {
      floorLayout.restoreEdgeCurve(
        edge.id,
        edge.source,
        geometry.sourceAnchor,
        edge.target,
        geometry.targetAnchor,
        geometry.bow,
      );
    }
    const skin = saved.edgeSkin[edge.id];
    if (skin) skinConfig.setEdgeSkin(edge.id, skin);
  }

  for (const sketch of saved.sketches) {
    sketchLayer.add(sketch);
  }

  return saved.settings;
}

/** True while running inside the actual Tauri desktop shell — the fs
 * plugin's bridge only exists there, never in a plain `npm run dev`
 * browser tab (Milestone 2's original dev workflow). Save/load is a
 * silent no-op outside Tauri rather than an error, so `npm run dev`
 * keeps working exactly as it always has for quick iteration. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Writes the save file to the app's own AppData directory (Tauri's
 * fs plugin, scoped there via src-tauri/capabilities/default.json —
 * never anywhere else on disk). Failures are logged, not thrown —
 * autosave running in the background shouldn't ever crash the app or
 * interrupt what the person is doing. */
export async function saveToDisk(saved: SavedFile): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    // The app's AppData directory isn't guaranteed to exist yet on a
    // brand-new install (Tauri doesn't pre-create it just because
    // tauri.conf.json declares an identifier) — create it if missing
    // before the first write ever happens. '' addresses the base
    // directory itself, not a subfolder of it.
    const dirExists = await fs.exists('', { baseDir: fs.BaseDirectory.AppData });
    if (!dirExists) {
      await fs.mkdir('', { baseDir: fs.BaseDirectory.AppData, recursive: true });
    }
    await fs.writeTextFile(SAVE_FILE_NAME, JSON.stringify(saved), { baseDir: fs.BaseDirectory.AppData });
  } catch (err) {
    console.error('FluxBoard: autosave failed', err);
  }
}

/** Reads the save file back, or returns undefined if there isn't one
 * yet (first run ever, or running outside Tauri) — the caller falls
 * back to the built-in demo graph in that case. A corrupt/unreadable
 * file is treated the same as "none" (logged, not thrown) rather than
 * blocking the app from starting at all. */
export async function loadFromDisk(): Promise<SavedFile | undefined> {
  if (!isTauri()) return undefined;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const exists = await fs.exists(SAVE_FILE_NAME, { baseDir: fs.BaseDirectory.AppData });
    if (!exists) return undefined;
    const text = await fs.readTextFile(SAVE_FILE_NAME, { baseDir: fs.BaseDirectory.AppData });
    const parsed = JSON.parse(text) as SavedFile;
    if (parsed.version !== SAVE_VERSION) {
      console.warn(`FluxBoard: save file is version ${parsed.version}, expected ${SAVE_VERSION} — ignoring it`);
      return undefined;
    }
    return parsed;
  } catch (err) {
    console.error('FluxBoard: loading the save file failed, starting fresh', err);
    return undefined;
  }
}
