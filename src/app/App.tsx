import { useEffect, useMemo, useRef, useState } from 'react';
import { FloorLayout, NODE_RADIUS } from '../floor/floorLayout';
import { FluxCanvas, type FluxCanvasHandle, type SketchStyle } from './FluxCanvas';
import { GraphModel } from '../core/GraphModel';
import type { EdgeId, NodeId, NodeKind } from '../core/types';
import { shapeCenter, flipPoints, type Point } from '../floor/bezier';
import { SkinConfig } from '../skin/SkinConfig';
import { getPortCapacity, isDockCompatible, applicableOutputCap, relevantOutputEdges } from '../core/nodes/portCapacity';
import type { EdgeStyle } from '../skin/pathSkin';
import { LeftPanel } from './LeftPanel';
import { Ribbon, type RibbonTab } from './Ribbon';
import { StatusBar } from './StatusBar';
import { PropertiesPanel } from './PropertiesPanel';
import { ObjectRegistryManager } from './ObjectRegistryManager';
import { collapseSelection, type Selection } from './selection';
import { SketchLayer, getSketchReshapePoints, applySketchReshapePoints, type Sketch, type SketchAttachment, type SketchSegment } from './sketchLayer';
import { AnnotationLayer, type AnnotationIconKind } from './annotationLayer';
import { CustomIconLibrary, type CustomIconDef } from '../skin/customIconLibrary';
import { ObjectRegistry } from '../skin/ObjectRegistry';
import { GroupRegistry } from '../skin/GroupRegistry';
import { theme, type CanvasBackground } from './theme';
import {
  clearAllStores,
  deleteProjectFile,
  loadCustomIconLibraryFile,
  loadLegacySave,
  loadManifest,
  loadProjectFile,
  makeBlankProjectData,
  migrateSensorGateToCommand,
  newProjectId,
  populateState,
  saveCustomIconLibraryFile,
  saveManifest,
  saveProjectFile,
  serializeState,
  syncEdgePortsToAnchors,
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
      // Falcon, 2026-09-09 ("on source node's properties i want it off
      // by default meaning its not spawning any item unless toggled on
      // ... only new source nodes going forward"): only a FRESHLY
      // placed source gets `active: false` written explicitly here —
      // an old source already sitting in a saved project has no
      // `active` field at all, and SimEngine treats that as "active"
      // (see sourceActivationGate's own doc comment), so nothing about
      // an existing project changes from this.
      return { cooldown: 2, itemType: 'widget', active: false };
    case 'distributor':
      return { mode: 'roundRobin' };
    case 'merger':
      return {};
    case 'sorter':
      return { rules: [], defaultPort: 0, unmatchedPolicy: 'hold' };
    case 'mixer':
      // 2026-09-10 ("the ports are named according to compass"): no
      // more outputPort default — mixer.ts takes its one real output
      // edge directly now (see its own doc comment), never a config
      // number that could drift from wherever the edge's anchor
      // actually is.
      return { recipe: {}, outputType: 'item' };
    case 'buffer':
      return { capacity: 3, overflowPolicy: 'block' };
    case 'sink':
      return {};
    // Trigger system (design doc §4.8, 2026-09-09): Gate has nothing
    // to pre-fill -- it opens purely from a connected Sensor's signal,
    // never its own config. Sensor's defaults intentionally evaluate
    // to an always-true condition (0 >= 0) so a freshly-placed Sensor
    // immediately drives whatever it's wired to, rather than silently
    // doing nothing until someone finds the right fields to fill in.
    case 'gate':
      return {};
    case 'sensor':
      return { comparator: 'gte', threshold: 0 };
    // Counter (2026-09-10): nothing to pre-fill either -- it always
    // counts every arrival, no config decides that; `resetSeq` starts
    // implicitly at 0 the same way it's read everywhere else (counter.ts).
    case 'counter':
      return {};
    // Command (2026-09-10 follow-up; upgraded 2026-09-11 with real
    // verb/duration config): nothing pre-filled here either -- verb
    // defaults per-target-kind (defaultVerbForTargetKind) and duration
    // defaults to 'latch', both computed on read in command.ts itself,
    // the same "handler already falls back, nothing to pre-fill"
    // convention every other kind on this list already follows.
    case 'command':
      return {};
    // Time (2026-09-11, Command/Counter/Time extension): a 10-second
    // countdown by default -- long enough to actually watch tick down
    // before immediately hitting 0, short enough not to need a long
    // wait to see it work.
    case 'time':
      return { mode: 'countdown', duration: 10 };
    // Transform (2026-09-10 follow-up, "now i want to introduce the
    // transform node"): identity conversion by default (in === out,
    // both 'widget' -- same default item type Source itself starts
    // with) so a freshly placed Transform does nothing surprising
    // until its Properties panel is actually edited.
    case 'transform':
      return { inputType: 'widget', outputType: 'widget' };
    default:
      return {};
  }
}

/** Copper-path wiring rule (design doc §5.5, 2026-09-09 follow-up):
 * "the ports of sensor node only [are] compatible with copper wire
 * path ... the gate node is [also] compatible [to] receive or connect
 * copper path to its node." Direction never mattered originally
 * (Falcon: "it wont matter if it out ward or in ward") for the plain
 * compatibility check below -- both endpoints just need to be one of
 * these kinds. Extended §5.7 (2026-09-09 follow-up, "copper wire
 * SHOULD now [be] compatible with silo node") to include buffer/Silo,
 * so a Sensor can watch a Silo's queue length over a real copper wire,
 * not just the "Watch node" dropdown -- see sensor.ts's
 * watchedNodeIds/evaluateSignals for what that connection now DOES.
 * Direction now carries meaning for a Sensor edge specifically (design
 * doc §5.7: "ingoing means the node source to watch ... outgoing ...
 * will be for command") but that's read from the edge's source/target
 * at eval time, not enforced as a wiring restriction here -- this
 * function only ever answers "are these two kinds allowed to touch at
 * all." Every other kind is explicitly left for a later discussion, so
 * this stays a closed, easy-to-extend list rather than an inferred
 * rule.
 *
 * Extended 2026-09-10 (Counter node, same session): 'counter' -- a
 * Sensor can watch a Counter's `count` exactly the way it already
 * watches a Buffer's `queue.length` (sensor.ts's readMetric).
 *
 * Revised again the same session for the Command node (Falcon: "sensor
 * node only senses and triggers signal[,] the command node is the one
 * has command on it ... it is compatible only with wire and dockable
 * to source node and sensor node"): 'source' DROPPED back out of this
 * list -- a Sensor briefly commanded a Source directly earlier in this
 * same session, but Falcon's correction was that a Sensor should never
 * touch a Source at all, only ever a Command (below); a Sensor<->Source
 * wire attempt now correctly falls through to the generic "not copper
 * compatible" rejection below rather than needing its own carve-out.
 * 'command' ADDED -- a Command's ports are copper-path-only exactly
 * like Sensor's own (command.ts has no onItemArrival either), and it's
 * the only kind now allowed to actually target a Source -- see
 * isCommandOnlyTarget below.
 *
 * Extended 2026-09-11 (Command/Counter/Time extension): 'time' ADDED —
 * a Sensor can watch a Time node's live clock reading (`state.value`,
 * sensor.ts's new 'timeValue' metric) the same way it already watches
 * a Buffer's queue or a Counter's count. 'gate' STAYS in this list
 * even though a Sensor may no longer target a Gate directly any more
 * (see isCommandOnlyTarget below, and gate.ts's own breaking-change
 * doc comment) — Gate<->Command wiring still needs to pass this check
 * too (Command's own ports are copper-path-only, same as Sensor's), so
 * narrowing this list would incorrectly block that legitimate pairing.
 *
 * Extended again 2026-09-11, same-session follow-up: 'source' ADDED
 * BACK — but this is NOT a reversal of the "Sensor should never
 * command a Source" correction two paragraphs up. That correction was
 * about ACTUATION (a Sensor driving Source's activate/deactivate the
 * way it once drove a Gate directly) — Command is still, and only
 * ever, the one thing that can actually change what a Source does
 * (isCommandOnlyTarget below). This re-addition is about WATCHING
 * instead: a Sensor may now read a Source's own live `spawnedCount`
 * (sensor.ts's new 'spawnedCount' metric) purely to react elsewhere,
 * the same passive "watched" relationship it already has with Buffer/
 * Counter/Time — see portCapacity.ts's `maxWireOutputs` doc comment
 * and isDockCompatible's source<->sensor pair for the fuller story
 * (Falcon: "2 wire port and 1 output port for the source... command
 * and sensor is a wire compatible nodes", confirmed via
 * AskUserQuestion). isCommandOnlyTarget's direction check (below)
 * still makes sure only Source→Sensor (Source watched, never
 * commanded by the Sensor) actually succeeds. */
function isCopperCompatible(kind: NodeKind): boolean {
  return (
    kind === 'sensor' ||
    kind === 'gate' ||
    kind === 'buffer' ||
    kind === 'counter' ||
    kind === 'command' ||
    kind === 'time' ||
    kind === 'source'
  );
}

