import { useEffect, useMemo, useRef, useState } from 'react';
import { FloorLayout, NODE_RADIUS } from '../floor/floorLayout';
import { FluxCanvas, type FluxCanvasHandle, type SketchStyle } from './FluxCanvas';
import { GraphModel } from '../core/GraphModel';
import type { EdgeId, NodeId, NodeKind } from '../core/types';
import type { Point } from '../floor/bezier';
import { SkinConfig } from '../skin/SkinConfig';
import { getPortCapacity } from '../core/nodes/portCapacity';
import type { EdgeStyle } from '../skin/pathSkin';
import { LeftPanel } from './LeftPanel';
import { Ribbon, type RibbonTab } from './Ribbon';
import { StatusBar } from './StatusBar';
import { PropertiesPanel } from './PropertiesPanel';
import { ObjectRegistryManager } from './ObjectRegistryManager';
import { collapseSelection, type Selection } from './selection';
import { SketchLayer, type Sketch, type SketchAttachment, type SketchSegment } from './sketchLayer';
import { ObjectRegistry } from '../skin/ObjectRegistry';
import { theme, type CanvasBackground } from './theme';
import {
  clearAllStores,
  deleteProjectFile,
  loadLegacySave,
  loadManifest,
  loadProjectFile,
  makeBlankProjectData,
  newProjectId,
  populateState,
  saveManifest,
  saveProjectFile,
  serializeState,
  type CanvasSettings,
  type SavedFile,
  type ProjectMeta,
  type ProjectsManifest,
} from './persistence';

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
    case 'merger':
      return {};
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

/** After a load, later placements must not collide with an id
 * already used in the save file — nextIdRef is one shared counter
 * for nodes/edges/sketches (`user-node-N` / `user-edge-N` /
 * `sketch-N`), so this scans every loaded id and fast-forwards the
 * counter past whatever's highest already in use. */
function advanceNextIdPast(ref: { current: number }, ids: string[]): void {
  const pattern = /-(\d+)$/;
  for (const id of ids) {
    const match = pattern.exec(id);
    if (!match) continue;
    const n = Number(match[1]);
    if (n >= ref.current) ref.current = n + 1;
  }
}

