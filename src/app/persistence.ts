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
 * of App-level canvas/sim state, to and from plain-JSON files on disk
 * via Tauri's fs plugin (FBD010 rev.3 — Falcon confirmed autosave +
 * plain JSON over SQLite, 2026-09-03).
 *
 * Multiple named projects (Falcon, same day: "the file tab... create
 * new projects, manages, and contains the existing/saved projects").
 * Each project is its own file at `projects/<id>.json`; a small
 * manifest file (`fluxbord-projects.json` — MANIFEST_FILE_NAME) lists
 * every known project (id, display name, last-opened time) and which
 * one is currently active, so reopening the app returns to the same
 * project rather than always some fixed one. `loadLegacySave` reads
 * the ORIGINAL single fixed-filename save (pre-multi-project) purely
 * for one-time migration — App.tsx wraps it as a new project the
 * first time this ships to an install that already had one, so
 * nobody's existing autosaved work goes missing.
 *
 * Deliberately does NOT touch NodeRuntimeState (spawn timers, queues,
 * counters) — that's live simulation state, not saved design, the
 * same reasoning design doc §4.4 already gives for keeping it out of
 * GraphModel. A reload resumes the SAVED GRAPH, not a frozen replay
 * of the simulation moment it was saved at.
 */

const LEGACY_SAVE_FILE_NAME = 'fluxboard-save.json';
const PROJECTS_DIR_NAME = 'projects';
const MANIFEST_FILE_NAME = 'fluxboard-projects.json';
const SAVE_VERSION = 1;

export interface ProjectMeta {
  id: string;
  name: string;
  lastOpenedAt: number;
}

export interface ProjectsManifest {
  activeProjectId: string;
  projects: ProjectMeta[];
}

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

/** Loads Tauri's fs plugin and makes sure the app's own AppData
 * directory exists (not guaranteed on a brand-new install — Tauri
 * doesn't pre-create it just because tauri.conf.json declares an
 * identifier) before any write happens. Shared by every write path
 * below so that check only lives in one place. '' addresses the base
 * directory itself, not a subfolder of it. */
async function readyFs() {
  const fs = await import('@tauri-apps/plugin-fs');
  const dirExists = await fs.exists('', { baseDir: fs.BaseDirectory.AppData });
  if (!dirExists) {
    await fs.mkdir('', { baseDir: fs.BaseDirectory.AppData, recursive: true });
  }
  return fs;
}

function projectFilePath(id: string): string {
  return `${PROJECTS_DIR_NAME}/${id}.json`;
}

/** A fresh, empty project's starting content — no nodes/edges/
 * sketches, just the given canvas settings. What "+ New project"
 * (the File tab) creates. */
export function makeBlankProjectData(settings: CanvasSettings): SavedFile {
  return {
    version: SAVE_VERSION,
    nodes: [],
    edges: [],
    nodePositions: {},
    edgeGeometry: {},
    nodeSkin: {},
    edgeSkin: {},
    sketches: [],
    settings,
  };
}

/** Short, unique-enough id for a new project's filename — not a
 * user-facing name (that's ProjectMeta.name, freely editable). */
export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Reads the project manifest (which projects exist, which is
 * active), or undefined if there isn't one yet (first run ever, a
 * pre-multi-project install that hasn't migrated yet, or running
 * outside Tauri). Corrupt/unreadable is treated the same as "none". */
export async function loadManifest(): Promise<ProjectsManifest | undefined> {
  if (!isTauri()) return undefined;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const exists = await fs.exists(MANIFEST_FILE_NAME, { baseDir: fs.BaseDirectory.AppData });
    if (!exists) return undefined;
    const text = await fs.readTextFile(MANIFEST_FILE_NAME, { baseDir: fs.BaseDirectory.AppData });
    return JSON.parse(text) as ProjectsManifest;
  } catch (err) {
    console.error('FluxBoard: reading the project list failed', err);
    return undefined;
  }
}

/** Writes the project manifest. Failures are logged, not thrown —
 * same "never crash the app over a save" convention as every other
 * write here. */
export async function saveManifest(manifest: ProjectsManifest): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await readyFs();
    await fs.writeTextFile(MANIFEST_FILE_NAME, JSON.stringify(manifest), { baseDir: fs.BaseDirectory.AppData });
  } catch (err) {
    console.error('FluxBoard: saving the project list failed', err);
  }
}

/** Reads one project's saved graph, or undefined if it's missing/
 * unreadable/running outside Tauri — same "treat as none" convention
 * as every other read here. */
export async function loadProjectFile(id: string): Promise<SavedFile | undefined> {
  if (!isTauri()) return undefined;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const path = projectFilePath(id);
    const exists = await fs.exists(path, { baseDir: fs.BaseDirectory.AppData });
    if (!exists) return undefined;
    const text = await fs.readTextFile(path, { baseDir: fs.BaseDirectory.AppData });
    const parsed = JSON.parse(text) as SavedFile;
    if (parsed.version !== SAVE_VERSION) {
      console.warn(`FluxBoard: project "${id}" is save version ${parsed.version}, expected ${SAVE_VERSION} — ignoring it`);
      return undefined;
    }
    return parsed;
  } catch (err) {
    console.error(`FluxBoard: loading project "${id}" failed`, err);
    return undefined;
  }
}

/** Writes one project's graph — this is what autosave calls every
 * tick, targeting whichever project is currently active. */
export async function saveProjectFile(id: string, saved: SavedFile): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await readyFs();
    await fs.mkdir(PROJECTS_DIR_NAME, { baseDir: fs.BaseDirectory.AppData, recursive: true });
    await fs.writeTextFile(projectFilePath(id), JSON.stringify(saved), { baseDir: fs.BaseDirectory.AppData });
  } catch (err) {
    console.error(`FluxBoard: saving project "${id}" failed`, err);
  }
}

/** Deletes one project's file from disk (the manifest entry is the
 * caller's own responsibility — App.tsx removes it and rewrites the
 * manifest right after this succeeds). Never called on the currently
 * ACTIVE project — the File tab disables that button — so there's
 * always something left open in the UI regardless of outcome here. */
export async function deleteProjectFile(id: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.remove(projectFilePath(id), { baseDir: fs.BaseDirectory.AppData });
  } catch (err) {
    console.error(`FluxBoard: deleting project "${id}" failed`, err);
  }
}

/** Reads the ORIGINAL pre-multi-project fixed save file
 * (`fluxboard-save.json`, SES024) — migration-only. App.tsx calls
 * this exactly once, the first time loadManifest() comes back empty,
 * so an install that already had SES024's single autosaved file gets
 * it wrapped into a new project instead of silently losing it. Once
 * the manifest exists this is never read again; the file itself is
 * left on disk untouched (harmless orphan) rather than deleted. */
export async function loadLegacySave(): Promise<SavedFile | undefined> {
  if (!isTauri()) return undefined;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const exists = await fs.exists(LEGACY_SAVE_FILE_NAME, { baseDir: fs.BaseDirectory.AppData });
    if (!exists) return undefined;
    const text = await fs.readTextFile(LEGACY_SAVE_FILE_NAME, { baseDir: fs.BaseDirectory.AppData });
    const parsed = JSON.parse(text) as SavedFile;
    if (parsed.version !== SAVE_VERSION) return undefined;
    return parsed;
  } catch (err) {
    console.error('FluxBoard: reading the legacy save file failed', err);
    return undefined;
  }
}