/** Command-only actuation targets (2026-09-10 — Falcon: "i want to add
 * additional feature to source node like it will deactivate by using
 * sensor nodes condition", revised same session: "sensor node only
 * senses and triggers signal[,] the command node is the one has
 * command on it"; generalized 2026-09-11 for the Command/Counter/Time
 * extension's role split — "Command is the ONLY actuator... nothing
 * else applies an effect to another node"): unlike every other node's
 * real physical input, each of these kinds' one signal-only input slot
 * (portCapacity.ts's NATURAL_PORT_CAPACITY) may ONLY ever be filled by
 * a Command node's signal -- never a Sensor's directly, even though a
 * Sensor is ultimately what drives that Command. None of these four
 * has an onItemArrival that reads this slot as a physical item either,
 * so a real item wired in here would simply vanish, the same
 * conservation gap isCopperCompatible/touchesSensor already guards
 * Sensor's own ports against. 'gate' is the newest addition — the
 * breaking change: Gate's OWN Sensor connection (built 2026-09-09) is
 * superseded, and any pre-existing live Sensor->Gate wire is spliced
 * through an auto-inserted Command at load time instead (see
 * persistence.ts's migrateSensorGateToCommand) rather than silently
 * breaking. One-directional on purpose: every one of these kinds may
 * still freely SOURCE an edge to anything its normal output cap
 * already allows -- this only restricts what may TARGET it. Checked as
 * its own rule at every edge/sketch-convert call site rather than
 * folded into that site's `touchesSensor` check, since this one is
 * asymmetric where that one is symmetric (and doesn't require a Sensor
 * be involved at all -- Command -> Source/Gate/Counter/Time never
 * touches a Sensor directly). */
function isCommandOnlyTarget(targetKind: NodeKind): boolean {
  return targetKind === 'source' || targetKind === 'gate' || targetKind === 'counter' || targetKind === 'time';
}

/** Command's own connectivity rule (2026-09-10, same-day follow-up —
 * generalizing the original "wire/dockable only to Source and Sensor"
 * restriction to also cover the new Command<->Counter reset pairing,
 * Falcon: "i want it to count only role and can manually be resetable
 * or by a command when docked with command"; extended 2026-09-11 for
 * Gate and Time — "full dock support" confirmed via AskUserQuestion,
 * mirroring Buffer's existing dock precedent): whichever of the two
 * endpoints is a Command node, the OTHER endpoint must be one of
 * exactly these 5 kinds. This is a separate, source-agnostic
 * complement to `isCommandOnlyTarget` above (which protects each
 * target's own single signal-only input port from any non-Command
 * sender) -- this one protects COMMAND's own two ports instead, from
 * the other direction, and closes a gap the original Command build
 * actually left open: before this, a Command -> Sink (or ->
 * Distributor, anything not one of these 5) edge was never actually
 * rejected -- `touchesSensor` only fires for a literal Sensor endpoint,
 * and `isCommandOnlyTarget` only fires for a literal target kind match,
 * so neither check ever looked at Command's OWN allowed-partner list.
 * Not folded into `isCopperCompatible` because that list is Sensor's
 * own (and deliberately excludes 'source' -- see that function's own
 * doc comment), so it can't answer "is this a valid Command partner"
 * on its own either. */
function isCommandCompatible(kind: NodeKind): boolean {
  return kind === 'sensor' || kind === 'source' || kind === 'counter' || kind === 'gate' || kind === 'time';
}

/** Docking (design doc §5.6, 2026-09-09 — "attaching the node without
 * needing to add a path in between ... it will act and behave like a
 * single unit"): the flowRate a dock edge is created with. Falcon's
 * chosen mechanism (over a deeper "merged single node" alternative)
 * was "auto hidden instant edge ... reuses all existing machinery" —
 * SimEngine's `advanceItems` advances `progress` by `flowRate * dt`
 * with NO dependence on the edge's actual curve length, so an
 * intentionally huge flowRate is the entire implementation: an item
 * crosses the remaining 0→1 progress in a single advancement step no
 * matter how short `dt` gets. SimEngine's own tick ordering
 * (advanceItems runs BEFORE deliverArrivals) means "instant" concretely
 * means "delivered on the very next tick," not the same tick it was
 * forwarded on — an unavoidable one-tick floor shared by every edge,
 * dock or not — but a huge flowRate guarantees it never needs a
 * SECOND tick beyond that one to actually finish crossing, unlike an
 * ordinary low-flowRate edge. Zero changes to SimEngine itself. */