export function App() {
  const graph = useMemo(() => buildDemoGraph(), []);
  const floorLayout = useMemo(() => buildDemoFloorLayout(), []);
  const skinConfig = useMemo(() => buildDemoSkinConfig(), []);
  const sketchLayer = useMemo(() => new SketchLayer(), []);
  // OBJECTS registry (FBP011, 2026-09-05) — same "stable singleton,
  // mutated directly, single source of truth" convention as the four
  // stores above (design doc §4.6).
  const objectRegistry = useMemo(() => new ObjectRegistry(), []);

  // Milestone 5 (minimal-chrome scope, FBP008 resolved): selection +
  // node placement + body-to-body wiring. graph/floorLayout/skinConfig
  // are mutated directly (they're the single source of truth, design
  // doc §4.6) — the canvas picks up any change on its next animation
  // frame with no extra plumbing; only selection/placement state needs
  // to be real React state, since the ribbon/properties panel need to
  // re-render on those.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [placementKind, setPlacementKind] = useState<NodeKind | null>(null);
  // Falcon, 2026-09-03: wants an 8-unit grid, on by default (was
  // 64/off) — snap-to-grid is still an F8/ribbon toggle, just starts
  // enabled instead of needing a manual first press.
  const [snapToGrid, setSnapToGrid] = useState(true);
  const nextIdRef = useRef(1);

  // UI chrome: which ribbon tab is showing, the PATHS group's armed
  // style, and the canvas/simulation settings the ribbon's VIEW tab
  // edits. isRunning mirrors FluxCanvas's own RUN/HOLD state so the
  // status bar's Play/Pause button can show the right label — the
  // actual toggle is called through fluxCanvasRef since the sim
  // driver only exists inside FluxCanvas's own effect.
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTab>('home');
  const [armedEdgeStyle, setArmedEdgeStyle] = useState<EdgeStyle | null>(null);
  // Planning sketches (Falcon, 2026-09-03): pure visual scratch lines,
  // no simulation meaning, not tied to any node — sketchArmed mirrors
  // placementKind/armedEdgeStyle's arm-then-act flow but the "act" is
  // just a drag anywhere on the canvas (see FluxCanvas's onCreateSketch).
  const [sketchArmed, setSketchArmed] = useState(false);
  // Falcon, 2026-09-05 ("no way to end the continuous lines" ->
  // proposed a 'path style' dropdown, mirroring Multi-select's
  // quick-select flyout): which gesture the armed Sketch tool uses.
  // Defaults to 'single' -- the original one-drag-one-segment
  // behavior -- since that's what broke when 'polypath' became the
  // only gesture; 'polypath' is opted into per the Ribbon dropdown.
  const [sketchStyle, setSketchStyle] = useState<SketchStyle>('single');
  // FBP014 (2026-09-05): the ribbon MODIFY group's remaining two
  // tools -- Multi-select (marquee + click-to-toggle, building a
  // Selection {type:'multi'} in FluxCanvas) and Pan (forces every
  // drag to pan, mirrors the same arm-then-act flow as everything
  // above). Mutually exclusive with placementKind/armedEdgeStyle/
  // sketchArmed and with each other -- see the handleArm* functions.
  const [multiSelectArmed, setMultiSelectArmed] = useState(false);
  /** Which kind the armed Multi-select tool's next marquee drag (or
   * click-to-toggle, nodes only) is scoped to (Falcon, 2026-09-05,
   * after seeing "Paths only" grab every path project-wide: "the
   * multiselect is the selection base on the highlighted area or
   * selected area" -- i.e. drag a box yourself, only items of the
   * picked kind inside it join the selection). Reset to 'nodes' -- the
   * original default behavior -- whenever the tool is (re)armed via
   * the plain ribbon button; a quick-select pick narrows it right
   * after (handleQuickSelect). */
  const [quickSelectFilter, setQuickSelectFilter] = useState<'all' | 'nodes' | 'paths' | 'sketches'>('nodes');
  const [panArmed, setPanArmed] = useState(false);
  const [gridSpacing, setGridSpacing] = useState(8);
  const [tickIntervalMs, setTickIntervalMs] = useState(400);
  // Falcon, 2026-09-04: "I WANT THE BOARD OR THE WORKSPACE BE SET TO
  // WHITE ALSO MAYBE WE NEED SETTINGS ON VIEW FOR WORKSPACE THEME OR
  // BACKGROUND COLOR" — per-project, persisted alongside gridSpacing/
  // tickIntervalMs in CanvasSettings.
  const [canvasBackground, setCanvasBackground] = useState<CanvasBackground>('white');
  const [cursorWorldPosition, setCursorWorldPosition] = useState<Point | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const fluxCanvasRef = useRef<FluxCanvasHandle | null>(null);
  // FBP011 (2026-09-05): the ribbon's Objects button opens this modal
  // rather than arming a placement mode, since a type is a referenced
  // library entry, not something dropped on the canvas.
  const [objectsManagerOpen, setObjectsManagerOpen] = useState(false);
  // Falcon, 2026-09-05: "a rejected connection attempt... fails
  // completely silently, no message explaining why" — a short-lived
  // reason shown in the status bar's instruction strip in place of
  // the normal contextual hint, auto-clearing so it never lingers
  // past its own relevance.
  const [transientMessage, setTransientMessage] = useState<string | null>(null);
  const transientMessageTimeoutRef = useRef<number | null>(null);
  // Read inside the autosave effect below without needing gridSpacing/
  // tickIntervalMs/canvasBackground in its deps (same "ref mirrors
  // current state" convention FluxCanvas already uses for its
  // interaction props).
  const gridSpacingRef = useRef(gridSpacing);
  gridSpacingRef.current = gridSpacing;
  const tickIntervalMsRef = useRef(tickIntervalMs);
  tickIntervalMsRef.current = tickIntervalMs;
  const canvasBackgroundRef = useRef(canvasBackground);
  canvasBackgroundRef.current = canvasBackground;

  /** Undo/redo (Falcon, 2026-09-05: "i want to activate the undo and
   * redo features also"). Implemented as full-project snapshots —
   * Falcon's own pick after asking which approach — reusing
   * persistence.ts's serializeState/clearAllStores/populateState
   * verbatim, the same "wipe everything, rebuild from JSON" code the
   * autosave/project-load paths already rely on, rather than hand-
   * writing an inverse for every mutating call across the 5 stores
   * (GraphModel/FloorLayout/SkinConfig/ObjectRegistry/SketchLayer are
   * all mutated directly from PropertiesPanel/ObjectRegistryManager/
   * FluxCanvas as well as App.tsx's own handlers — there's no single
   * choke point to hang per-action undo records off of).
   *
   * Scope, per Falcon's own pick: content only (nodes, paths,
   * sketches, object types, and their positions/skins) — camera pan/
   * zoom, grid spacing, snap-to-grid, tick rate, and canvas
   * background are never captured as a step and are never reverted.
   * That's why every comparison below strips `settings` out first,
   * and a restore never applies the snapshot's `settings` back.
   *
   * Granularity, per Falcon's own pick: "a whole drag is one step",
   * not one step per frame or per keystroke. None of the 5 stores
   * emit a change event (design doc §4.6: plain mutated classes, read
   * every frame, never a second source of truth to keep in sync) —
   * so instead of instrumenting every call site, this polls a cheap
   * JSON snapshot every 250ms and only COMMITS a step once the
   * content has gone quiet for 600ms (see the effect further below).
   * A burst of rapid changes — continuous drag frames, keystroke-by-
   * keystroke property edits — keeps resetting that quiet timer, so
   * it collapses into exactly one step by the time it commits.
   * (Simulation itself — items flowing while Run is active — never
   * shows up here at all: serializeState already deliberately
   * excludes NodeRuntimeState, so a running sim doesn't spam the
   * history with phantom "changes" every frame.) */
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoHistoryRef = useRef<SavedFile[]>([]);
  const undoIndexRef = useRef(0);
  const undoLastSeenRef = useRef<string | null>(null);
  const undoLastChangeAtRef = useRef(0);
  const undoDirtyRef = useRef(false);
  const undoRestoringRef = useRef(false);

  // Multiple named projects (Falcon, 2026-09-03: "the file tab...
  // create new projects, manages, and contains the existing/saved
  // projects"). `projects`/`activeProjectId` are React state so the
  // left rail re-renders; `activeProjectIdRef` mirrors activeProjectId
  // for the autosave effect below (same ref convention as gridSpacing/
  // tickIntervalMs) so autosave always targets whichever project is
  // CURRENTLY open without needing to restart its interval.
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);

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
      // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) — guarded the same way as
      // Delete/Backspace/F8 above, so Ctrl+Z while actually typing in
      // a text field does the browser's own native text-undo instead
      // of stepping the app's history.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !isEditableTarget(e.target)) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget(e.target)) {
        e.preventDefault();
        handleDeleteSelection();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // handleDeleteSelection/handleUndo/handleRedo close over current
    // state on every render already (plain functions, not memoized) —
    // omitted from deps deliberately, same reasoning FluxCanvas's own
    // effect documents for its interaction props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistence (Falcon, 2026-09-03: "my progress lost or gets
  // unsaved... why is this?", then later the same day: "the file
  // tab... create new projects, manages, and contains the existing/
  // saved projects"). On mount: read the project manifest; if there
  // isn't one yet, either migrate the ORIGINAL pre-multi-project
  // fixed save file (an install that already had autosave running
  // before this shipped) or bootstrap a fresh project from whatever's
  // currently showing (the demo graph, or a blank canvas outside
  // Tauri) — either way, exactly one project now exists and is
  // active. Then load that active project's data and replace the
  // demo graph with it IN PLACE — clearAllStores empties, then
  // populateState refills, the SAME graph/floorLayout/skinConfig/
  // sketchLayer instances every other component already holds a
  // reference to, rather than swapping in new ones (deliberate:
  // avoids a null/loading React-state window and any risk to the
  // keydown effect just above, which closes over these instances once
  // at mount). Outside Tauri, every read/write below silently no-ops
  // (persistence.ts's isTauri guard) — projects/activeProjectId still
  // get set from an in-memory-only manifest, so the left rail still
  // works for organizing within the session, it just doesn't survive
  // a reload there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let manifest = await loadManifest();

      if (!manifest) {
        const legacy = await loadLegacySave();
        const id = newProjectId();
        const settings: CanvasSettings = {
          gridSpacing: gridSpacingRef.current,
          tickIntervalMs: tickIntervalMsRef.current,
          canvasBackground: canvasBackgroundRef.current,
        };
        const data = legacy ?? serializeState(graph, floorLayout, skinConfig, sketchLayer, objectRegistry, settings);
        await saveProjectFile(id, data);
        manifest = {
          activeProjectId: id,
          projects: [{ id, name: legacy ? 'My Project' : 'My First Project', lastOpenedAt: Date.now() }],
        };
        await saveManifest(manifest);
      }

      if (cancelled) return;

      const activeData = await loadProjectFile(manifest.activeProjectId);
      if (activeData) {
        clearAllStores(graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
        const settings = populateState(activeData, graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
        setGridSpacing(settings.gridSpacing);
        setTickIntervalMs(settings.tickIntervalMs);
        setCanvasBackground(settings.canvasBackground ?? 'white');
        advanceNextIdPast(nextIdRef, [
          ...activeData.nodes.map((n) => n.id),
          ...activeData.edges.map((e) => e.id),
          ...activeData.sketches.map((s) => s.id),
        ]);
      }
      // else: the active project's file is missing (outside Tauri, or
      // deleted out from under us) — leave whatever's currently live
      // (the demo graph) untouched, same as before this feature.

      if (cancelled) return;
      resetUndoHistory();
      activeProjectIdRef.current = manifest.activeProjectId;
      setActiveProjectId(manifest.activeProjectId);
      setProjects(manifest.projects);
    })();
    return () => {
      cancelled = true;
    };
    // graph/floorLayout/skinConfig/sketchLayer are stable useMemo
    // singletons (never reassigned) and nextIdRef/activeProjectIdRef
    // are refs — safe to omit, same reasoning the keydown effect
    // above documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave: a periodic tick plus every "the person might be about
  // to lose this" moment (tab/window hidden — covers minimizing, the
  // case Falcon reported — and the page actually closing). Settings
  // are read through the refs above so this effect never needs
  // gridSpacing/tickIntervalMs/canvasBackground in its deps and the
  // interval never has to be torn down and restarted when they
  // change. Targets whichever project is CURRENTLY active via
  // activeProjectIdRef, same reason — switching projects doesn't need
  // to restart this effect either. Skips silently until the mount
  // effect above has resolved an active project (a few ticks at
  // most).
  useEffect(() => {
    function doSave(): void {
      if (!activeProjectIdRef.current) return;
      const settings: CanvasSettings = {
        gridSpacing: gridSpacingRef.current,
        tickIntervalMs: tickIntervalMsRef.current,
        canvasBackground: canvasBackgroundRef.current,
      };
      const saved = serializeState(graph, floorLayout, skinConfig, sketchLayer, objectRegistry, settings);
      void saveProjectFile(activeProjectIdRef.current, saved);
    }

    const intervalId = window.setInterval(doSave, 3000);

    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') doSave();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', doSave);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', doSave);
    };
    // graph/floorLayout/skinConfig/sketchLayer are stable singletons —
    // safe to omit, same reasoning as the load effect just above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const UNDO_HISTORY_LIMIT = 100;
  const UNDO_POLL_MS = 250;
  const UNDO_QUIET_MS = 600;

  /** Same shape flushActiveProjectSave/doSave already build — one
   * full snapshot of the 5 live stores plus today's settings. */
  function captureContentSnapshot(): SavedFile {
    const settings: CanvasSettings = {
      gridSpacing: gridSpacingRef.current,
      tickIntervalMs: tickIntervalMsRef.current,
      canvasBackground: canvasBackgroundRef.current,
    };
    return serializeState(graph, floorLayout, skinConfig, sketchLayer, objectRegistry, settings);
  }

  /** `settings` deliberately excluded (undo/redo scope note above) —
   * two snapshots taken back to back with no CONTENT change produce
   * an identical string here even if `settings` itself differs. */
  function contentFingerprint(saved: SavedFile): string {
    return JSON.stringify({ ...saved, settings: undefined });
  }

  /** Called whenever the live content is replaced wholesale from
   * outside the undo system itself — initial project load, switching
   * projects, creating a new one. Starts a fresh history with
   * whatever's on screen right now as the only (and current) entry,
   * so a project switch can never be "undone" back into whatever
   * project was open before it. */
  function resetUndoHistory(): void {
    const snap = captureContentSnapshot();
    undoHistoryRef.current = [snap];
    undoIndexRef.current = 0;
    undoLastSeenRef.current = contentFingerprint(snap);
    undoDirtyRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
  }

  /** Shared by handleUndo/handleRedo — jumps to an exact index in the
   * history and re-syncs the poller's own bookkeeping so it doesn't
   * mistake this restore for a fresh user change on its very next
   * tick (undoRestoringRef.current guards the poller itself too). */
  function restoreUndoSnapshot(index: number): void {
    const snap = undoHistoryRef.current[index];
    if (!snap) return;
    undoRestoringRef.current = true;
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
    populateState(snap, graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
    // The returned settings are deliberately NOT applied here — see
    // the undo/redo scope note above; today's live grid/tick/theme
    // values are left exactly as they were.
    undoIndexRef.current = index;
    undoLastSeenRef.current = contentFingerprint(snap);
    undoDirtyRef.current = false;
    setSelection(null);
    setCanUndo(undoIndexRef.current > 0);
    setCanRedo(undoIndexRef.current < undoHistoryRef.current.length - 1);
    undoRestoringRef.current = false;
  }

  function handleUndo(): void {
    if (undoIndexRef.current <= 0) return;
    restoreUndoSnapshot(undoIndexRef.current - 1);
  }

  function handleRedo(): void {
    if (undoIndexRef.current >= undoHistoryRef.current.length - 1) return;
    restoreUndoSnapshot(undoIndexRef.current + 1);
  }

  // Polls for a quiet moment after a content change to commit exactly
  // ONE undo step per completed action (see the undo/redo state block
  // above for the full reasoning). Skipped entirely while a restore
  // is in progress (undoRestoringRef) or before any project has
  // loaded yet (activeProjectIdRef).
  useEffect(() => {
    function tick(): void {
      if (undoRestoringRef.current || !activeProjectIdRef.current) return;
      const current = captureContentSnapshot();
      const fingerprint = contentFingerprint(current);

      if (fingerprint !== undoLastSeenRef.current) {
        undoLastSeenRef.current = fingerprint;
        undoLastChangeAtRef.current = Date.now();
        undoDirtyRef.current = true;
        return;
      }

      if (undoDirtyRef.current && Date.now() - undoLastChangeAtRef.current >= UNDO_QUIET_MS) {
        undoHistoryRef.current = undoHistoryRef.current.slice(0, undoIndexRef.current + 1);
        undoHistoryRef.current.push(current);
        if (undoHistoryRef.current.length > UNDO_HISTORY_LIMIT) undoHistoryRef.current.shift();
        undoIndexRef.current = undoHistoryRef.current.length - 1;
        undoDirtyRef.current = false;
        setCanUndo(undoIndexRef.current > 0);
        setCanRedo(false);
      }
    }

    const intervalId = window.setInterval(tick, UNDO_POLL_MS);
    return () => window.clearInterval(intervalId);
    // graph/floorLayout/skinConfig/sketchLayer/objectRegistry are
    // stable singletons and everything else here is a ref — safe to
    // omit, same reasoning as the autosave effect just above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const SPEED_LOCK_POLL_MS = 250;

  /** Falcon, 2026-09-05 ("the longer the path the faster it is, the
   * shorter the path the slower is it ... Option D"): keeps every
   * speed-locked edge's flowRate solved for its OWN pinned real-world
   * speed against the path's CURRENT length, so dragging a node (or
   * editing curvature, or reassigning an anchor) never lets the
   * apparent speed drift the way it does for an unlocked edge. Poll-
   * based for the same reason undo/redo is (design doc §4.6 — Floor-
   * layer length changes happen through several different mutation
   * sites: node moves, curvature edits, anchor reassignment — no
   * single handler to instrument instead). Edges with no lock are
   * untouched, so this changes nothing for the common case. */
  useEffect(() => {
    function tick(): void {
      for (const edge of graph.getAllEdges()) {
        if (!edge.speedLocked || edge.lockedSpeed === undefined) continue;
        const length = floorLayout.getEdgeCurve(edge.id)?.totalLength ?? 0;
        if (length <= 0) continue;
        const targetFlowRate = edge.lockedSpeed / length;
        if (Math.abs(edge.flowRate - targetFlowRate) > 1e-9) {
          graph.setEdgeFlowRate(edge.id, targetFlowRate);
        }
      }
    }
    const intervalId = window.setInterval(tick, SPEED_LOCK_POLL_MS);
    return () => window.clearInterval(intervalId);
    // graph/floorLayout are stable singletons — safe to omit, same
    // reasoning as the undo-poll effect just above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Writes the CURRENTLY active project's data immediately (not
   * waiting for the next autosave tick) — called right before
   * switching/creating a project so nothing typed in the last few
   * seconds is lost to the interval's own timing. No-op if no project
   * is active yet (mount effect above hasn't resolved). */
  async function flushActiveProjectSave(): Promise<void> {
    if (!activeProjectIdRef.current) return;
    const settings: CanvasSettings = {
      gridSpacing: gridSpacingRef.current,
      tickIntervalMs: tickIntervalMsRef.current,
      canvasBackground: canvasBackgroundRef.current,
    };
    const saved = serializeState(graph, floorLayout, skinConfig, sketchLayer, objectRegistry, settings);
    await saveProjectFile(activeProjectIdRef.current, saved);
  }

  /** Writes the manifest with a given active id + project list, and
   * mirrors the list into React state in the same call — every left-
   * rail action below goes through this so the on-disk manifest and
   * the on-screen list never drift apart. */
  function persistManifest(activeId: string, nextProjects: ProjectMeta[]): void {
    setProjects(nextProjects);
    const manifest: ProjectsManifest = { activeProjectId: activeId, projects: nextProjects };
    void saveManifest(manifest);
  }

  /** Left rail: switch to a different existing project. Flushes the
   * outgoing project's save first (so a switch never loses recent
   * work), then clears/repopulates the SAME live store instances from
   * the target project's data — identical in spirit to the mount
   * effect's initial load, just triggered by a click instead of
   * startup. */
  async function handleSwitchProject(id: string): Promise<void> {
    if (id === activeProjectIdRef.current) return;
    await flushActiveProjectSave();
    const data = await loadProjectFile(id);
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
    if (data) {
      const settings = populateState(data, graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
      setGridSpacing(settings.gridSpacing);
      setTickIntervalMs(settings.tickIntervalMs);
      setCanvasBackground(settings.canvasBackground ?? 'white');
      advanceNextIdPast(nextIdRef, [
        ...data.nodes.map((n) => n.id),
        ...data.edges.map((e) => e.id),
        ...data.sketches.map((s) => s.id),
      ]);
    } else {
      nextIdRef.current = 1;
    }
    resetUndoHistory();
    setSelection(null);
    activeProjectIdRef.current = id;
    setActiveProjectId(id);
    persistManifest(
      id,
      projects.map((p) => (p.id === id ? { ...p, lastOpenedAt: Date.now() } : p)),
    );
  }

  /** Left rail: "+ New project" — flushes the outgoing project, then
   * clears the canvas down to a genuinely blank one (no demo content)
   * for the new project, using today's grid-spacing/snap/background
   * defaults (SES025, then the ribbon port) rather than whatever the
   * previous project happened to have set. */
  async function handleCreateProject(name: string): Promise<void> {
    await flushActiveProjectSave();
    const id = newProjectId();
    const settings: CanvasSettings = { gridSpacing: 8, tickIntervalMs: 400, canvasBackground: 'white' };
    const data = makeBlankProjectData(settings);
    await saveProjectFile(id, data);
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, objectRegistry);
    setGridSpacing(settings.gridSpacing);
    setTickIntervalMs(settings.tickIntervalMs);
    setCanvasBackground(settings.canvasBackground ?? 'white');
    nextIdRef.current = 1;
    resetUndoHistory();
    setSelection(null);
    activeProjectIdRef.current = id;
    setActiveProjectId(id);
    persistManifest(id, [...projects, { id, name, lastOpenedAt: Date.now() }]);
  }

  /** Left rail: rename — manifest-only, doesn't touch the project's
   * own saved graph data at all. */
  function handleRenameProject(id: string, name: string): void {
    if (!activeProjectIdRef.current) return;
    persistManifest(
      activeProjectIdRef.current,
      projects.map((p) => (p.id === id ? { ...p, name } : p)),
    );
  }

  /** Left rail: delete — the panel itself disables this for whichever
   * project is currently active, so there's never a question of what
   * replaces the open canvas as a result of this call. */
  async function handleDeleteProject(id: string): Promise<void> {
    if (!activeProjectIdRef.current || id === activeProjectIdRef.current) return;
    await deleteProjectFile(id);
    persistManifest(
      activeProjectIdRef.current,
      projects.filter((p) => p.id !== id),
    );
  }

  /** Shows a short reason in the status bar's instruction strip for
   * ~2.6s, then reverts to whatever contextual hint would normally be
   * there — used at every silent-rejection point below (Falcon,
   * 2026-09-05). */
  function flashMessage(message: string): void {
    setTransientMessage(message);
    if (transientMessageTimeoutRef.current !== null) window.clearTimeout(transientMessageTimeoutRef.current);
    transientMessageTimeoutRef.current = window.setTimeout(() => setTransientMessage(null), 2600);
  }

  /** Whether an object type is still referenced by anything in the
   * graph — a source's spawned itemType, a sorter rule's match type,
   * or a mixer recipe/output type. Lives here (not on ObjectRegistry
   * itself) because it needs GraphModel, and the skin layer
   * deliberately never depends on the logic layer (design doc §2).
   * ObjectRegistryManager's delete button uses this to refuse
   * orphaning a type something still points at. */
  function isObjectTypeInUse(typeId: string): boolean {
    for (const node of graph.getAllNodes()) {
      if (node.kind === 'source' && node.config.itemType === typeId) return true;
      if (node.kind === 'sorter') {
        const rules = Array.isArray(node.config.rules) ? (node.config.rules as { itemType?: string }[]) : [];
        if (rules.some((r) => r.itemType === typeId)) return true;
      }
      if (node.kind === 'mixer') {
        const recipe = (node.config.recipe ?? {}) as Record<string, unknown>;
        if (Object.values(recipe).some((v) => v === typeId)) return true;
        if (node.config.outputType === typeId) return true;
      }
    }
    return false;
  }

  /** The single-node deletion cascade — extracted (FBP014,
   * 2026-09-05) so a multi-select delete can reuse it per member
   * rather than duplicating it. Removes the node, every edge that
   * touched it, and detaches (never deletes) any sketch end that was
   * pinned to it, same "planning survives" spirit as everything else
   * here. Does NOT touch `selection` — the caller decides what's
   * selected once the whole batch is done. */
  function deleteNodeCascade(nodeId: NodeId): void {
    const removedEdgeIds = graph.removeNode(nodeId);
    floorLayout.removeNodePosition(nodeId);
    skinConfig.removeNode(nodeId);
    for (const edgeId of removedEdgeIds) {
      floorLayout.removeEdgeCurve(edgeId);
      skinConfig.removeEdge(edgeId);
    }
    for (const sketch of sketchLayer.getAll()) {
      let patch: Partial<Sketch> | null = null;
      if (sketch.fromAttachment && sketch.fromAttachment.nodeId === nodeId) {
        floorLayout.releaseReservation(`${sketch.id}:from`);
        patch = { ...(patch ?? {}), fromAttachment: null };
      }
      if (sketch.toAttachment && sketch.toAttachment.nodeId === nodeId) {
        floorLayout.releaseReservation(`${sketch.id}:to`);
        patch = { ...(patch ?? {}), toAttachment: null };
      }
      if (patch) sketchLayer.update(sketch.id, patch);
    }
  }

  /** Plain edge removal — extracted (quick-select, 2026-09-05)
   * alongside `deleteNodeCascade` so a multi-select delete's
   * `edgeIds` loop reuses it instead of duplicating it. */
  function deleteEdgeOnly(edgeId: EdgeId): void {
    graph.removeEdge(edgeId);
    floorLayout.removeEdgeCurve(edgeId);
    skinConfig.removeEdge(edgeId);
  }

  /** Plain sketch removal — same extraction as `deleteEdgeOnly`, for
   * a multi-select delete's `sketchIds` loop. */
  function deleteSketchOnly(sketchId: string): void {
    const sketch = sketchLayer.get(sketchId);
    if (sketch?.fromAttachment) floorLayout.releaseReservation(`${sketchId}:from`);
    if (sketch?.toAttachment) floorLayout.releaseReservation(`${sketchId}:to`);
    sketchLayer.remove(sketchId);
  }

  function handleDeleteSelection(): void {
    if (!selection) return;
    if (selection.type === 'node') {
      deleteNodeCascade(selection.id);
    } else if (selection.type === 'multi') {
      for (const nodeId of selection.nodeIds) deleteNodeCascade(nodeId);
      for (const edgeId of selection.edgeIds) deleteEdgeOnly(edgeId);
      for (const sketchId of selection.sketchIds) deleteSketchOnly(sketchId);
    } else if (selection.type === 'sketch') {
      deleteSketchOnly(selection.id);
    } else {
      deleteEdgeOnly(selection.id);
    }
    setSelection(null);
  }

  /** Duplicate tool (FBP014, 2026-09-05) — clones every node in the
   * current selection (a single 'node', or every member of a
   * 'multi'), offset by a few grid cells so the copies never land
   * exactly on top of their originals. Edges/sketches aren't
   * duplicable in this first pass. Preserves any edge whose BOTH
   * endpoints are inside the duplicated set (a duplicated sub-graph
   * keeps its own internal wiring); an edge crossing OUT of the set
   * is simply not copied, same "external connections don't carry
   * over" spirit as everything else that clones rather than moves.
   * Hard-blocks the whole duplicate (nothing created) if any copy
   * would land on an existing node — same convention as placement/
   * move everywhere else, rather than dropping some copies and not
   * others. */
  function handleDuplicateSelection(): void {
    if (!selection) return;
    const sourceIds = selection.type === 'multi' ? selection.nodeIds : selection.type === 'node' ? [selection.id] : [];
    if (sourceIds.length === 0) return;

    const offset = gridSpacing * 3;
    const candidates = new Map<NodeId, Point>();
    for (const nodeId of sourceIds) {
      const pos = floorLayout.getNodePosition(nodeId);
      if (pos) candidates.set(nodeId, { x: pos.x + offset, y: pos.y + offset });
    }
    for (const candidate of candidates.values()) {
      if (floorLayout.wouldOverlap(candidate, sourceIds)) {
        flashMessage("Can't duplicate — there's no room next to the selection.");
        return;
      }
    }

    const idMap = new Map<NodeId, NodeId>();
    const newIds: NodeId[] = [];
    for (const oldId of sourceIds) {
      const node = graph.getNode(oldId);
      const pos = candidates.get(oldId);
      if (!node || !pos) continue;
      const newId = `user-node-${nextIdRef.current++}`;
      // Deep-copy config defensively — every config field is JSON-
      // safe (design doc §4.4), and this guarantees editing the copy
      // (e.g. a sorter's rules array) never mutates the original's
      // config through a shared reference.
      graph.addNode({ id: newId, kind: node.kind, config: JSON.parse(JSON.stringify(node.config)) });
      floorLayout.setNodePosition(newId, pos);
      idMap.set(oldId, newId);
      newIds.push(newId);
    }

    for (const edge of graph.getAllEdges()) {
      const newSource = idMap.get(edge.source);
      const newTarget = idMap.get(edge.target);
      // Only an edge that was already in the graph BEFORE this loop
      // added any new nodes/edges can match here — idMap only maps
      // original ids, so a freshly-created duplicate edge (whose
      // source/target are new ids, absent from idMap) is never
      // mistaken for one to duplicate again.
      if (!newSource || !newTarget) continue;
      const newEdgeId = `user-edge-${nextIdRef.current++}`;
      graph.addEdge({
        id: newEdgeId,
        source: newSource,
        target: newTarget,
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
        flowRate: edge.flowRate,
        active: edge.active,
      });
      floorLayout.setEdgeCurve(newEdgeId, newSource, newTarget, floorLayout.getEdgeBow(edge.id));
      skinConfig.setEdgeSkin(newEdgeId, skinConfig.getEdgeSkin(edge.id));
    }

    setSelection(newIds.length === 1 ? { type: 'node', id: newIds[0]! } : { type: 'multi', nodeIds: newIds, edgeIds: [], sketchIds: [] });
  }

  function handlePlaceNode(kind: NodeKind, worldPoint: Point): void {
    // Falcon, 2026-09-05: "dont allow overlapping of nodes and paths
    // ... even creating new node it will hardblock if attempted or
    // cause overlapping" -- same silent-rejection convention as the
    // port-capacity checks below (handleCreateEdge): a placement that
    // would land on top of an existing node simply doesn't happen,
    // rather than landing there and needing a correction afterward.
    if (floorLayout.wouldOverlap(worldPoint)) {
      flashMessage("Can't place there \u2014 it would overlap another node.");
      return;
    }
    const id = `user-node-${nextIdRef.current++}`;
    graph.addNode({ id, kind, config: defaultConfigFor(kind) });
    floorLayout.setNodePosition(id, worldPoint);
    setSelection({ type: 'node', id });
    setPlacementKind(null);
  }

  function handleCreateEdge(
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    explicitAnchors?: { sourceAnchor?: number; targetAnchor?: number },
    style?: EdgeStyle,
  ): void {
    // Per-socket wiring (Falcon, 2026-09-03): max 8 paths per node,
    // one per octagon side. Falcon, 2026-09-05 ("snap on those
    // dots"): when the drag targeted one SPECIFIC dot, check that
    // exact dot instead of "does this node have ANY free slot" — a
    // deliberately-targeted taken dot rejects the whole connection
    // rather than falling back to a different one. Checked BEFORE
    // creating anything so a rejection never leaves a logic-layer
    // edge with no floor-layer curve to render.
    const sourceBlocked =
      explicitAnchors?.sourceAnchor !== undefined
        ? floorLayout.isAnchorOccupied(sourceNodeId, explicitAnchors.sourceAnchor)
        : !floorLayout.hasFreeAnchorSlot(sourceNodeId);
    const targetBlocked =
      explicitAnchors?.targetAnchor !== undefined
        ? floorLayout.isAnchorOccupied(targetNodeId, explicitAnchors.targetAnchor)
        : !floorLayout.hasFreeAnchorSlot(targetNodeId);
    if (sourceBlocked || targetBlocked) {
      flashMessage(
        explicitAnchors?.sourceAnchor !== undefined || explicitAnchors?.targetAnchor !== undefined
          ? 'That connection point is already taken.'
          : 'That node already has all 8 connection points in use.',
      );
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
      flashMessage(`A ${sourceNode.kind} can only have ${sourceCap.maxOutputs} output${sourceCap.maxOutputs === 1 ? '' : 's'}.`);
      return;
    }
    if (targetCap.maxInputs !== undefined && graph.inputEdges(targetNodeId).length >= targetCap.maxInputs) {
      flashMessage(`A ${targetNode.kind} can only accept ${targetCap.maxInputs} input${targetCap.maxInputs === 1 ? '' : 's'}.`);
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
    // Falcon, 2026-09-05: every new path now starts linear (bow=0),
    // not the old gentle-curve default.
    floorLayout.setEdgeCurve(id, sourceNodeId, targetNodeId, 0, explicitAnchors);
    // Falcon, 2026-09-05: "I want to draw the selected path directly
    // ... no need to draw or sketch first" -- FluxCanvas's armed-style
    // drag-to-create gesture passes the armed style straight through
    // here, tagged onto the same new edge in one call, then disarms
    // -- the same one-shot arm-then-act convention placement/sketch/
    // apply-style-to-an-existing-edge all already follow. A plain
    // Shift+drag with nothing armed never passes a style, so this is
    // a no-op for that path.
    if (style) {
      skinConfig.setEdgeSkin(id, { style });
      setArmedEdgeStyle(null);
    }
    setSelection({ type: 'edge', id });
  }

  // NODES, PATHS, Sketch, Multi-select and Pan arming are all
  // mutually exclusive — arming one clears every other, so the
  // canvas's pointer state machine never has to decide which one
  // wins (FBP014, 2026-09-05: folded Multi-select/Pan into the same
  // pattern already established for the first three).
  function handleArmNodeKind(kind: NodeKind | null): void {
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setPanArmed(false);
    setPlacementKind(kind);
  }

  function handleArmEdgeStyle(style: EdgeStyle | null): void {
    setPlacementKind(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setPanArmed(false);
    setArmedEdgeStyle(style);
  }

  function handleArmSketch(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setMultiSelectArmed(false);
    setPanArmed(false);
    setSketchArmed(armed);
  }

  function handleArmMultiSelect(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setPanArmed(false);
    setMultiSelectArmed(armed);
    setQuickSelectFilter('nodes');
  }

  function handleArmPan(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setPanArmed(armed);
  }

  /** Multi-select's hover flyout (2026-09-05, Falcon: "when i hover
   * over to multiselect i want it to have a secondary popup
   * selection such as all (select all), paths only, nodes only,
   * sketches only, (soon possible others)"). First built as an
   * immediate global select of every item of that kind project-wide;
   * Falcon corrected that same day after trying it: "the multiselect
   * is the selection base on the highlighted area or selected area"
   * -- none of the four options reach out and grab everything
   * project-wide. Each just arms Multi-select scoped to a kind (or,
   * for "Select all", no kind restriction at all) -- the user's own
   * next marquee drag decides the area, and only what actually falls
   * inside that box, of the armed kind(s), joins the selection. */
  function handleQuickSelect(kind: 'all' | 'nodes' | 'paths' | 'sketches'): void {
    setSelection(null);
    handleArmMultiSelect(true);
    setQuickSelectFilter(kind);
  }

  function handleApplyEdgeStyle(edgeId: EdgeId, style: EdgeStyle): void {
    skinConfig.setEdgeSkin(edgeId, { style });
    setArmedEdgeStyle(null);
  }

  function handleCreateSketch(
    points: Point[],
    segments: SketchSegment[],
    fromAttachment?: SketchAttachment | null,
    toAttachment?: SketchAttachment | null,
  ): void {
    const id = `sketch-${nextIdRef.current++}`;
    // Falcon, 2026-09-05: book each attached end in FloorLayout's
    // shared anchor pool so the sketch genuinely holds that port —
    // re-validated here (not just trusted from FluxCanvas's own
    // pre-filtering) so a stale/occupied target degrades to a plain
    // floating end instead of silently double-booking a dot.
    const fromOk = fromAttachment
      ? floorLayout.reserveAnchor(`${id}:from`, fromAttachment.nodeId, fromAttachment.anchorIndex)
      : false;
    const toOk = toAttachment
      ? floorLayout.reserveAnchor(`${id}:to`, toAttachment.nodeId, toAttachment.anchorIndex)
      : false;
    sketchLayer.add({
      id,
      points,
      segments,
      fromAttachment: fromOk ? fromAttachment! : null,
      toAttachment: toOk ? toAttachment! : null,
    });
    setSelection({ type: 'sketch', id });
    setSketchArmed(false);
  }

  /** Properties panel's "Convert to path" action (Falcon, 2026-09-05:
   * "sketches or drawn paths can be convertible to a real path") —
   * only reachable once both ends are pinned to a real port (enforced
   * by the panel itself not rendering the control otherwise, checked
   * again here since this is the actual mutation). Re-checks per-kind
   * port capacity exactly like handleCreateEdge, since a sketch's
   * anchor reservation only proves the physical DOT is free, not that
   * the node's kind still has room under maxOutputs/maxInputs. Only
   * releases the sketch's anchor reservations — and removes the
   * sketch — after every check passes, so a rejected conversion
   * leaves the sketch fully intact. */
  /** Falcon, 2026-09-05 ("there is no way i can snap a sketch to a
   * node's port" / "[convert] is useless if it cannot be used"): a
   * post-hoc fix for an end that missed the snap while drawing --
   * rather than forcing a redraw, this hunts for the nearest free
   * port from wherever that end currently sits and pins it there,
   * same reservation path handleCreateSketch already uses. The
   * search radius is deliberately generous (a few node-radii) since,
   * unlike the live drag gesture, there's no cursor position driving
   * this -- it's a one-shot "find whatever's nearby" action the user
   * only reaches for when a end is already close but didn't quite
   * catch. */
  function handlePinSketchEnd(sketchId: string, end: 'from' | 'to'): void {
    const sketch = sketchLayer.get(sketchId);
    if (!sketch) return;
    const pointIndex = end === 'from' ? 0 : sketch.points.length - 1;
    if (end === 'from' ? sketch.fromAttachment : sketch.toAttachment) return; // already pinned
    const point = sketch.points[pointIndex]!;
    const anchorHit = floorLayout.findNearestAnchor(point, NODE_RADIUS * 3);
    if (!anchorHit || anchorHit.occupied) {
      flashMessage(`No free port near the sketch's ${end === 'from' ? 'start' : 'end'}`);
      return;
    }
    const reserved = floorLayout.reserveAnchor(`${sketchId}:${end}`, anchorHit.nodeId, anchorHit.anchorIndex);
    if (!reserved) {
      flashMessage("That port just got taken \u2014 try again");
      return;
    }
    const points = [...sketch.points];
    points[pointIndex] = anchorHit.point;
    const attachment: SketchAttachment = { nodeId: anchorHit.nodeId, anchorIndex: anchorHit.anchorIndex };
    sketchLayer.update(sketchId, {
      points,
      ...(end === 'from' ? { fromAttachment: attachment } : { toAttachment: attachment }),
    });
  }

  function handleConvertSketchToPath(sketchId: string, style: EdgeStyle): void {
    const sketch = sketchLayer.get(sketchId);
    // Falcon, 2026-09-05 ("one continuous path... treating it as
    // simple paths connected as one"): a real GraphModel edge still
    // only ever connects exactly two NODES -- but it can now carry a
    // multi-segment shape between them (FloorLayout.setEdgeSegments,
    // below), so a sketch with any number of segments converts as
    // long as both its true ends are pinned.
    if (!sketch || !sketch.fromAttachment || !sketch.toAttachment) return;
    const { nodeId: sourceNodeId, anchorIndex: sourceAnchor } = sketch.fromAttachment;
    const { nodeId: targetNodeId, anchorIndex: targetAnchor } = sketch.toAttachment;

    const sourceNode = graph.getNode(sourceNodeId);
    const targetNode = graph.getNode(targetNodeId);
    if (!sourceNode || !targetNode) return;
    const sourceCap = getPortCapacity(sourceNode.kind);
    const targetCap = getPortCapacity(targetNode.kind);
    if (sourceCap.maxOutputs !== undefined && graph.outputEdges(sourceNodeId).length >= sourceCap.maxOutputs) {
      flashMessage(`Can't convert \u2014 a ${sourceNode.kind} can only have ${sourceCap.maxOutputs} output${sourceCap.maxOutputs === 1 ? '' : 's'}.`);
      return;
    }
    if (targetCap.maxInputs !== undefined && graph.inputEdges(targetNodeId).length >= targetCap.maxInputs) {
      flashMessage(`Can't convert \u2014 a ${targetNode.kind} can only accept ${targetCap.maxInputs} input${targetCap.maxInputs === 1 ? '' : 's'}.`);
      return;
    }

    // The sketch already holds both anchor slots in FloorLayout's
    // shared reservation pool — release them right before creating
    // the real edge at the SAME anchors (single-threaded UI, nothing
    // else can grab them in between).
    floorLayout.releaseReservation(`${sketchId}:from`);
    floorLayout.releaseReservation(`${sketchId}:to`);

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
    // Falcon, 2026-09-05: "the default when converting from sketch to
    // a path should be linear not curved" -- still exactly true for
    // the two true ENDS of the connection (always created straight
    // here, same as ever). A multi-segment sketch's actual drawn
    // shape -- interior points and whatever bow each of its legs had
    // -- is layered on top right after, since THAT shape is the
    // entire reason to convert one of these rather than a plain
    // single-segment sketch.
    floorLayout.setEdgeCurve(id, sourceNodeId, targetNodeId, 0, { sourceAnchor, targetAnchor });
    if (sketch.segments.length > 1) {
      floorLayout.setEdgeSegments(
        id,
        sketch.points.slice(1, -1),
        sketch.segments.map((seg) => seg.bow),
      );
    }
    skinConfig.setEdgeSkin(id, { style });
    sketchLayer.remove(sketchId);
    setSelection({ type: 'edge', id });
  }

  /** Multi-select's batch "Convert to path" (Falcon, 2026-09-05: "the
   * purpose of the options like say 'sketches only' is that i want to
   * convert as many in one go not every single one") — same per-
   * sketch checks as handleConvertSketchToPath above (both ends
   * pinned, port capacity), but applied across a whole quick-select
   * batch instead of one sketch. Falcon confirmed: whichever sketches
   * qualify get converted, the rest are just skipped and reported —
   * the batch action never refuses outright over one bad member. */
  function handleBatchConvertSketches(sketchIds: string[], style: EdgeStyle): void {
    let converted = 0;
    let skippedNotPinned = 0;
    let skippedPortFull = 0;

    for (const sketchId of sketchIds) {
      const sketch = sketchLayer.get(sketchId);
      if (!sketch) {
        skippedNotPinned++;
        continue;
      }
      if (!sketch.fromAttachment || !sketch.toAttachment) {
        skippedNotPinned++;
        continue;
      }
      const { nodeId: sourceNodeId, anchorIndex: sourceAnchor } = sketch.fromAttachment;
      const { nodeId: targetNodeId, anchorIndex: targetAnchor } = sketch.toAttachment;
      const sourceNode = graph.getNode(sourceNodeId);
      const targetNode = graph.getNode(targetNodeId);
      if (!sourceNode || !targetNode) {
        skippedNotPinned++;
        continue;
      }
      const sourceCap = getPortCapacity(sourceNode.kind);
      const targetCap = getPortCapacity(targetNode.kind);
      if (sourceCap.maxOutputs !== undefined && graph.outputEdges(sourceNodeId).length >= sourceCap.maxOutputs) {
        skippedPortFull++;
        continue;
      }
      if (targetCap.maxInputs !== undefined && graph.inputEdges(targetNodeId).length >= targetCap.maxInputs) {
        skippedPortFull++;
        continue;
      }

      floorLayout.releaseReservation(`${sketchId}:from`);
      floorLayout.releaseReservation(`${sketchId}:to`);

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
      floorLayout.setEdgeCurve(id, sourceNodeId, targetNodeId, 0, { sourceAnchor, targetAnchor });
      if (sketch.segments.length > 1) {
        floorLayout.setEdgeSegments(
          id,
          sketch.points.slice(1, -1),
          sketch.segments.map((seg) => seg.bow),
        );
      }
      skinConfig.setEdgeSkin(id, { style });
      sketchLayer.remove(sketchId);
      converted++;
    }

    const skipped = skippedNotPinned + skippedPortFull;
    if (skipped === 0) {
      flashMessage(`Converted ${converted} sketch${converted === 1 ? '' : 'es'} to path${converted === 1 ? '' : 's'}.`);
    } else {
      const reasons: string[] = [];
      if (skippedNotPinned > 0) reasons.push(`${skippedNotPinned} not fully pinned`);
      if (skippedPortFull > 0) reasons.push(`${skippedPortFull} port full`);
      flashMessage(`${converted} converted, ${skipped} skipped \u2014 ${reasons.join(', ')}.`);
    }
    setSelection(null);
  }

  /** Multi-select's batch "Convert all" for a paths-only selection —
   * restyles every selected path to one chosen style in one go,
   * mirroring the single-edge style picker in EdgeSkinFields. */
  function handleBatchRestyleEdges(edgeIds: string[], style: EdgeStyle): void {
    for (const edgeId of edgeIds) {
      skinConfig.setEdgeSkin(edgeId, { style });
    }
    flashMessage(`Restyled ${edgeIds.length} path${edgeIds.length === 1 ? '' : 's'}.`);
  }

  function handlePlayPauseClick(): void {
    fluxCanvasRef.current?.toggleRunning();
  }

  const instructionText = transientMessage
    ? transientMessage
    : placementKind
    ? `Click the canvas to place a ${placementKind}.`
    : armedEdgeStyle
      ? `Click a path to restyle it, or drag to draw a new ${armedEdgeStyle} path — falls back to a sketch if it doesn't land on a port.`
      : sketchArmed
        ? 'Drag to sketch a planning path — starting or ending near a port dot pins that end to it.'
        : multiSelectArmed
          ? quickSelectFilter === 'paths'
            ? 'Drag over the canvas — only the paths inside the box will be selected.'
            : quickSelectFilter === 'sketches'
              ? 'Drag over the canvas — only the sketches inside the box will be selected.'
              : quickSelectFilter === 'all'
                ? 'Drag over the canvas — every node, path, and sketch inside the box will be selected.'
                : 'Click nodes to toggle them into the selection, or drag over empty canvas to select the nodes inside the box.'
          : panArmed
            ? 'Drag anywhere to pan — even starting on a node or path.'
            : selection?.type === 'node'
              ? 'Node selected — drag to move it (if unlocked), Shift+drag to wire, Delete to remove.'
              : selection?.type === 'multi'
                ? `${selection.nodeIds.length + selection.edgeIds.length + selection.sketchIds.length} items selected — drag a node to move the group, Delete to remove, Duplicate to clone the nodes.`
                : selection?.type === 'edge'
                  ? 'Path selected — edit it in the properties panel, Delete to remove.'
                  : selection?.type === 'sketch'
                    ? 'Sketch selected — Delete to remove, or Convert to path in the properties panel once both ends are pinned.'
                    : 'Click a node or path to select it, choose something from the ribbon to add, or Shift+drag from one node to another to connect them.';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        background: theme.bgApp,
      }}
    >
      <Ribbon
        projectName={projects.find((p) => p.id === activeProjectId)?.name ?? null}
        onSaveNow={() => void flushActiveProjectSave()}
        canUndo={canUndo}
        onUndo={handleUndo}
        canRedo={canRedo}
        onRedo={handleRedo}
        activeTab={activeRibbonTab}
        onTabChange={setActiveRibbonTab}
        armedKind={placementKind}
        onArmKind={handleArmNodeKind}
        armedEdgeStyle={armedEdgeStyle}
        onArmEdgeStyle={handleArmEdgeStyle}
        sketchArmed={sketchArmed}
        onArmSketch={handleArmSketch}
        sketchStyle={sketchStyle}
        onSketchStyleChange={setSketchStyle}
        multiSelectArmed={multiSelectArmed}
        onArmMultiSelect={handleArmMultiSelect}
        panArmed={panArmed}
        onArmPan={handleArmPan}
        canDelete={selection !== null}
        onDeleteSelection={handleDeleteSelection}
        canDuplicate={selection?.type === 'node' || (selection?.type === 'multi' && selection.nodeIds.length > 0)}
        onDuplicateSelection={handleDuplicateSelection}
        onQuickSelect={handleQuickSelect}
        onOpenObjectsManager={() => setObjectsManagerOpen(true)}
        snapToGrid={snapToGrid}
        onToggleSnapToGrid={() => setSnapToGrid((v) => !v)}
        gridSpacing={gridSpacing}
        onGridSpacingChange={setGridSpacing}
        tickIntervalMs={tickIntervalMs}
        onTickIntervalMsChange={setTickIntervalMs}
        canvasBackground={canvasBackground}
        onCanvasBackgroundChange={setCanvasBackground}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftPanel
          projects={projects}
          activeProjectId={activeProjectId}
          onSwitchProject={handleSwitchProject}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
        />
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <FluxCanvas
            ref={fluxCanvasRef}
            graph={graph}
            floorLayout={floorLayout}
            skinConfig={skinConfig}
            objectRegistry={objectRegistry}
            tickIntervalMs={tickIntervalMs}
            selection={selection}
            onSelect={setSelection}
            placementKind={placementKind}
            onPlaceNode={handlePlaceNode}
            onCreateEdge={handleCreateEdge}
            onConnectionRejected={flashMessage}
            snapToGrid={snapToGrid}
            gridSpacing={gridSpacing}
            armedEdgeStyle={armedEdgeStyle}
            onApplyEdgeStyle={handleApplyEdgeStyle}
            onRunningChange={setIsRunning}
            sketchLayer={sketchLayer}
            sketchArmed={sketchArmed}
            sketchStyle={sketchStyle}
            onCreateSketch={handleCreateSketch}
            multiSelectArmed={multiSelectArmed}
            quickSelectFilter={quickSelectFilter}
            panArmed={panArmed}
            canvasBackground={canvasBackground}
            onCursorWorldPositionChange={setCursorWorldPosition}
          />
        </div>
        <PropertiesPanel
          selection={selection}
          graph={graph}
          skinConfig={skinConfig}
          floorLayout={floorLayout}
          sketchLayer={sketchLayer}
          objectRegistry={objectRegistry}
          onDelete={handleDeleteSelection}
          onDuplicate={handleDuplicateSelection}
          onConvertSketch={handleConvertSketchToPath}
          onPinSketchEnd={handlePinSketchEnd}
          onBatchConvertSketches={handleBatchConvertSketches}
          onBatchRestyleEdges={handleBatchRestyleEdges}
        />
      </div>
      <StatusBar
        isRunning={isRunning}
        onPlayPauseClick={handlePlayPauseClick}
        instructionText={instructionText}
        isWarning={transientMessage !== null}
        cursorWorldPosition={cursorWorldPosition}
        snapToGrid={snapToGrid}
        gridSpacing={gridSpacing}
      />
      {objectsManagerOpen && (
        <ObjectRegistryManager
          objectRegistry={objectRegistry}
          isTypeInUse={isObjectTypeInUse}
          onClose={() => setObjectsManagerOpen(false)}
        />
      )}
    </div>
  );
}