const DOCK_FLOW_RATE = 1000;

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
  // 2026-09-10 ("the ports are named according to compass"): the demo
  // graph's edges above are hand-authored with the same pre-migration
  // sourcePort/targetPort (0/1 picked by hand, not by anchor) every
  // OTHER stale edge needed this same reconciliation for — see
  // syncEdgePortsToAnchors's own doc comment. Runs once, same "stable
  // singleton, mutated directly" convention as every store here.
  useMemo(() => syncEdgePortsToAnchors(graph, floorLayout), [graph, floorLayout]);
  const skinConfig = useMemo(() => buildDemoSkinConfig(), []);
  // 2026-09-11 (Command role-split finalization): same one-time
  // reconciliation as syncEdgePortsToAnchors above, for the demo
  // graph's own edges — a no-op today (the demo graph has no Sensor/
  // Gate nodes at all), kept for safety/consistency with populateState
  // so the demo graph is never a special case that skips this pass.
  useMemo(() => migrateSensorGateToCommand(graph, floorLayout, skinConfig), [graph, floorLayout, skinConfig]);
  const sketchLayer = useMemo(() => new SketchLayer(), []);
  // Canvas annotations (INSERT tab, 2026-09-09) — same "stable
  // singleton, mutated directly, single source of truth" convention
  // as every other store here.
  const annotationLayer = useMemo(() => new AnnotationLayer(), []);
  // Falcon, 2026-09-09 ("can i make my own custom icon library...
  // became preloded on the app?"): a SHARED, app-wide store -- unlike
  // every other store here, deliberately not threaded through
  // serializeState/clearAllStores/populateState (see
  // customIconLibrary.ts), loaded once below regardless of which
  // project is active.
  const customIconLibrary = useMemo(() => new CustomIconLibrary(), []);
  // OBJECTS registry (FBP011, 2026-09-05) — same "stable singleton,
  // mutated directly, single source of truth" convention as the four
  // stores above (design doc §4.6).
  const objectRegistry = useMemo(() => new ObjectRegistry(), []);
  // FBP016 (2026-09-06): local groups -- same "mutated directly,
  // single source of truth" instance pattern as every other store here.
  const groupRegistry = useMemo(() => new GroupRegistry(), []);

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
  // Falcon, 2026-09-10 ("toggle off option for path direction"): VIEW
  // tab display preference, same on/off shape as snapToGrid above.
  // Defaults to true so existing behavior (arrows shown) is unchanged.
  const [showPathDirection, setShowPathDirection] = useState(true);
  const nextIdRef = useRef(1);

  // UI chrome: which ribbon tab is showing, the PATHS group's armed
  // style, and the canvas/simulation settings the ribbon's VIEW tab
  // edits. isRunning mirrors FluxCanvas's own RUN/HOLD state so the
  // status bar's Play/Pause button can show the right label — the
  // actual toggle is called through fluxCanvasRef since the sim
  // driver only exists inside FluxCanvas's own effect.
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTab>('home');
  // Falcon, 2026-09-09 ("i want the icons to be in the left side
  // pannel never to collapse the ribbon in order to not scroll
  // sideward"): LeftPanel now swaps between the Projects list and the
  // full built-in icon library depending on this. Only INSERT's
  // "More" tile (Ribbon.tsx) sets it to 'icons' -- switching to any
  // OTHER ribbon tab resets it back to 'projects' below, matching
  // Falcon's "projects will only show when home tab was clicked"
  // (generalized to "any tab that isn't INSERT", since the icon view
  // only makes sense while INSERT is active).
  const [leftPanelView, setLeftPanelView] = useState<'projects' | 'icons' | 'nodes' | 'paths' | 'modify'>('projects');
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
  // FBP016 (2026-09-06): Move/Rotate -- replaces panArmed's old slot
  // (Falcon: "remove the redundant pan/hand on modify section").
  const [moveArmed, setMoveArmed] = useState(false);
  const [rotateArmed, setRotateArmed] = useState(false);
  // TOOLS tab's Measure/ruler tool (Falcon, 2026-09-14: "i want to
  // develop first in the tool tab to measure the distance between
  // node ... like a ruler"), confirmed via AskUserQuestion: a
  // transient tape-measure -- mirrors sketchArmed's arm-then-drag
  // flow, mutually exclusive with every other arm state (see the
  // handleArm* functions below). FluxCanvas owns the actual drag/
  // snap/readout logic; nothing here is ever written back to the
  // graph.
  const [measureArmed, setMeasureArmed] = useState(false);
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
        const data = legacy ?? serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);
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
        clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
        const settings = populateState(activeData, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
        setGridSpacing(settings.gridSpacing);
        setTickIntervalMs(settings.tickIntervalMs);
        setCanvasBackground(settings.canvasBackground ?? 'white');
        advanceNextIdPast(nextIdRef, [
          ...activeData.nodes.map((n) => n.id),
          ...activeData.edges.map((e) => e.id),
          ...activeData.sketches.map((s) => s.id),
          ...(activeData.annotations ?? []).map((a) => a.id),
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

  // Falcon, 2026-09-09: the custom icon library loads independently of
  // the project-load effect above -- it's shared across every project,
  // not part of any one project's own file, so it only ever needs
  // loading once, regardless of which project ends up active.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const icons = await loadCustomIconLibraryFile();
      if (cancelled) return;
      customIconLibrary.replaceAll(icons);
    })();
    return () => {
      cancelled = true;
    };
    // customIconLibrary is a stable useMemo singleton — safe to omit.
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
      const saved = serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);
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
    return serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);
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
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
    populateState(snap, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
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
   * untouched, so this changes nothing for the common case.
   *
   * Falcon, 2026-09-09 ("respects the size of the object along a
   * path"): the same poll also keeps `pathLength` in sync for every
   * edge with the no-overlap toggle on — the identical bridged-
   * geometry problem speed-lock already solves (SimEngine needs a
   * real-world length to turn item sizes into a progress gap, but
   * must never read floorLayout itself), so it reuses this loop and
   * cadence rather than standing up a second interval that would just
   * duplicate the same reasoning. */
  useEffect(() => {
    function tick(): void {
      for (const edge of graph.getAllEdges()) {
        if (edge.speedLocked && edge.lockedSpeed !== undefined) {
          const length = floorLayout.getEdgeCurve(edge.id)?.totalLength ?? 0;
          if (length > 0) {
            const targetFlowRate = edge.lockedSpeed / length;
            if (Math.abs(edge.flowRate - targetFlowRate) > 1e-9) {
              graph.setEdgeFlowRate(edge.id, targetFlowRate);
            }
          }
        }
        // Falcon, 2026-09-09 ("by default to respect item sizes"):
        // respectItemSize is now on unless a path explicitly opts out
        // (edge.respectItemSize === false) — see EdgeDef's own doc
        // comment — so this keeps pathLength synced for virtually
        // every ordinary path, not just ones someone happened to
        // check a box on. Dock edges are excluded on purpose (see
        // SimEngine.spacingEnabled's reasoning) even though their
        // respectItemSize is never explicitly false.
        if (edge.edgeKind !== 'dock' && edge.respectItemSize !== false) {
          const length = floorLayout.getEdgeCurve(edge.id)?.totalLength ?? 0;
          if (length > 0 && edge.pathLength !== length) {
            graph.setEdgePathLength(edge.id, length);
          }
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
    const saved = serializeState(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry, settings);
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
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
    if (data) {
      const settings = populateState(data, graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
      setGridSpacing(settings.gridSpacing);
      setTickIntervalMs(settings.tickIntervalMs);
      setCanvasBackground(settings.canvasBackground ?? 'white');
      advanceNextIdPast(nextIdRef, [
        ...data.nodes.map((n) => n.id),
        ...data.edges.map((e) => e.id),
        ...data.sketches.map((s) => s.id),
        ...(data.annotations ?? []).map((a) => a.id),
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
    clearAllStores(graph, floorLayout, skinConfig, sketchLayer, annotationLayer, objectRegistry, groupRegistry);
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
    groupRegistry.removeNodeMember(nodeId);
    for (const edgeId of removedEdgeIds) {
      floorLayout.removeEdgeCurve(edgeId);
      skinConfig.removeEdge(edgeId);
      groupRegistry.removeEdgeMember(edgeId);
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
    groupRegistry.removeEdgeMember(edgeId);
  }

  /** Plain sketch removal — same extraction as `deleteEdgeOnly`, for
   * a multi-select delete's `sketchIds` loop. */
  function deleteSketchOnly(sketchId: string): void {
    const sketch = sketchLayer.get(sketchId);
    if (sketch?.fromAttachment) floorLayout.releaseReservation(`${sketchId}:from`);
    if (sketch?.toAttachment) floorLayout.releaseReservation(`${sketchId}:to`);
    sketchLayer.remove(sketchId);
    groupRegistry.removeSketchMember(sketchId);
  }

  /** FBP016 (2026-09-06, "use multiselect then those will get group
   * into one group ... clicking [a member] the selection base"):
   * every click-driven selection from FluxCanvas (a node/edge/sketch
   * click, or a segment drill-in) routes through here instead of raw
   * setSelection, so a member that belongs to a persisted group gets
   * expanded to the whole group's multi-selection -- UNLESS that
   * exact group is already the current selection, in which case this
   * click drills into the one member clicked (mirrors the existing
   * sketch-segment drill-in convention exactly: click selects the
   * whole thing, click again drills into the specific part). Marquee/
   * quick-select-built multi selections never pass through here (they
   * already arrive as {type:'multi'} with no groupId), so they're
   * untouched by this. */
  function handleSelect(next: Selection | null): void {
    if (next && (next.type === 'node' || next.type === 'edge' || next.type === 'sketch')) {
      const groupId =
        next.type === 'node'
          ? groupRegistry.groupOfNode(next.id)
          : next.type === 'edge'
            ? groupRegistry.groupOfEdge(next.id)
            : groupRegistry.groupOfSketch(next.id);
      if (groupId) {
        const alreadyThisGroup = selection?.type === 'multi' && selection.groupId === groupId;
        if (!alreadyThisGroup) {
          const def = groupRegistry.get(groupId);
          if (def) {
            setSelection({ type: 'multi', nodeIds: def.nodeIds, edgeIds: def.edgeIds, sketchIds: def.sketchIds, groupId });
            return;
          }
        }
        // Already the selected group (or its def somehow vanished) --
        // fall through to select the specific member clicked.
      }
    }
    setSelection(next);
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
    } else if (selection.type === 'annotation') {
      annotationLayer.remove(selection.id);
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
      // 2026-09-10 ("the ports are named according to compass"): the
      // duplicated nodes sit at new positions, so this auto-picks
      // fresh anchors rather than reusing the original edge's —
      // copying the OLD edge.sourcePort/targetPort here (pre-existing
      // behavior) would silently mismatch whatever side actually got
      // picked. Same "curve first, then read back the real anchor"
      // order as handleCreateEdge above.
      floorLayout.setEdgeCurve(newEdgeId, newSource, newTarget, floorLayout.getEdgeBow(edge.id));
      const newAnchors = floorLayout.getEdgeAnchors(newEdgeId);
      graph.addEdge({
        id: newEdgeId,
        source: newSource,
        target: newTarget,
        sourcePort: newAnchors?.sourceAnchor ?? edge.sourcePort,
        targetPort: newAnchors?.targetAnchor ?? edge.targetPort,
        flowRate: edge.flowRate,
        active: edge.active,
      });
      skinConfig.setEdgeSkin(newEdgeId, skinConfig.getEdgeSkin(edge.id));
    }

    setSelection(newIds.length === 1 ? { type: 'node', id: newIds[0]! } : { type: 'multi', nodeIds: newIds, edgeIds: [], sketchIds: [] });
  }

  /** FBP016 (2026-09-06, "flip(horisontally,vertically) ...
   * (path and sketches only)"): mirrors the selected path/sketch's
   * INTERIOR curve points across its own bounding-box center axis --
   * its two true endpoints (a path's node-anchored ends, a sketch's
   * pinned/floating ends) never move. A dead-straight (no bend at
   * all) path/sketch has nothing to mirror, so this is a harmless
   * no-op for one. Click-to-apply, same convention as Duplicate --
   * no drag gesture needed since the transform is fully determined
   * by the shape's own current geometry. */
  function handleFlipSelection(axis: 'horizontal' | 'vertical'): void {
    if (!selection) return;
    if (selection.type === 'edge') {
      const ends = floorLayout.getEdgeEndpoints(selection.id);
      if (!ends) return;
      const interior = floorLayout.getEdgeReshapePoints(selection.id);
      if (interior.length === 0) return;
      const center = shapeCenter([ends.from, ends.to, ...interior]);
      floorLayout.setEdgeReshapePoints(selection.id, flipPoints(interior, center, axis));
    } else if (selection.type === 'sketch') {
      const sketch = sketchLayer.get(selection.id);
      if (!sketch) return;
      const interior = getSketchReshapePoints(sketch);
      if (interior.length === 0) return;
      const center = shapeCenter(sketch.points);
      sketchLayer.update(selection.id, applySketchReshapePoints(sketch, flipPoints(interior, center, axis)));
    }
  }

  /** FBP016 (2026-09-06, "use multiselect then those will get group
   * into one group as a local group"): folds the current multi
   * selection into a new persisted GroupRegistry entry. Refuses (with
   * a flashed reason, same silent-rejection convention as everything
   * else) if any member already belongs to a DIFFERENT group rather
   * than silently stealing it away -- a marquee/quick-select drag can
   * scoop up members of an existing group without ever going through
   * handleSelect's single-click interception, so this has to check
   * for itself. */
  function handleGroupSelection(): void {
    if (!selection || selection.type !== 'multi' || selection.groupId) return;
    const { nodeIds, edgeIds, sketchIds } = selection;
    const total = nodeIds.length + edgeIds.length + sketchIds.length;
    if (total < 2) return;
    const conflicting = new Set<string>();
    for (const id of nodeIds) {
      const g = groupRegistry.groupOfNode(id);
      if (g) conflicting.add(g);
    }
    for (const id of edgeIds) {
      const g = groupRegistry.groupOfEdge(id);
      if (g) conflicting.add(g);
    }
    for (const id of sketchIds) {
      const g = groupRegistry.groupOfSketch(id);
      if (g) conflicting.add(g);
    }
    if (conflicting.size > 0) {
      flashMessage('Some of these already belong to another group — ungroup them first.');
      return;
    }
    const id = `group-${nextIdRef.current++}`;
    groupRegistry.create(id, nodeIds, edgeIds, sketchIds);
    setSelection({ type: 'multi', nodeIds, edgeIds, sketchIds, groupId: id });
  }

  /** FBP016 (2026-09-06, "ungroup/explode reverting the group into as
   * before regardless of other modifications"): dissolves the
   * selected group's STRUCTURE only -- every member keeps whatever
   * position/edits it picked up while grouped, and stays selected
   * afterward as a plain (no longer persisted) multi selection. */
  function handleUngroupSelection(): void {
    if (!selection || selection.type !== 'multi' || !selection.groupId) return;
    groupRegistry.dissolve(selection.groupId);
    setSelection({ type: 'multi', nodeIds: selection.nodeIds, edgeIds: selection.edgeIds, sketchIds: selection.sketchIds });
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

    // Copper-path wiring rule (design doc §5.5, 2026-09-09 follow-up):
    // checked BEFORE the generic port-capacity caps below, since it's
    // a more fundamental "these two kinds can't connect at all" rule,
    // not a counting one. Symmetric — direction never matters.
    const touchesSensor = sourceNode.kind === 'sensor' || targetNode.kind === 'sensor';
    if (touchesSensor && (!isCopperCompatible(sourceNode.kind) || !isCopperCompatible(targetNode.kind))) {
      flashMessage('A Sensor only connects via a copper path, to another Sensor or a Gate.');
      return;
    }
    if (isCommandOnlyTarget(targetNode.kind) && sourceNode.kind !== 'command') {
      flashMessage(`A ${targetNode.kind} only accepts an incoming connection from a Command node.`);
      return;
    }
    const touchesCommand = sourceNode.kind === 'command' || targetNode.kind === 'command';
    if (touchesCommand) {
      const other = sourceNode.kind === 'command' ? targetNode : sourceNode;
      if (!isCommandCompatible(other.kind)) {
        flashMessage('A Command node only connects to a Sensor, a Source, a Gate, a Counter, or a Time node.');
        return;
      }
    }

    // Wire-vs-path output capacity (2026-09-11, Source's split slot —
    // see portCapacity.ts's `maxWireOutputs` doc comment): the same
    // touchesSensor/isCommandOnlyTarget/touchesCommand booleans that
    // decide edgeKind further down also decide which output bucket
    // this NEW edge would actually count against.
    const willBeWireEdge = touchesSensor || isCommandOnlyTarget(targetNode.kind) || touchesCommand;

    // Manual "Wire" arm (2026-09-11 follow-up — Falcon: "why i still
    // cant see a wire option in paths", confirmed via AskUserQuestion:
    // "Add a manual Wire tool"): armedEdgeStyle can now be 'copper'
    // itself, drawn straight from the Ribbon's Paths group just like
    // Trace/Conveyor/etc. — but copper is still only ever a REAL
    // signal edge, never a cosmetic paint job (see EdgeSkinFields'
    // own "Copper isn't offered as a free pick" comment). If the pair
    // being dragged isn't actually wire-eligible, reject here instead
    // of falling through to the generic `style` branch below, which
    // would otherwise silently create a plain item edge wearing the
    // copper skin.
    if (style === 'copper' && !willBeWireEdge) {
      flashMessage('A wire can only connect a Sensor, Gate, Command, Counter, Time, or Source to a compatible node.');
      return;
    }

    const targetCap = getPortCapacity(targetNode.kind);
    const outCap = applicableOutputCap(sourceNode.kind, willBeWireEdge);
    if (outCap !== undefined && relevantOutputEdges(sourceNode.kind, graph.outputEdges(sourceNodeId), willBeWireEdge).length >= outCap) {
      flashMessage(
        `A ${sourceNode.kind} can only have ${outCap}${willBeWireEdge ? ' wire' : ''} output${outCap === 1 ? '' : 's'}.`,
      );
      return;
    }
    if (targetCap.maxInputs !== undefined && graph.inputEdges(targetNodeId).length >= targetCap.maxInputs) {
      flashMessage(`A ${targetNode.kind} can only accept ${targetCap.maxInputs} input${targetCap.maxInputs === 1 ? '' : 's'}.`);
      return;
    }

    const id = `user-edge-${nextIdRef.current++}`;
    // Falcon, 2026-09-05: every new path now starts linear (bow=0),
    // not the old gentle-curve default. Floor-layer only — safe to
    // call before the GraphModel edge exists (2026-09-10, "the ports
    // are named according to compass"): picking the curve FIRST is
    // what lets sourcePort/targetPort below be set to whichever
    // anchor actually got picked (auto, or `explicitAnchors` when the
    // drag targeted one specific dot) instead of a hardcoded 0 that
    // ignored which physical side the wire was drawn from. The anchor
    // checks above already guarantee this succeeds.
    floorLayout.setEdgeCurve(id, sourceNodeId, targetNodeId, 0, explicitAnchors);
    const pickedAnchors = floorLayout.getEdgeAnchors(id);
    graph.addEdge({
      id,
      source: sourceNodeId,
      target: targetNodeId,
      sourcePort: pickedAnchors?.sourceAnchor ?? 0,
      targetPort: pickedAnchors?.targetAnchor ?? 0,
      flowRate: 0.15,
      active: true,
    });
    if (touchesSensor || isCommandOnlyTarget(targetNode.kind) || touchesCommand) {
      // Copper-path wiring rule (design doc §5.5), extended 2026-09-10
      // to a Sensor->Source/Gate/Counter/Time edge too (isCommandOnlyTarget), and again
      // the same day to any edge touching a Command node (Command's
      // own ports are copper-path-only, same as Sensor's): not a
      // style choice — every Sensor connection IS a signal edge,
      // styled copper, overriding whatever style tool happened to be
      // armed.
      graph.setEdgeKind(id, 'signal');
      skinConfig.setEdgeSkin(id, { style: 'copper' });
      if (style) setArmedEdgeStyle(null);
    } else if (style) {
      // Falcon, 2026-09-05: "I want to draw the selected path directly
      // ... no need to draw or sketch first" -- FluxCanvas's armed-style
      // drag-to-create gesture passes the armed style straight through
      // here, tagged onto the same new edge in one call, then disarms
      // -- the same one-shot arm-then-act convention placement/sketch/
      // apply-style-to-an-existing-edge all already follow. A plain
      // Shift+drag with nothing armed never passes a style, so this is
      // a no-op for that path.
      skinConfig.setEdgeSkin(id, { style });
      setArmedEdgeStyle(null);
    }
    setSelection({ type: 'edge', id });
  }

  /** Docking (design doc §5.6, 2026-09-09 — "attaching the node
   * without needing to add a path in between ... it will act and
   * behave like a single unit"): finalizes the drag-to-snap dock
   * FluxCanvas proposed on release (it already found the nearest
   * compatible free slot; this re-validates before touching anything,
   * same "FluxCanvas proposes, App.tsx owns the real mutation +
   * rejection checks" split every other gesture here follows).
   *
   * Direction (fixed 2026-09-09 after Falcon hit this live — see the
   * commit note): a "stationary = source" default was tried first and
   * turned out actively wrong the very first time it mattered. A Gate
   * ALREADY wired to a Sink (its one real physical output) got docked
   * to a Buffer with the dock ALSO landing as one of the Gate's
   * outputs — gate.ts's onItemArrival has no per-port routing at all
   * (`outputEdges.find(e => e.active && e.edgeKind !== 'signal')`, no
   * sourcePort check, unlike buffer/mixer/merger), so a Gate with TWO
   * real outputs is genuinely ambiguous, not just untidy: whichever
   * edge the array happens to return first is where every item goes,
   * and the Gate's physical INPUT side was left with nothing feeding
   * it at all — "nothing goes through," exactly as reported, not a
   * cosmetic glitch.
   *
   * So when one side is a Gate, direction is now derived from
   * whichever of the Gate's two physical sides is still actually
   * open, not from which node happened to be dragged:
   *  - Gate already has a real (non-signal) OUTPUT elsewhere → it's
   *    clearly acting as an out-gate already; the dock must feed
   *    INTO it (Buffer becomes source).
   *  - Gate already has a real INPUT elsewhere → it's an in-gate
   *    already; the dock must be its output (Gate becomes source).
   *  - Neither yet (a freshly placed Gate) → falls back to the
   *    original "stationary = source" guess, since there's genuinely
   *    no signal to read yet — still correctable via DockSection's
   *    "Flip direction" if it guesses wrong.
   *
   * Extended §5.7 (2026-09-09 follow-up) for the two new dockable
   * pairs: a Silo↔Silo dock has no equivalent physical-side ambiguity
   * to read (a Buffer can legitimately have several real outputs at
   * once, disambiguated by sourcePort — see buffer.ts's tryDrain — so
   * it never hits the single-real-output problem Gate has), so it
   * just keeps the plain stationary/dragged default. A Silo↔Sensor
   * dock is NOT an item edge at all and has its own fixed rule instead
   * of a heuristic: the Silo is ALWAYS the edge's source and the
   * Sensor ALWAYS its target, regardless of which node was physically
   * dragged, because "ingoing to the Sensor names the watched node"
   * (sensor.ts's watchedNodeIds) — docking a Sensor onto a Silo should
   * always mean "watch this Silo," never "command this Silo" (a
   * Buffer has no `open` state for a signal to drive anyway).
   *
   * Extended 2026-09-10 for Counter's three new dock pairs (Falcon,
   * via AskUserQuestion: "Source, Sensor, and Buffer/Silo too"):
   * Counter<->Sensor generalizes the Silo<->Sensor rule above for
   * free (nothing there actually checked "buffer" specifically).
   * Counter<->Source has its own fixed rule, even simpler than Gate's
   * heuristic: Source structurally can NEVER be a dock's target (it
   * has no real physical input at all), so it's always the source
   * side. Counter<->Buffer reuses Gate<->Buffer's own already-wired-
   * side heuristic, since Counter shares Gate's "exactly one real in,
   * one real out, no per-port routing" shape.
   *
   * Extended again 2026-09-10, same session, for Command<->Counter
   * (Falcon, after asking why a Sensor+Command pair stopped a Source:
   * "i want it to count only role and can manually be resetable or by
   * a command when docked with command"): same fixed direction as
   * Command<->Source — Command is always the edge source, Counter
   * always the target, no ambiguity to read. */
  function handleDockNodes(movingNodeId: NodeId, targetNodeId: NodeId, dir: number): void {
    const movingNode = graph.getNode(movingNodeId);
    const targetNode = graph.getNode(targetNodeId);
    if (!movingNode || !targetNode) return;
    if (!isDockCompatible(movingNode.kind, targetNode.kind)) return; // defensive -- FluxCanvas already filtered this

    const gateId = movingNode.kind === 'gate' ? movingNodeId : targetNode.kind === 'gate' ? targetNodeId : undefined;
    // Kind-checked (2026-09-11 fix, found while adding Command<->Gate
    // docking): this used to be purely positional — "whichever side
    // ISN'T the gate" — which was harmless back when Gate could only
    // ever dock with a Buffer, but would have mis-classified a
    // Command<->Gate dock as a Gate<->Buffer one (running the physical
    // in/out heuristic below against a Command, which has no physical
    // ports at all) now that Command is also a valid Gate dock partner.
    // Same "compute the other side, then check its ACTUAL kind" pattern
    // counterOtherKind/commandOtherKind below already use.
    const gateOtherId = gateId === movingNodeId ? targetNodeId : gateId === targetNodeId ? movingNodeId : undefined;
    const gateOtherKind = gateOtherId !== undefined ? graph.getNode(gateOtherId)?.kind : undefined;
    const bufferId = gateId !== undefined && gateOtherKind === 'buffer' ? gateOtherId : undefined;
    const sensorId = movingNode.kind === 'sensor' ? movingNodeId : targetNode.kind === 'sensor' ? targetNodeId : undefined;
    // Named `siloId` from the original Silo<->Sensor-only pair, kept
    // as-is (2026-09-10 follow-up: Counter<->Sensor is now ALSO a
    // signal dock, and generalizes here for free — this was already
    // just "whichever node is docking to the Sensor," buffer or
    // counter; sensor.ts's watchedNodeIds doesn't care whether it's
    // reading `queueLength` or `count` off the far end, only that the
    // edge points the right direction).
    const siloId = sensorId === movingNodeId ? targetNodeId : sensorId === targetNodeId ? movingNodeId : undefined;
    const isSiloSensorDock = sensorId !== undefined && siloId !== undefined;

    // Counter<->Source / Counter<->Buffer (2026-09-10 follow-up): both
    // are real ITEM docks, never signal — a Counter<->Sensor dock is
    // signal, but that's isSiloSensorDock above already, generically.
    const counterId = movingNode.kind === 'counter' ? movingNodeId : targetNode.kind === 'counter' ? targetNodeId : undefined;
    const counterOtherId = counterId === movingNodeId ? targetNodeId : counterId === targetNodeId ? movingNodeId : undefined;
    const counterOtherKind = counterOtherId !== undefined ? graph.getNode(counterOtherId)?.kind : undefined;
    const isCounterSourceDock = counterId !== undefined && counterOtherKind === 'source';
    const isCounterBufferDock = counterId !== undefined && counterOtherKind === 'buffer';

    // Command<->Sensor / Command<->Source (2026-09-10 follow-up, the
    // Command node — Falcon: "it is compatible only with wire and
    // dockable to source node and sensor node"): both are signal docks,
    // never item edges — command.ts has no onItemArrival, same
    // conservation rationale as Sensor's own fully-copper ports.
    const commandId = movingNode.kind === 'command' ? movingNodeId : targetNode.kind === 'command' ? targetNodeId : undefined;
    const commandOtherId = commandId === movingNodeId ? targetNodeId : commandId === targetNodeId ? movingNodeId : undefined;
    const commandOtherKind = commandOtherId !== undefined ? graph.getNode(commandOtherId)?.kind : undefined;
    // "Commanded" direction — the OPPOSITE of the "watched" convention
    // isSiloSensorDock/counter<->sensor use above: the Sensor is
    // always the edge SOURCE and Command always the TARGET, the same
    // direction Sensor already has wiring to Gate. Docking Command to
    // a Sensor does nothing TO the Sensor — this is purely Command's
    // input side (Falcon: "although command can be docked to a sensor
    // node but it wont do anything to sensor node unlike other node it
    // attach to").
    const isCommandSensorDock = commandId !== undefined && commandOtherKind === 'sensor';
    // Command is always the edge source, Source always the target — no
    // ambiguity to read either way, same as Counter<->Source above
    // (Source can never be an edge TARGET for a real item; one of its
    // two signal-input slots — portCapacity.ts's maxInputs bumped
    // again 1 -> 2, 2026-09-11 follow-up, for a second, independently
    // wireable reset-purposed Command — is what this dock fills; which
    // of the two slots doesn't matter structurally, since it's the
    // docked Command's own `verb` that decides what it does, not
    // which physical anchor it lands on).
    const isCommandSourceDock = commandId !== undefined && commandOtherKind === 'source';
    // Command<->Counter (2026-09-10, same-day follow-up — Falcon,
    // after asking why a Sensor+Command pair stopped a Source: "i want
    // it to count only role and can manually be resetable or by a
    // command when docked with command"): same direction as
    // Command<->Source above — Command is always the edge source,
    // Counter always the target. This fills Counter's NEW signal-only
    // input slot (portCapacity.ts, maxInputs bumped 1 -> 2), never its
    // real item one, so there's nothing to disambiguate the way
    // Counter<->Buffer's already-wired-side heuristic needs.
    const isCommandCounterDock = commandId !== undefined && commandOtherKind === 'counter';
    // Command<->Gate / Command<->Time (2026-09-11, Command role-split
    // finalization — "full dock support" so Command mirrors Buffer's
    // existing dock precedent for every target kind it can actuate).
    // Same direction as Command<->Source/Counter above: Command is
    // always the edge source, the target kind always the edge target
    // (Gate/Time can never legitimately be an edge SOURCE for a signal
    // — their whole role is receiving Command's verb/duration).
    const isCommandGateDock = commandId !== undefined && commandOtherKind === 'gate';
    const isCommandTimeDock = commandId !== undefined && commandOtherKind === 'time';
    const isCommandDock =
      isCommandSensorDock || isCommandSourceDock || isCommandCounterDock || isCommandGateDock || isCommandTimeDock;

    let edgeSourceId = targetNodeId;
    let edgeTargetId = movingNodeId;
    if (gateId !== undefined && bufferId !== undefined) {
      const gateHasRealOutput = graph.outputEdges(gateId).some((e) => e.edgeKind !== 'signal');
      const gateHasRealInput = graph.inputEdges(gateId).some((e) => e.edgeKind !== 'signal');
      if (gateHasRealOutput && !gateHasRealInput) {
        edgeSourceId = bufferId;
        edgeTargetId = gateId;
      } else if (gateHasRealInput && !gateHasRealOutput) {
        edgeSourceId = gateId;
        edgeTargetId = bufferId;
      }
      // else: both sides already wired, or neither is — fall back to
      // the stationary/dragged default set above.
    } else if (isSiloSensorDock) {
      edgeSourceId = siloId!;
      edgeTargetId = sensorId!;
    } else if (isCounterSourceDock) {
      // Source can never be an edge TARGET (0 real physical inputs by
      // construction — its one input slot is signal-only, see
      // isCommandOnlyTarget) so there's no ambiguity to read at all,
      // unlike Gate<->Buffer above: it's always the dock's source
      // side, Counter always its target, regardless of which node was
      // physically dragged.
      edgeSourceId = counterOtherId!;
      edgeTargetId = counterId!;
    } else if (isCounterBufferDock) {
      // Same "exactly one real in + one real out, no per-port routing"
      // ambiguity Gate<->Buffer already solves for Gate above —
      // counter.ts's onItemArrival has the identical "first active
      // non-signal edge" shape, so this reuses the same already-wired-
      // side heuristic instead of the plain stationary/dragged default
      // a Buffer<->Buffer dock uses (a Buffer, unlike Counter/Gate, CAN
      // legitimately have several real outputs at once, disambiguated
      // by sourcePort — see buffer.ts's tryDrain — so it never hits
      // this problem itself).
      const counterHasRealOutput = graph.outputEdges(counterId!).some((e) => e.edgeKind !== 'signal');
      const counterHasRealInput = graph.inputEdges(counterId!).some((e) => e.edgeKind !== 'signal');
      if (counterHasRealOutput && !counterHasRealInput) {
        edgeSourceId = counterOtherId!;
        edgeTargetId = counterId!;
      } else if (counterHasRealInput && !counterHasRealOutput) {
        edgeSourceId = counterId!;
        edgeTargetId = counterOtherId!;
      }
      // else: both sides already wired, or neither is — fall back to
      // the stationary/dragged default set above.
    } else if (isCommandSensorDock) {
      edgeSourceId = commandOtherId!;
      edgeTargetId = commandId!;
    } else if (isCommandSourceDock || isCommandCounterDock || isCommandGateDock || isCommandTimeDock) {
      edgeSourceId = commandId!;
      edgeTargetId = commandOtherId!;
    }
    // else (Silo↔Silo, or any future pair with nothing more specific
    // to say): the plain stationary/dragged default above stands.
    const edgeSourceNode = graph.getNode(edgeSourceId)!;
    const edgeTargetNode = graph.getNode(edgeTargetId)!;

    // Same wire-vs-path split as handleCreateEdge above — a dock
    // resolves to edgeKind 'signal' exactly when isSiloSensorDock or
    // isCommandDock fired (see this function's own edgeKind line
    // further down), so that's the wire-ness to check capacity with.
    const dockWillBeWireEdge = isSiloSensorDock || isCommandDock;
    const targetCap = getPortCapacity(edgeTargetNode.kind);
    const dockOutCap = applicableOutputCap(edgeSourceNode.kind, dockWillBeWireEdge);
    if (
      dockOutCap !== undefined &&
      relevantOutputEdges(edgeSourceNode.kind, graph.outputEdges(edgeSourceId), dockWillBeWireEdge).length >= dockOutCap
    ) {
      flashMessage(
        `Can't dock — a ${edgeSourceNode.kind} can only have ${dockOutCap}${dockWillBeWireEdge ? ' wire' : ''} output${dockOutCap === 1 ? '' : 's'}.`,
      );
      return;
    }
    if (targetCap.maxInputs !== undefined && graph.inputEdges(edgeTargetId).length >= targetCap.maxInputs) {
      flashMessage(
        `Can't dock — a ${edgeTargetNode.kind} can only accept ${targetCap.maxInputs} input${targetCap.maxInputs === 1 ? '' : 's'}.`,
      );
      return;
    }

    // Position (design doc §5.6, revised 2026-09-14 — Falcon: "i want
    // it to get or removed but still dock without having to snap to
    // its edge that close just enough to maintain the positioning or
    // normal positioning"): docking no longer force-relocates the
    // node onto dockedPosition's exact 2×NODE_RADIUS slot. The node
    // stays exactly where the drag released it — FluxCanvas's
    // onPointerUp already validated that spot against wouldOverlap
    // before ever proposing a dock (see its own comment there), so
    // there's nothing left to re-check or move here. `dockedPosition`
    // is still used by FloorLayout.nearestDockSlot purely to MEASURE
    // proximity (is the drop close enough to count as a dock at all),
    // never to relocate anything — that's the "normal positioning"
    // Falcon asked for: the anti-overlap floor is the only thing that
    // still constrains where a docked node can sit, same as any two
    // manually-placed nodes.
    const oppositeDir = (dir + 4) % 8; // octagon's 8 compass anchors, the far side facing back
    // `dir` is always the compass direction ON targetNodeId (the
    // stationary node FluxCanvas measured the slot from), regardless
    // of which of the two ends the gate-aware logic above chose as
    // the EDGE's source — so the anchor assigned to each node must be
    // looked up by which physical node it is, never assumed to line
    // up with source/target.
    const targetNodeAnchor = dir;
    const movingNodeAnchor = oppositeDir;
    const edgeSourceAnchor = edgeSourceId === targetNodeId ? targetNodeAnchor : movingNodeAnchor;
    const edgeTargetAnchor = edgeTargetId === targetNodeId ? targetNodeAnchor : movingNodeAnchor;

    const id = `user-edge-${nextIdRef.current++}`;
    // 2026-09-10 ("the ports are named according to compass"):
    // sourcePort/targetPort are now just the physical anchor each end
    // is docked at (edgeSourceAnchor/edgeTargetAnchor, already worked
    // out above) — this alone is what used to need the old
    // "sourceHasRealOutputAtPort0 -> dockSourcePort 0-or-1" dodge:
    // since every anchor on a node is unique by construction (8-socket
    // cap, checked earlier in this function), a docked edge can never
    // collide with another real output's port again, whatever number
    // it happens to be.
    graph.addEdge({
      id,
      source: edgeSourceId,
      target: edgeTargetId,
      sourcePort: edgeSourceAnchor,
      targetPort: edgeTargetAnchor,
      flowRate: DOCK_FLOW_RATE,
      active: true,
      // Silo↔Sensor (or, as of 2026-09-10, Counter↔Sensor and, same
      // day's Command follow-up, Command↔Sensor/Command↔Source) is a
      // copper/signal connection, never a real item edge (neither a
      // Sensor nor a Command has an onItemArrival — see
      // portCapacity.ts) — every other dockable pair, Counter↔Source
      // and Counter↔Buffer included, keeps the original huge-flowRate
      // item-edge treatment. `docked: true` marks BOTH as a rigid
      // attachment for FluxCanvas's group-move and PropertiesPanel's
      // DockSection regardless of which edgeKind it ends up with (see
      // that field's own doc comment in types.ts).
      edgeKind: isSiloSensorDock || isCommandDock ? 'signal' : 'dock',
      docked: true,
    });
    floorLayout.setEdgeCurve(id, edgeSourceId, edgeTargetId, 0, {
      sourceAnchor: edgeSourceAnchor,
      targetAnchor: edgeTargetAnchor,
    });
    if (isSiloSensorDock || isCommandDock) {
      // Same copper-path skin every hand-drawn Sensor connection gets
      // (handleCreateEdge) — a docked Silo↔Sensor or Command↔Sensor/
      // Command↔Source pair should look exactly like a short copper
      // wire, not a physical conveyor.
      skinConfig.setEdgeSkin(id, { style: 'copper' });
    }
    setSelection({ type: 'node', id: movingNodeId });
    flashMessage(`Docked ${edgeTargetNode.kind} to ${edgeSourceNode.kind}.`);
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
    setMoveArmed(false);
    setRotateArmed(false);
    setMeasureArmed(false);
    setPlacementKind(kind);
  }

  function handleArmEdgeStyle(style: EdgeStyle | null): void {
    setPlacementKind(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setMoveArmed(false);
    setRotateArmed(false);
    setMeasureArmed(false);
    setArmedEdgeStyle(style);
  }

  function handleArmSketch(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setMultiSelectArmed(false);
    setMoveArmed(false);
    setRotateArmed(false);
    setMeasureArmed(false);
    setSketchArmed(armed);
  }

  function handleArmMultiSelect(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setMoveArmed(false);
    setRotateArmed(false);
    setMeasureArmed(false);
    setMultiSelectArmed(armed);
    setQuickSelectFilter('nodes');
  }

  /** FBP016 (2026-09-06): Move/Rotate -- replaces handleArmPan's old
   * slot in the same mutual-exclusion pattern (arming one clears
   * every other tool, including each other). */
  function handleArmMove(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setRotateArmed(false);
    setMeasureArmed(false);
    setMoveArmed(armed);
  }

  function handleArmRotate(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setMoveArmed(false);
    setMeasureArmed(false);
    setRotateArmed(armed);
  }

  /** TOOLS tab's Measure tool (Falcon, 2026-09-14) -- same mutual-
   * exclusion pattern as every arm-then-act tool above. */
  function handleArmMeasure(armed: boolean): void {
    setPlacementKind(null);
    setArmedEdgeStyle(null);
    setSketchArmed(false);
    setMultiSelectArmed(false);
    setMoveArmed(false);
    setRotateArmed(false);
    setMeasureArmed(armed);
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
    // Manual-"Wire"-arm guard (2026-09-11 follow-up), restyle side:
    // clicking an EXISTING path while 'copper' is armed must not
    // repaint a plain item edge to look like a signal edge — only an
    // edge that's actually `edgeKind: 'signal'` may wear copper. Every
    // other style stays freely applicable to any edge, same as ever.
    if (style === 'copper' && graph.getEdge(edgeId)?.edgeKind !== 'signal') {
      flashMessage("Can't restyle — Wire only applies to an actual signal connection, not a real item path.");
      setArmedEdgeStyle(null);
      return;
    }
    skinConfig.setEdgeSkin(edgeId, { style });
    setArmedEdgeStyle(null);
  }

  /** INSERT tab (Falcon, 2026-09-09): drag an icon OR the plain
   * "Text" tool from the ribbon and drop it on the canvas to place a
   * free-floating annotation there — no simulation meaning, purely
   * explanatory. Selects the new annotation so its label can be typed
   * right away. */
  function handleDropAnnotation(
    payload:
      | { kind: 'icon'; icon: AnnotationIconKind }
      | { kind: 'text' }
      | { kind: 'custom'; customIconId: string },
    position: Point,
  ): void {
    const id = `annotation-${nextIdRef.current++}`;
    if (payload.kind === 'text') {
      annotationLayer.add({ id, position, kind: 'text' });
    } else if (payload.kind === 'custom') {
      annotationLayer.add({ id, position, kind: 'custom', customIconId: payload.customIconId });
    } else {
      annotationLayer.add({ id, position, kind: 'icon', icon: payload.icon });
    }
    setSelection({ type: 'annotation', id });
  }

  /** Falcon, 2026-09-09 ("import svgs or images for user custom" —
   * resolved as a shared, app-wide library): Ribbon.tsx reads the
   * dropped/picked file itself (FileReader.readAsDataURL handles an
   * .svg the same way it handles a .png/.jpg — the browser infers the
   * right data: MIME type from the file either way, so nothing here
   * needs to branch on file type) and hands back just the name +
   * finished data URL. Saves the WHOLE library file immediately —
   * it's small and only changes on an explicit user action, not a
   * per-tick autosave. */
  function handleImportCustomIcon(name: string, dataUrl: string): void {
    const id = `custom-icon-${nextIdRef.current++}`;
    customIconLibrary.add({ id, name, dataUrl });
    void saveCustomIconLibraryFile(customIconLibrary.getAll());
  }

  /** Deletion is NOT blocked by "is this still referenced" here —
   * unlike ObjectRegistry's delete guard, this library is shared
   * across every project, and only the CURRENTLY OPEN project's
   * annotations are ever loaded at once, so there is no reliable way
   * to check every project at once. An annotation left pointing at a
   * since-deleted id just renders a neutral placeholder instead
   * (FluxCanvas.tsx) — the same "never silently vanish, never crash"
   * spirit as ObjectRegistry.resolve()'s fallback, just without the
   * up-front guard that isn't possible here. */
  function handleDeleteCustomIcon(id: string): void {
    customIconLibrary.remove(id);
    void saveCustomIconLibraryFile(customIconLibrary.getAll());
  }

  function handleUpdateAnnotationLabel(id: string, label: string): void {
    annotationLayer.update(id, { label });
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

    // Copper-path wiring rule (design doc \u00a75.5) \u2014 same check as
    // handleCreateEdge, applied here too so a sketch can't route
    // around it.
    const touchesSensor = sourceNode.kind === 'sensor' || targetNode.kind === 'sensor';
    if (touchesSensor && (!isCopperCompatible(sourceNode.kind) || !isCopperCompatible(targetNode.kind))) {
      flashMessage("Can't convert \u2014 a Sensor only connects via a copper path, to another Sensor or a Gate.");
      return;
    }
    if (isCommandOnlyTarget(targetNode.kind) && sourceNode.kind !== 'command') {
      flashMessage(`Can't convert \u2014 a ${targetNode.kind} only accepts an incoming connection from a Command node.`);
      return;
    }
    const touchesCommand = sourceNode.kind === 'command' || targetNode.kind === 'command';
    if (touchesCommand) {
      const other = sourceNode.kind === 'command' ? targetNode : sourceNode;
      if (!isCommandCompatible(other.kind)) {
        flashMessage("Can't convert \u2014 a Command node only connects to a Sensor, a Source, a Gate, a Counter, or a Time node.");
        return;
      }
    }

    // Same wire-vs-path split as handleCreateEdge above.
    const willBeWireEdge = touchesSensor || isCommandOnlyTarget(targetNode.kind) || touchesCommand;

    // Same manual-"Wire"-arm guard as handleCreateEdge above (2026-09-11
    // follow-up) \u2014 a sketch converted while 'copper' is armed still
    // needs an actually wire-eligible pair, or it's rejected here
    // rather than converting into a plain item edge wearing copper.
    if (style === 'copper' && !willBeWireEdge) {
      flashMessage("Can't convert \u2014 a wire can only connect a Sensor, Gate, Command, Counter, Time, or Source to a compatible node.");
      return;
    }

    const targetCap = getPortCapacity(targetNode.kind);
    const outCap = applicableOutputCap(sourceNode.kind, willBeWireEdge);
    if (outCap !== undefined && relevantOutputEdges(sourceNode.kind, graph.outputEdges(sourceNodeId), willBeWireEdge).length >= outCap) {
      flashMessage(`Can't convert \u2014 a ${sourceNode.kind} can only have ${outCap}${willBeWireEdge ? ' wire' : ''} output${outCap === 1 ? '' : 's'}.`);
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
    // 2026-09-10 ("the ports are named according to compass"):
    // sourcePort/targetPort are the anchor indices this exact sketch
    // was already attached at, not a hardcoded 0 — same anchor
    // `setEdgeCurve` below re-attaches the real edge to.
    graph.addEdge({
      id,
      source: sourceNodeId,
      target: targetNodeId,
      sourcePort: sourceAnchor,
      targetPort: targetAnchor,
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
    if (touchesSensor || isCommandOnlyTarget(targetNode.kind) || touchesCommand) {
      // Copper-path wiring rule (design doc §5.5), extended 2026-09-10
      // to Sensor->Source too, and to any Command-touching edge —
      // overrides whatever style the sketch was converting with, same
      // as handleCreateEdge.
      graph.setEdgeKind(id, 'signal');
      skinConfig.setEdgeSkin(id, { style: 'copper' });
    } else {
      skinConfig.setEdgeSkin(id, { style });
    }
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
    let skippedIncompatible = 0;

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
      // Copper-path wiring rule (design doc §5.5) — same check as the
      // single-sketch conversion above.
      const touchesSensor = sourceNode.kind === 'sensor' || targetNode.kind === 'sensor';
      if (touchesSensor && (!isCopperCompatible(sourceNode.kind) || !isCopperCompatible(targetNode.kind))) {
        skippedIncompatible++;
        continue;
      }
      if (isCommandOnlyTarget(targetNode.kind) && sourceNode.kind !== 'command') {
        skippedIncompatible++;
        continue;
      }
      const touchesCommand = sourceNode.kind === 'command' || targetNode.kind === 'command';
      if (touchesCommand) {
        const other = sourceNode.kind === 'command' ? targetNode : sourceNode;
        if (!isCommandCompatible(other.kind)) {
          skippedIncompatible++;
          continue;
        }
      }
      // Same wire-vs-path split as handleCreateEdge above.
      const willBeWireEdge = touchesSensor || isCommandOnlyTarget(targetNode.kind) || touchesCommand;
      // Same manual-"Wire"-arm guard as handleCreateEdge/
      // handleConvertSketchToPath above (2026-09-11 follow-up) — a
      // batch-converted sketch armed with 'copper' still needs an
      // actually wire-eligible pair.
      if (style === 'copper' && !willBeWireEdge) {
        skippedIncompatible++;
        continue;
      }
      const targetCap = getPortCapacity(targetNode.kind);
      const outCap = applicableOutputCap(sourceNode.kind, willBeWireEdge);
      if (outCap !== undefined && relevantOutputEdges(sourceNode.kind, graph.outputEdges(sourceNodeId), willBeWireEdge).length >= outCap) {
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
      // 2026-09-10 ("the ports are named according to compass"): same
      // fix as the single-sketch conversion above — sourcePort/
      // targetPort are this sketch's own attached anchors, not 0.
      graph.addEdge({
        id,
        source: sourceNodeId,
        target: targetNodeId,
        sourcePort: sourceAnchor,
        targetPort: targetAnchor,
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
      if (touchesSensor || isCommandOnlyTarget(targetNode.kind) || touchesCommand) {
        graph.setEdgeKind(id, 'signal');
        skinConfig.setEdgeSkin(id, { style: 'copper' });
      } else {
        skinConfig.setEdgeSkin(id, { style });
      }
      sketchLayer.remove(sketchId);
      converted++;
    }

    const skipped = skippedNotPinned + skippedPortFull + skippedIncompatible;
    if (skipped === 0) {
      flashMessage(`Converted ${converted} sketch${converted === 1 ? '' : 'es'} to path${converted === 1 ? '' : 's'}.`);
    } else {
      const reasons: string[] = [];
      if (skippedNotPinned > 0) reasons.push(`${skippedNotPinned} not fully pinned`);
      if (skippedPortFull > 0) reasons.push(`${skippedPortFull} port full`);
      if (skippedIncompatible > 0) reasons.push(`${skippedIncompatible} incompatible wiring`);
      flashMessage(`${converted} converted, ${skipped} skipped \u2014 ${reasons.join(', ')}.`);
    }
    setSelection(null);
  }

  /** Multi-select's batch "Convert all" for a paths-only selection —
   * restyles every selected path to one chosen style in one go,
   * mirroring the single-edge style picker in EdgeSkinFields. */
  function handleBatchRestyleEdges(edgeIds: string[], style: EdgeStyle): void {
    // Same manual-"Wire"-arm guard as handleApplyEdgeStyle above
    // (2026-09-11 follow-up) — a batch restyle to 'copper' only
    // touches edges that are actually `edgeKind: 'signal'`; any real
    // item path in the selection is silently skipped rather than
    // repainted, same "skip and report" convention batch conversion
    // already uses for an incompatible sketch.
    let restyled = 0;
    let skippedNotWire = 0;
    for (const edgeId of edgeIds) {
      if (style === 'copper' && graph.getEdge(edgeId)?.edgeKind !== 'signal') {
        skippedNotWire++;
        continue;
      }
      skinConfig.setEdgeSkin(edgeId, { style });
      restyled++;
    }
    if (skippedNotWire === 0) {
      flashMessage(`Restyled ${restyled} path${restyled === 1 ? '' : 's'}.`);
    } else {
      flashMessage(`Restyled ${restyled}, skipped ${skippedNotWire} — Wire only applies to a real signal connection.`);
    }
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
        : measureArmed
          ? 'Drag between two points to measure — snaps to ports, node centers, node body edges, or the grid.'
          : multiSelectArmed
          ? quickSelectFilter === 'paths'
            ? 'Drag over the canvas — only the paths inside the box will be selected.'
            : quickSelectFilter === 'sketches'
              ? 'Drag over the canvas — only the sketches inside the box will be selected.'
              : quickSelectFilter === 'all'
                ? 'Drag over the canvas — every node, path, and sketch inside the box will be selected.'
                : 'Click nodes to toggle them into the selection, or drag over empty canvas to select the nodes inside the box.'
          : moveArmed
            ? selection?.type === 'edge' || selection?.type === 'sketch'
              ? 'Drag anywhere to reshape the selected path/sketch — its two ends stay pinned.'
              : 'Select a path or sketch, then drag to move its shape.'
            : rotateArmed
              ? selection?.type === 'edge' || selection?.type === 'sketch'
                ? 'Drag anywhere to rotate the selected path/sketch around its own center — snaps near 15° steps.'
                : 'Select a path or sketch, then drag to rotate its shape.'
              : selection?.type === 'node'
                ? 'Node selected — drag to move it (if unlocked), Shift+drag to wire, Delete to remove.'
                : selection?.type === 'multi'
                  ? `${selection.nodeIds.length + selection.edgeIds.length + selection.sketchIds.length} items selected${selection.groupId ? ' (grouped)' : ''} — drag a node to move the group, Delete to remove, Duplicate to clone the nodes.`
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
        onTabChange={(tab) => {
          setActiveRibbonTab(tab);
          // Leaving INSERT means the icon library view no longer
          // applies -- back to Projects (Falcon: "projects will only
          // show when home tab was clicked").
          if (tab !== 'insert') setLeftPanelView('projects');
        }}
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
        moveArmed={moveArmed}
        onArmMove={handleArmMove}
        rotateArmed={rotateArmed}
        onArmRotate={handleArmRotate}
        measureArmed={measureArmed}
        onArmMeasure={handleArmMeasure}
        canDelete={selection !== null}
        onDeleteSelection={handleDeleteSelection}
        canDuplicate={selection?.type === 'node' || (selection?.type === 'multi' && selection.nodeIds.length > 0)}
        onDuplicateSelection={handleDuplicateSelection}
        onQuickSelect={handleQuickSelect}
        canFlip={selection?.type === 'edge' || selection?.type === 'sketch'}
        onFlipSelection={handleFlipSelection}
        canGroup={
          selection?.type === 'multi' &&
          !selection.groupId &&
          selection.nodeIds.length + selection.edgeIds.length + selection.sketchIds.length >= 2
        }
        onGroupSelection={handleGroupSelection}
        canUngroup={selection?.type === 'multi' && !!selection.groupId}
        onUngroupSelection={handleUngroupSelection}
        onOpenObjectsManager={() => setObjectsManagerOpen(true)}
        snapToGrid={snapToGrid}
        onToggleSnapToGrid={() => setSnapToGrid((v) => !v)}
        gridSpacing={gridSpacing}
        onGridSpacingChange={setGridSpacing}
        tickIntervalMs={tickIntervalMs}
        showPathDirection={showPathDirection}
        onToggleShowPathDirection={() => setShowPathDirection((v) => !v)}
        onTickIntervalMsChange={setTickIntervalMs}
        canvasBackground={canvasBackground}
        onCanvasBackgroundChange={setCanvasBackground}
        customIconLibrary={customIconLibrary}
        onImportCustomIcon={handleImportCustomIcon}
        onDeleteCustomIcon={handleDeleteCustomIcon}
        onShowMoreIcons={() => setLeftPanelView('icons')}
        onShowMoreNodes={() => setLeftPanelView('nodes')}
        onShowMorePaths={() => setLeftPanelView('paths')}
        onShowMoreModify={() => setLeftPanelView('modify')}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftPanel
          projects={projects}
          activeProjectId={activeProjectId}
          onSwitchProject={handleSwitchProject}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          view={leftPanelView}
          onBackToProjects={() => setLeftPanelView('projects')}
          armedKind={placementKind}
          onArmKind={handleArmNodeKind}
          armedEdgeStyle={armedEdgeStyle}
          onArmEdgeStyle={handleArmEdgeStyle}
          sketchArmed={sketchArmed}
          onArmSketch={handleArmSketch}
          sketchStyle={sketchStyle}
          onSketchStyleChange={setSketchStyle}
          canDelete={selection !== null}
          onDeleteSelection={handleDeleteSelection}
          multiSelectArmed={multiSelectArmed}
          onArmMultiSelect={handleArmMultiSelect}
          onQuickSelect={handleQuickSelect}
          canDuplicate={selection?.type === 'node' || (selection?.type === 'multi' && selection.nodeIds.length > 0)}
          onDuplicateSelection={handleDuplicateSelection}
          moveArmed={moveArmed}
          onArmMove={handleArmMove}
          rotateArmed={rotateArmed}
          onArmRotate={handleArmRotate}
          canFlip={selection?.type === 'edge' || selection?.type === 'sketch'}
          onFlipSelection={handleFlipSelection}
          canGroup={
            selection?.type === 'multi' &&
            !selection.groupId &&
            selection.nodeIds.length + selection.edgeIds.length + selection.sketchIds.length >= 2
          }
          onGroupSelection={handleGroupSelection}
          canUngroup={selection?.type === 'multi' && !!selection.groupId}
          onUngroupSelection={handleUngroupSelection}
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
            onSelect={handleSelect}
            placementKind={placementKind}
            onPlaceNode={handlePlaceNode}
            onCreateEdge={handleCreateEdge}
            onConnectionRejected={flashMessage}
            onDockNodes={handleDockNodes}
            snapToGrid={snapToGrid}
            gridSpacing={gridSpacing}
            armedEdgeStyle={armedEdgeStyle}
            onApplyEdgeStyle={handleApplyEdgeStyle}
            onRunningChange={setIsRunning}
            sketchLayer={sketchLayer}
            sketchArmed={sketchArmed}
            sketchStyle={sketchStyle}
            onCreateSketch={handleCreateSketch}
            annotationLayer={annotationLayer}
            onDropAnnotation={handleDropAnnotation}
            customIconLibrary={customIconLibrary}
            multiSelectArmed={multiSelectArmed}
            quickSelectFilter={quickSelectFilter}
            moveArmed={moveArmed}
            rotateArmed={rotateArmed}
            measureArmed={measureArmed}
            canvasBackground={canvasBackground}
            onCursorWorldPositionChange={setCursorWorldPosition}
            showPathDirection={showPathDirection}
          />
        </div>
        <PropertiesPanel
          selection={selection}
          graph={graph}
          skinConfig={skinConfig}
          floorLayout={floorLayout}
          sketchLayer={sketchLayer}
          annotationLayer={annotationLayer}
          customIconLibrary={customIconLibrary}
          objectRegistry={objectRegistry}
          onDelete={handleDeleteSelection}
          onUpdateAnnotationLabel={handleUpdateAnnotationLabel}
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
