import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Camera, type Viewport } from '../floor/camera';
import { NODE_RADIUS, type AnchorHit, type FloorLayout } from '../floor/floorLayout';
import { InterpolatedSimDriver } from '../floor/interpolatedSim';
import { GraphModel } from '../core/GraphModel';
import { SimEngine } from '../core/SimEngine';
import type { EdgeDef, EdgeId, NodeDef, NodeId, NodeKind } from '../core/types';
import { curveBetween, BezierPath, shapeCenter, translatePoints, rotatePoints, type Point } from '../floor/bezier';
import type { SkinConfig } from '../skin/SkinConfig';
import type { ObjectRegistry } from '../skin/ObjectRegistry';
import { darkenHex } from '../skin/canvasUtil';
import { drawNode, drawNodeLockBadge, drawNodeSelectionRing } from '../skin/nodeSkin';
import {
  drawPathUnder,
  drawPathOver,
  drawPathDirectionArrow,
  drawItemToken,
  getItemRotation,
  drawCurveSelectionHighlight,
  type EdgeStyle,
} from '../skin/pathSkin';
import { octagonVertices, isPointInOctagon } from '../skin/octagon';
import { normalizeMultiParts, collapseSelection, type Selection } from './selection';
import { SketchLayer, getSketchReshapePoints, applySketchReshapePoints, type SketchAttachment, type SketchSegment } from './sketchLayer';
import { AnnotationLayer, type Annotation, type AnnotationIconKind } from './annotationLayer';
import type { CustomIconLibrary } from '../skin/customIconLibrary';
import { annotationIcons, ANNOTATION_ICON_COLOR, ANNOTATION_DEFAULT_FONT_FAMILY } from '../skin/annotationIcons';
import { CANVAS_THEMES, type CanvasBackground } from './theme';

/** Falcon, 2026-09-05 ("no way to end the continuous lines... so im
 * proposing a path style... 'single path','polypath'"): which gesture
 * an armed Sketch tool uses. 'single' is the original one-continuous-
 * drag-equals-one-segment behavior (auto-completes on release, no
 * explicit end gesture) -- the sensible default, since requiring a
 * double-click/Enter to finish even a simple one-segment sketch was
 * the regression Falcon hit. 'polypath' is the click-to-place chain
 * gesture built for genuinely multi-segment sketches (double-click/
 * Enter/Escape to finish -- see finalizeSketchChain/cancelSketchChain).
 * A third 'arc' mode (three clicks as an arc's tangent points) was
 * proposed alongside these but explicitly deferred by Falcon as the
 * challenging one -- not implemented here. */
export type SketchStyle = 'single' | 'polypath';

interface FluxCanvasProps {
  graph: GraphModel;
  floorLayout: FloorLayout;
  skinConfig: SkinConfig;
  /** OBJECTS registry (FBP011, 2026-09-05) — resolves each in-
   * flight item's `type` tag to a shape/size/color for
   * drawItemToken. Mutated directly like graph/floorLayout/
   * skinConfig (design doc §4.6), so editing a type in the
   * Objects manager is picked up on the very next animation
   * frame with no extra plumbing. */
  objectRegistry: ObjectRegistry;
  /** Fixed logic-tick interval — decoupled from render frame rate
   * (design doc §5.1). */
  tickIntervalMs?: number;

  /** Milestone 5: click-to-select. null = nothing selected. */
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  /** When set, the NEXT click on empty canvas places a new node of
   * this kind there instead of doing anything else (armed by the
   * node palette). */
  placementKind: NodeKind | null;
  onPlaceNode: (kind: NodeKind, worldPoint: Point) => void;
  /** Shift+drag from one node's body to another's to connect them.
   * Falcon, 2026-09-05 ("snap on those dots"): if the drag started or
   * ended precisely on a specific port dot, the 3rd argument carries
   * that exact anchor for that end — App.tsx honors it instead of
   * auto-picking the nearest free one, and rejects the connection
   * outright if that specific dot turns out to be taken. A body drop
   * with no precise dot under the cursor omits the corresponding
   * field, falling back to today's auto-pick behavior. The optional
   * 4th argument (Falcon, 2026-09-05: "I want to draw the selected
   * path directly ... no need to draw or sketch first") is set only
   * by the new armed-style drag-to-create gesture below — App.tsx
   * applies it to the new edge's skin in the same call, and omitting
   * it (a plain Shift+drag with nothing armed) leaves the edge at its
   * default style, unchanged from before. */
  onCreateEdge: (
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    explicitAnchors?: { sourceAnchor?: number; targetAnchor?: number },
    style?: EdgeStyle,
  ) => void;
  /** Falcon, 2026-09-05 ("a rejected connection... fails
   * completely silently"): fires with a short human-readable
   * reason whenever a connection attempt is rejected WITHOUT ever
   * calling onCreateEdge — today, only the "released precisely on
   * an already-taken port dot" case (App.tsx's handleCreateEdge
   * covers every other rejection reason itself, since it owns the
   * anchor/capacity checks). */
  onConnectionRejected?: (message: string) => void;
  /** Move/delete/snap feature set: when true, a dragged node's
   * position is rounded to the nearest grid line as it moves (App.tsx
   * owns the toggle — header button + F8 shortcut). */
  snapToGrid: boolean;
  /** World-space spacing between grid lines — also the quantum
   * snap-to-grid rounds to. App.tsx owns this as an editable canvas
   * setting (properties panel's Canvas & Simulation section). */
  gridSpacing: number;
  /** PATHS palette: when set, the next click on an EXISTING edge
   * applies this style to it instead of selecting it (armed by
   * PathPalette — mirrors placementKind's node-creation flow). */
  armedEdgeStyle: EdgeStyle | null;
  onApplyEdgeStyle: (edgeId: EdgeId, style: EdgeStyle) => void;
  /** Reports RUN/HOLD state changes so App.tsx's bottom-bar Play/Pause
   * button can mirror it — the actual toggle lives here via
   * FluxCanvasHandle (an imperative ref), since the driver instance is
   * only created inside this component's own effect. */
  onRunningChange?: (isRunning: boolean) => void;

  /** Planning sketches (Falcon, 2026-09-03: "draw paths without
   * really needing node... give freedom to users to plan the paths")
   * — visual scratch lines, not real GraphModel edges, UNLESS/UNTIL
   * converted into one. Mutated directly like graph/floorLayout/
   * skinConfig, so adding or updating one doesn't need to re-run this
   * component's setup effect. */
  sketchLayer: SketchLayer;
  /** When true, the next drag on the canvas draws a new sketch instead
   * of doing anything else (armed by PathPalette, mirrors
   * placementKind/armedEdgeStyle's arm-then-act flow). Falcon,
   * 2026-09-05: either end now snaps onto a real port when the drag
   * starts or ends near one — see onCreateSketch below. */
  sketchArmed: boolean;
  /** See SketchStyle above. Defaults to 'single' at the call site
   * (App.tsx) so a project that predates this toggle keeps the old
   * one-drag behavior with no code changes needed. */
  sketchStyle: SketchStyle;
  /** Falcon, 2026-09-05: a sketch can pin either end to a real node's
   * port (fromAttachment/toAttachment, null/omitted for a floating
   * point) — App.tsx books the anchor in FloorLayout's shared
   * reservation pool so the sketch genuinely holds that port. */
  onCreateSketch: (
    points: Point[],
    segments: SketchSegment[],
    fromAttachment?: SketchAttachment | null,
    toAttachment?: SketchAttachment | null,
  ) => void;

  /** INSERT tab (Falcon, 2026-09-09): free-floating icon+label
   * annotations, dragged from the ribbon and dropped on the canvas —
   * pure UI scratch, no simulation meaning. Mutated directly like
   * sketchLayer (design doc §4.6's "single source of truth"
   * convention), so App.tsx never needs a move callback -- only
   * creation (a native HTML5 drag-and-drop, which App.tsx alone can
   * generate an id for) round-trips through a prop. */
  annotationLayer: AnnotationLayer;
  onDropAnnotation: (
    payload:
      | { kind: 'icon'; icon: AnnotationIconKind }
      | { kind: 'text' }
      | { kind: 'custom'; customIconId: string },
    worldPoint: Point,
  ) => void;
  /** Falcon, 2026-09-09 ("import svgs or images for user custom"):
   * shared, app-wide library a 'custom'-kind annotation's
   * `customIconId` looks up into — mutated directly like every other
   * store here, read fresh every render loop. */
  customIconLibrary: CustomIconLibrary;

  /** FBP014 (2026-09-05): while armed, an empty-canvas drag draws a
   * marquee (rubber-band select) instead of panning, and clicking a
   * node toggles it into/out of the current multi selection instead
   * of replacing it -- mirrors sketchArmed's arm-then-act flow, but
   * the "act" is building up onSelect's Selection rather than a
   * single one-shot mutation. Mutually exclusive with every other
   * arm state (App.tsx). Once a multi selection exists, dragging any
   * of its members moves the whole group together -- that part
   * works whether or not this is still armed. */
  multiSelectArmed: boolean;
  /** Which kind the armed Multi-select tool's marquee (and, for
   * 'nodes'/'all', click-to-toggle) is scoped to (Falcon, 2026-09-05:
   * "the multiselect is the selection base on the highlighted area or
   * selected area" -- every ribbon quick-select pick, including
   * "Select all", arms this tool rather than grabbing everything of
   * that kind project-wide; 'all' just means no kind restriction on
   * the box). A box that also crosses a node while this is 'paths',
   * say, simply ignores that node -- only the active kind(s) join
   * the selection. */
  quickSelectFilter: 'all' | 'nodes' | 'paths' | 'sketches';
  /** FBP016 (2026-09-06): the ribbon MODIFY group's Move/Rotate
   * tools -- replaces the old Pan tool's slot (Falcon: "remove the
   * redundant pan/hand on modify section" -- an empty-canvas drag
   * already pans for free without arming anything). While either is
   * armed AND the current selection is a single path or sketch, ANY
   * drag reshapes that selection's interior curve points (its two
   * true endpoints never move) instead of doing anything else --
   * regardless of what's under the cursor, same "arm a mode"
   * convention Pan had. A no-op drag (nothing valid selected yet)
   * falls through to ordinary click-to-select/pan below. */
  moveArmed: boolean;
  rotateArmed: boolean;

  /** Falcon, 2026-09-04: "settings on VIEW for workspace theme or
   * background color" -- which preset paints the canvas background +
   * grid lines. App.tsx owns the state (persisted per-project via
   * CanvasSettings.canvasBackground); defaults to 'white' if unset. */
  canvasBackground?: CanvasBackground;
  /** Live world-space cursor position for StatusBar's coordinate
   * readout -- reported on every hover move, null when the pointer
   * leaves the canvas. Purely a display feed; doesn't affect any
   * interaction logic below. */
  onCursorWorldPositionChange?: (point: Point | null) => void;
}

/** Imperative handle (App.tsx's Play/Pause button lives in the bottom
 * bar, outside this component, but the sim driver it controls is only
 * ever created inside FluxCanvas's own effect). */
export interface FluxCanvasHandle {
  toggleRunning: () => void;
}

const CLICK_MOVE_THRESHOLD_PX = 5;
const EDGE_HIT_TOLERANCE_PX = 12;
/** Screen-space radius (px, before dividing by camera.zoom) within
 * which a drag "snaps" onto a specific port dot — precise targeting
 * for new paths/sketches (Falcon, 2026-09-05). Kept in screen space
 * so the snap feels the same size at any zoom level. */
const PORT_SNAP_RADIUS_PX = 14;
/** Falcon, 2026-09-05 ("there is no way i can snap a sketch to a
 * node's port"): sketches get a more generous snap radius than
 * wires/style-drawn paths -- there's no live GraphModel edge at
 * stake if a sketch misses (PropertiesPanel's per-end "Pin" button
 * covers a miss anyway), so it's worth trading a little precision
 * for it being noticeably easier to actually land a snap while
 * sketching. */
const SKETCH_PORT_SNAP_RADIUS_PX = 22;
/** Falcon, 2026-09-09 (INSERT tab): screen-space click/drag radius
 * around an annotation's icon -- kept in screen space, like
 * PORT_SNAP_RADIUS_PX, so it feels the same size at any zoom level. */
const ANNOTATION_HIT_RADIUS_PX = 16;
/** World-space size an annotation's icon glyph renders at, before
 * camera.zoom scaling -- roughly matches a node's own icon size. */
const ANNOTATION_ICON_SIZE = 18;
/** Falcon, 2026-09-09 ("adding font size (to lock the sizing)"):
 * default WORLD-space point size for an annotation's text (its own
 * label, or a text box's whole content) when it hasn't set its own
 * fontSize -- multiplied by camera.zoom at render time, exactly like
 * NODE_RADIUS/ANNOTATION_ICON_SIZE, so text zooms consistently with
 * every other on-canvas size instead of staying a fixed screen pixel
 * size while the rest of the graph scales around it. */
const ANNOTATION_DEFAULT_FONT_SIZE = 14;
const ANNOTATION_DEFAULT_COLOR = '#1f2430';

/** Builds a canvas `font` string from an annotation's own formatting
 * (Falcon, 2026-09-09: "adding font size... font style, type
 * (bold,itallic)") at the given world-to-screen zoom -- the ONE place
 * that turns those fields into something ctx.font understands, so the
 * text-kind and icon-label render paths (and hit-testing, for the
 * matching size) can never drift out of sync with each other. */
function annotationFont(annotation: Annotation, zoom: number): string {
  const px = Math.max(4, (annotation.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) * zoom);
  const weight = annotation.bold ? '700' : '600';
  const style = annotation.italic ? 'italic ' : '';
  const family = annotation.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY;
  return `${style}${weight} ${px}px ${family}`;
}
/** Falcon, 2026-09-05 ("Click to place each point... double-click...
 * to finish the chain"): two clicks land inside this window (ms) AND
 * within CLICK_MOVE_THRESHOLD_PX*2 of each other to count as a
 * double-click that FINISHES a multi-segment sketch chain, instead of
 * committing a redundant extra waypoint on top of the last one.
 * Detected manually (not via the browser's native 'dblclick') so the
 * would-be-redundant second point never gets committed in the first
 * place. */
const SKETCH_DOUBLE_CLICK_MS = 400;
/** Endpoint-dot colors for a live wire/sketch drag preview (Falcon,
 * 2026-09-05: red at the fixed origin/outgoing end, green at the
 * moving head/incoming end). Previously shared with a per-node port-
 * dot coloring scheme that was tried and then reverted the same day —
 * this is now the only place these colors are used. */
const ANCHOR_ROLE_COLOR = { out: '#ff5d5d', in: '#2ecc71' };

/**
 * Milestone 4 (skin layer) + Milestone 5 (selection, node placement,
 * body-to-body wiring, drag-to-move, lock, delete, snap-to-grid —
 * design doc §9 step 5, minimal-chrome scope per FBP008's resolution)
 * wired into the canvas.
 *
 * Floor-layer geometry/camera (Milestone 2), the full node registry
 * (Milestone 3) and the skin render stack (Milestone 4) are unchanged
 * by this — this file only adds pointer INTERACTION on top of what
 * was already being painted.
 *
 * FBP014 (2026-09-05): the ribbon's MODIFY group's remaining three
 * placeholders -- Multi-select (marquee drag + click-to-toggle,
 * building a Selection {type:'multi'}), Duplicate (App.tsx-only, no
 * canvas interaction of its own), and Pan (forces every drag to pan
 * regardless of what's under the cursor) -- are real now. Once a
 * multi selection exists, dragging any of its members moves the
 * whole group together as one hard-blocked unit, whether or not the
 * multi-select tool is still armed.
 */
export const FluxCanvas = forwardRef<FluxCanvasHandle, FluxCanvasProps>(function FluxCanvas(
  {
    graph,
    floorLayout,
    skinConfig,
    objectRegistry,
    tickIntervalMs = 400,
    selection,
    onSelect,
    placementKind,
    onPlaceNode,
    onCreateEdge,
    onConnectionRejected,
    snapToGrid,
    gridSpacing,
    armedEdgeStyle,
    onApplyEdgeStyle,
    onRunningChange,
    sketchLayer,
    sketchArmed,
    sketchStyle,
    onCreateSketch,
    annotationLayer,
    onDropAnnotation,
    customIconLibrary,
    multiSelectArmed,
    quickSelectFilter,
    moveArmed,
    rotateArmed,
    canvasBackground = 'white',
    onCursorWorldPositionChange,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef<InterpolatedSimDriver | null>(null);

  // Interaction props change far more often than the sim/graph setup
  // (every click) — routing them through refs keeps them out of the
  // main effect's dependency array, so selecting something doesn't
  // tear down and recreate the SimEngine/driver.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const placementKindRef = useRef(placementKind);
  placementKindRef.current = placementKind;
  const onPlaceNodeRef = useRef(onPlaceNode);
  onPlaceNodeRef.current = onPlaceNode;
  const onCreateEdgeRef = useRef(onCreateEdge);
  onCreateEdgeRef.current = onCreateEdge;
  const onConnectionRejectedRef = useRef(onConnectionRejected);
  onConnectionRejectedRef.current = onConnectionRejected;
  const snapToGridRef = useRef(snapToGrid);
  snapToGridRef.current = snapToGrid;
  const gridSpacingRef = useRef(gridSpacing);
  gridSpacingRef.current = gridSpacing;
  const armedEdgeStyleRef = useRef(armedEdgeStyle);
  armedEdgeStyleRef.current = armedEdgeStyle;
  const onApplyEdgeStyleRef = useRef(onApplyEdgeStyle);
  onApplyEdgeStyleRef.current = onApplyEdgeStyle;
  const onRunningChangeRef = useRef(onRunningChange);
  onRunningChangeRef.current = onRunningChange;
  const sketchArmedRef = useRef(sketchArmed);
  sketchArmedRef.current = sketchArmed;
  const sketchStyleRef = useRef(sketchStyle);
  sketchStyleRef.current = sketchStyle;
  const onCreateSketchRef = useRef(onCreateSketch);
  onCreateSketchRef.current = onCreateSketch;
  const onDropAnnotationRef = useRef(onDropAnnotation);
  onDropAnnotationRef.current = onDropAnnotation;
  const multiSelectArmedRef = useRef(multiSelectArmed);
  multiSelectArmedRef.current = multiSelectArmed;
  const quickSelectFilterRef = useRef(quickSelectFilter);
  quickSelectFilterRef.current = quickSelectFilter;
  const moveArmedRef = useRef(moveArmed);
  moveArmedRef.current = moveArmed;
  const rotateArmedRef = useRef(rotateArmed);
  rotateArmedRef.current = rotateArmed;
  const canvasBackgroundRef = useRef(canvasBackground);
  canvasBackgroundRef.current = canvasBackground;
  const onCursorWorldPositionChangeRef = useRef(onCursorWorldPositionChange);
  onCursorWorldPositionChangeRef.current = onCursorWorldPositionChange;

  function toggleRunning(): void {
    const driver = driverRef.current;
    if (!driver) return;
    if (driver.isRunning()) {
      driver.pause();
    } else {
      driver.resume();
    }
    onRunningChangeRef.current?.(driver.isRunning());
  }

  // Exposes RUN/HOLD control to App.tsx's bottom-bar Play/Pause button
  // — recreated every render (no deps array) rather than memoized, so
  // it always calls the current toggleRunning closure; this handle is
  // called rarely (one click at a time), so there's no cost to skipping
  // memoization here.
  useImperativeHandle(ref, () => ({ toggleRunning }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const engine = new SimEngine(graph);
    const driver = new InterpolatedSimDriver(engine, tickIntervalMs);
    driverRef.current = driver;
    onRunningChangeRef.current?.(driver.isRunning());

    const camera = new Camera();
    const nodePositions = graph
      .getAllNodes()
      .map((n) => floorLayout.getNodePosition(n.id))
      .filter((p): p is { x: number; y: number } => p !== undefined);
    if (nodePositions.length > 0) {
      camera.x = nodePositions.reduce((sum, p) => sum + p.x, 0) / nodePositions.length;
      camera.y = nodePositions.reduce((sum, p) => sum + p.y, 0) / nodePositions.length;
    }

    let raf = 0;
    let lastFrameMs: number | null = null;
    // Falcon, 2026-09-09 ("import svgs or images for user custom"):
    // a custom icon's dataUrl needs an async Image load before it can
    // ever be drawImage'd -- cached by library entry id so a given
    // icon only ever loads once no matter how many annotations (or
    // render frames) reference it. Keyed by id, not by the annotation
    // itself, so renaming/re-importing under a new id naturally gets
    // its own fresh load.
    const customIconImageCache = new Map<string, HTMLImageElement>();
    function getCustomIconImage(id: string, dataUrl: string): HTMLImageElement {
      let img = customIconImageCache.get(id);
      if (!img) {
        img = new Image();
        img.src = dataUrl;
        customIconImageCache.set(id, img);
      }
      return img;
    }
    // Animation-only clock (belt scroll phase, circling item spin) —
    // deliberately separate from the sim driver's own clock and from
    // raw wall time: it only advances while the driver is actually
    // running, so RUN/HOLD freezes every visual, not just item
    // progress along the path.
    let animElapsedMs = 0;

    function currentViewport(): Viewport {
      return { width: canvas!.clientWidth, height: canvas!.clientHeight };
    }

    function toWorld(clientX: number, clientY: number): Point {
      const rect = canvas!.getBoundingClientRect();
      const screenPoint = { x: clientX - rect.left, y: clientY - rect.top };
      return camera.screenToWorld(screenPoint, currentViewport());
    }

    /** Rounds a world point to the nearest grid line when snap-to-grid
     * is on (App.tsx state, F8 shortcut); passes it through unchanged
     * otherwise. Shared by drag-to-move and node placement so both
     * respect the same toggle. */
    function snapToGridPoint(p: Point): Point {
      if (!snapToGridRef.current) return p;
      const spacing = gridSpacingRef.current;
      return {
        x: Math.round(p.x / spacing) * spacing,
        y: Math.round(p.y / spacing) * spacing,
      };
    }

    /** Every edge with `nodeId` as either endpoint — both directions,
     * since moving a node can bend an edge it's only the TARGET of
     * just as much as one it's the source of. GraphModel only indexes
     * outgoing edges (outputEdges), so this scans getAllEdges() —
     * fine at this graph size, and this is a per-drag-frame cost, not
     * a per-sim-tick one. */
    function edgesTouchingNode(nodeId: NodeId): EdgeDef[] {
      return graph.getAllEdges().filter((e) => e.source === nodeId || e.target === nodeId);
    }

    /** Topmost (highest z-order) node whose octagon body contains
     * `worldPoint`, or undefined. World-space hit-test — NODE_RADIUS
     * is the same un-scaled radius used to compute the screen radius
     * at render time (r = NODE_RADIUS * camera.zoom), so no
     * conversion is needed here. */
    function hitTestNode(worldPoint: Point): NodeId | undefined {
      const candidates = graph
        .getAllNodes()
        .map((n) => ({ n, pos: floorLayout.getNodePosition(n.id) }))
        .filter((e): e is { n: NodeDef; pos: Point } => e.pos !== undefined)
        .sort((a, b) => skinConfig.getNodeZIndex(b.n.id) - skinConfig.getNodeZIndex(a.n.id));
      for (const { n, pos } of candidates) {
        if (isPointInOctagon(worldPoint, octagonVertices(pos, NODE_RADIUS))) return n.id;
      }
      return undefined;
    }

    function hitTestEdge(worldPoint: Point): string | undefined {
      const toleranceWorld = EDGE_HIT_TOLERANCE_PX / camera.zoom;
      for (const edge of graph.getAllEdges()) {
        const curve = floorLayout.getEdgeCurve(edge.id);
        if (!curve || curve.totalLength === 0) continue;
        let minDist = Infinity;
        const samples = 40;
        for (let i = 0; i <= samples; i++) {
          const p = curve.getPointAtProgress(i / samples);
          const d = Math.hypot(p.x - worldPoint.x, p.y - worldPoint.y);
          if (d < minDist) minDist = d;
        }
        if (minDist <= toleranceWorld) return edge.id;
      }
      return undefined;
    }

    /** Falcon, 2026-09-05 ("l3 connected non linear paths"): every
     * segment -- straight (bow 0) or bowed -- is sampled the same way
     * a real edge's own curve already is (BezierPath), rather than
     * needing two separate code paths for straight vs curved. Also
     * returns WHICH segment was hit -- clicking a specific leg of an
     * already-selected multi-segment sketch drills into just that one
     * (see onPointerUp / PropertiesPanel). */
    function hitTestSketch(worldPoint: Point): { id: string; segmentIndex: number } | undefined {
      const toleranceWorld = EDGE_HIT_TOLERANCE_PX / camera.zoom;
      const samples = 24;
      for (const sketch of sketchLayer.getAll()) {
        for (let s = 0; s < sketch.segments.length; s++) {
          const curve = new BezierPath(curveBetween(sketch.points[s]!, sketch.points[s + 1]!, sketch.segments[s]!.bow));
          for (let i = 0; i <= samples; i++) {
            const p = curve.getPointAtProgress(i / samples);
            const dist = Math.hypot(p.x - worldPoint.x, p.y - worldPoint.y);
            if (dist <= toleranceWorld) return { id: sketch.id, segmentIndex: s };
          }
        }
      }
      return undefined;
    }

    /** Falcon, 2026-09-09 (INSERT tab): topmost annotation whose icon
     * is within ANNOTATION_HIT_RADIUS_PX of worldPoint -- reverse
     * iteration order so a more-recently-dropped annotation (drawn
     * last, reads as "on top") wins a click over an older one sitting
     * at nearly the same spot, same tie-break spirit as node z-order. */
    function hitTestAnnotation(worldPoint: Point): string | undefined {
      const all = annotationLayer.getAll();
      for (let i = all.length - 1; i >= 0; i--) {
        const a = all[i]!;
        // Falcon, 2026-09-09 ("insert textbox"): a text-kind
        // annotation has no fixed-size icon badge to click on -- a
        // rough width-from-character-count heuristic beats forcing
        // every click to land exactly on the icon-sized radius,
        // without needing a real text-measurement pass just to
        // hit-test (rendering below still measures for real, for the
        // selection outline).
        const fontScale = (a.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) / ANNOTATION_DEFAULT_FONT_SIZE;
        const radiusPx =
          a.kind === 'text'
            ? Math.max(ANNOTATION_HIT_RADIUS_PX, (a.label ?? 'Text').length * 3.4 * fontScale)
            : ANNOTATION_HIT_RADIUS_PX;
        const toleranceWorld = radiusPx / camera.zoom;
        if (Math.hypot(a.position.x - worldPoint.x, a.position.y - worldPoint.y) <= toleranceWorld) return a.id;
      }
      return undefined;
    }

    /** Closest point (within maxDistance) to `worldPoint` across
     * every existing real path AND every existing sketch's own line
     * -- visual-only alignment for a drawn sketch's loose end (Falcon,
     * 2026-09-05: "allow snapping paths ... to other paths"). Nothing
     * is attached or recorded here; it only ever changes where the
     * drag preview's head is DRAWN and what a committed sketch's
     * final coordinate is. Junctions/elevators (deferred) are what
     * would eventually make this a real structural connection. */
    function nearestPointOnAnyPath(worldPoint: Point, maxDistance: number): Point | undefined {
      let best: Point | undefined;
      let bestDist = maxDistance;

      for (const edge of graph.getAllEdges()) {
        const curve = floorLayout.getEdgeCurve(edge.id);
        if (!curve || curve.totalLength === 0) continue;
        const samples = 40;
        for (let i = 0; i <= samples; i++) {
          const p = curve.getPointAtProgress(i / samples);
          const d = Math.hypot(p.x - worldPoint.x, p.y - worldPoint.y);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        }
      }

      for (const sketch of sketchLayer.getAll()) {
        for (let s = 0; s < sketch.segments.length; s++) {
          const curve = new BezierPath(curveBetween(sketch.points[s]!, sketch.points[s + 1]!, sketch.segments[s]!.bow));
          if (curve.totalLength === 0) continue;
          const samples = 24;
          for (let i = 0; i <= samples; i++) {
            const p = curve.getPointAtProgress(i / samples);
            const d = Math.hypot(p.x - worldPoint.x, p.y - worldPoint.y);
            if (d < bestDist) {
              bestDist = d;
              best = p;
            }
          }
        }
      }

      return best;
    }

    /** Falcon, 2026-09-05 ("Escape" or losing focus): discards an
     * in-progress multi-segment sketch chain outright -- nothing gets
     * created. Also the shared "end of gesture" step finalize calls
     * into once it's done using whatever was committed. */
    function cancelSketchChain(): void {
      sketchChainPoints = [];
      sketchChainAttachments = [];
      sketchLastCommitScreen = undefined;
      pointerMode = 'idle';
      sketchDrawCurrent = undefined;
      hoveredAnchor = undefined;
      hoveredPathSnapPoint = undefined;
    }

    /** Falcon, 2026-09-05 ("double-click ... to finish the chain"):
     * turns whatever's been committed so far into a real sketch --
     * needs at least 2 points (1 segment) to actually create anything
     * (a lone first click with nothing after it just cancels, same as
     * pressing Escape). Every new segment starts straight (bow 0) --
     * arcing one in is a separate, later step (PropertiesPanel's
     * per-segment "Convert to arc"). */
    function finalizeSketchChain(): void {
      if (sketchChainPoints.length >= 2) {
        const segments: SketchSegment[] = sketchChainPoints.slice(1).map(() => ({ bow: 0 }));
        const fromAttachment = sketchChainAttachments[0] ?? null;
        const toAttachment = sketchChainAttachments[sketchChainAttachments.length - 1] ?? null;
        onCreateSketchRef.current([...sketchChainPoints], segments, fromAttachment, toAttachment);
      }
      cancelSketchChain();
    }

    /** Falcon, 2026-09-05: keeps a sketch endpoint pinned to a moved
     * node's port glued to its new position -- same spirit as
     * recomputeEdgeCurve for a real edge. Only ever touches
     * points[0]/points[last] (the two true ends this sketch can be
     * pinned at), never an interior waypoint. */
    function syncSketchEndpointsToNode(nodeId: NodeId): void {
      for (const sketch of sketchLayer.getAll()) {
        const points = [...sketch.points];
        let changed = false;
        if (sketch.fromAttachment && sketch.fromAttachment.nodeId === nodeId) {
          const pt = floorLayout.getAnchorPoint(nodeId, sketch.fromAttachment.anchorIndex);
          if (pt) {
            points[0] = pt;
            changed = true;
          }
        }
        if (sketch.toAttachment && sketch.toAttachment.nodeId === nodeId) {
          const pt = floorLayout.getAnchorPoint(nodeId, sketch.toAttachment.anchorIndex);
          if (pt) {
            points[points.length - 1] = pt;
            changed = true;
          }
        }
        if (changed) sketchLayer.update(sketch.id, { points });
      }
    }

    function resize(): void {
      const parent = canvas!.parentElement;
      const width = parent ? parent.clientWidth : window.innerWidth;
      const height = parent ? parent.clientHeight : window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function frame(nowMs: number): void {
      driver.update(nowMs);

      if (lastFrameMs !== null) {
        const frameDeltaMs = Math.max(0, nowMs - lastFrameMs);
        if (driver.isRunning()) animElapsedMs += frameDeltaMs;
      }
      lastFrameMs = nowMs;
      const elapsedMs = animElapsedMs;

      canvas!.style.cursor =
        placementKindRef.current || armedEdgeStyleRef.current || sketchArmedRef.current || multiSelectArmedRef.current
          ? 'crosshair'
          : pointerMode === 'move' || pointerMode === 'pan'
            ? 'grabbing'
            : wireFromNodeId
              ? 'crosshair'
              : 'grab';

      const viewport = currentViewport();
      ctx!.clearRect(0, 0, viewport.width, viewport.height);
      const canvasTheme = CANVAS_THEMES[canvasBackgroundRef.current];
      ctx!.fillStyle = canvasTheme.background;
      ctx!.fillRect(0, 0, viewport.width, viewport.height);

      drawGrid(ctx!, camera, viewport, gridSpacingRef.current, canvasTheme.grid);

      // Culling: only draw entities whose position intersects the
      // visible world rect (design doc §3 — virtualization).
      const bounds = camera.getVisibleWorldBounds(viewport, NODE_RADIUS * 4);
      const sel = selectionRef.current;

      // Falcon, 2026-09-05: if the sketch tool got disarmed by some
      // other means (switching tools, F8, etc.) while a multi-segment
      // chain was mid-flight, abandon it here rather than leaving a
      // stale chain that would otherwise resume on the next armed
      // click as if nothing happened.
      if (!sketchArmedRef.current && sketchChainPoints.length > 0) {
        sketchChainPoints = [];
        sketchChainAttachments = [];
        sketchLastCommitScreen = undefined;
      }
      if (sketchStyleRef.current !== lastSketchStyle) {
        lastSketchStyle = sketchStyleRef.current;
        if (sketchChainPoints.length > 0) {
          sketchChainPoints = [];
          sketchChainAttachments = [];
          sketchLastCommitScreen = undefined;
        }
      }

      // --- Planning sketches (Falcon, 2026-09-03) — drawn first, so
      // real nodes/paths always read on top of a draft guide. Purely
      // visual: dashed, muted, no simulation meaning at all. ---
      for (const sketch of sketchLayer.getAll()) {
        const isSketchSelected =
          (sel?.type === 'sketch' && sel.id === sketch.id) ||
          (sel?.type === 'multi' && sel.sketchIds.includes(sketch.id));
        const selectedSegmentIndex = sel?.type === 'sketch' && sel.id === sketch.id ? sel.segmentIndex : undefined;

        // Falcon, 2026-09-05 ("l3 connected non linear paths ... then
        // the middle path was converted to arc/curve path"): every
        // segment draws through curveBetween/bezierCurveTo whether
        // it's straight or bowed -- a bow of 0 degenerates to a
        // visually straight line, so there's no need for two separate
        // draw paths.
        for (let s = 0; s < sketch.segments.length; s++) {
          const from = sketch.points[s]!;
          const to = sketch.points[s + 1]!;
          const bezier = curveBetween(from, to, sketch.segments[s]!.bow);
          const isSegmentSelected = selectedSegmentIndex === s;
          const a = camera.worldToScreen(bezier.p0, viewport);
          const p1 = camera.worldToScreen(bezier.p1, viewport);
          const p2 = camera.worldToScreen(bezier.p2, viewport);
          const b = camera.worldToScreen(bezier.p3, viewport);
          ctx!.save();
          ctx!.setLineDash([7, 5]);
          ctx!.strokeStyle = isSegmentSelected
            ? 'rgba(245, 158, 11, 0.95)'
            : isSketchSelected
              ? 'rgba(124, 58, 237, 0.9)'
              : 'rgba(124, 58, 237, 0.45)';
          ctx!.lineWidth = isSegmentSelected
            ? Math.max(2.5, 3.5 * camera.zoom)
            : isSketchSelected
              ? Math.max(2, 3 * camera.zoom)
              : Math.max(1.5, 2 * camera.zoom);
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, b.x, b.y);
          ctx!.stroke();
          ctx!.restore();
          // A direction arrow reads clearly on a straight leg; a
          // curved leg's own arrow is deferred (Falcon, 2026-09-05:
          // "just the curve alone for now", same scope boundary as
          // tangent continuity).
          if (sketch.segments[s]!.bow === 0) drawStraightDirectionArrow(ctx!, from, to, camera, viewport);
        }
        // Falcon, 2026-09-05 ("there is no way i can snap a sketch to
        // a node's port"): a pinned end used to draw NOTHING of its
        // own -- it just happened to sit on top of the node's own
        // (always-drawn, tiny) port dot, which reads identically to
        // "close but not actually attached". Loose ends still get the
        // same hollow ring as before; pinned ends now get an
        // unmistakably different solid green ring right on top of
        // that port, so the two states are never confused for one
        // another again. Only the TRUE first/last waypoint is a real
        // "end"; interior points are plain shape joints and never
        // attachable.
        if (sketch.fromAttachment) {
          drawPinnedEndpointMarker(ctx!, sketch.points[0]!, camera, viewport);
        } else {
          drawLooseEndpointMarker(ctx!, sketch.points[0]!, camera, viewport);
        }
        if (sketch.toAttachment) {
          drawPinnedEndpointMarker(ctx!, sketch.points[sketch.points.length - 1]!, camera, viewport);
        } else {
          drawLooseEndpointMarker(ctx!, sketch.points[sketch.points.length - 1]!, camera, viewport);
        }
      }
      if (pointerMode === 'sketch-draw' && sketchChainPoints.length > 0 && sketchDrawCurrent) {
        // Falcon, 2026-09-05 ("l3 connected non linear paths"): a
        // multi-segment chain is built one click at a time -- this
        // draws every already-committed waypoint as a solid run PLUS
        // one more live segment out to wherever the NEXT click would
        // land, so the whole in-progress shape (not just its last
        // leg) stays visible between clicks.
        const headWorld =
          hoveredAnchor && !hoveredAnchor.occupied
            ? hoveredAnchor.point
            : (hoveredPathSnapPoint ?? sketchDrawCurrent);
        const chainStart = sketchChainPoints[0]!;
        const a = camera.worldToScreen(chainStart, viewport);
        ctx!.save();
        ctx!.setLineDash([7, 5]);
        ctx!.strokeStyle = 'rgba(124, 58, 237, 0.7)';
        ctx!.lineWidth = Math.max(1.5, 2 * camera.zoom);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        for (let i = 1; i < sketchChainPoints.length; i++) {
          const p = camera.worldToScreen(sketchChainPoints[i]!, viewport);
          ctx!.lineTo(p.x, p.y);
        }
        const headScreen = camera.worldToScreen(headWorld, viewport);
        ctx!.lineTo(headScreen.x, headScreen.y);
        ctx!.stroke();
        ctx!.restore();
        const b = headScreen;
        if (sketchChainAttachments[0]) {
          drawAnchorRing(ctx!, a, camera.zoom, 'rgba(124, 58, 237, 0.9)');
        }
        // Falcon, 2026-09-05: "the path should also have green and
        // red at the end when drawing mode or sketch mode was
        // activated" -- the fixed origin (where the drag STARTED) is
        // always the outgoing end, red; the moving head (where it
        // would attach if released now) is always the incoming end,
        // green -- independent of whether anything is actually under
        // the cursor yet.
        drawEndpointDot(ctx!, a, camera.zoom, ANCHOR_ROLE_COLOR.out);
        drawEndpointDot(ctx!, b, camera.zoom, ANCHOR_ROLE_COLOR.in);
      }
      if ((pointerMode === 'wire' || pointerMode === 'style-wire' || pointerMode === 'sketch-draw') && hoveredAnchor) {
        const screenPt = camera.worldToScreen(hoveredAnchor.point, viewport);
        drawAnchorRing(
          ctx!,
          screenPt,
          camera.zoom,
          hoveredAnchor.occupied ? 'rgba(255, 93, 93, 0.9)' : 'rgba(46, 204, 113, 0.9)',
        );
      }
      // Falcon, 2026-09-05: "allow snapping paths ... to other paths"
      // -- visual alignment only for now (no junction exists yet to
      // actually attach to), shown only when no port dot is already
      // being targeted so the two hints never compete for the same
      // spot.
      if (pointerMode === 'sketch-draw' && !hoveredAnchor && hoveredPathSnapPoint) {
        drawPathSnapMarker(ctx!, camera.worldToScreen(hoveredPathSnapPoint, viewport), camera.zoom);
      }

      // --- Three-pass path render stack (design doc §5.2) ---
      const edges = graph.getAllEdges();
      for (const edge of edges) {
        const curve = floorLayout.getEdgeCurve(edge.id);
        if (!curve) continue;
        const skin = skinConfig.getEdgeSkin(edge.id);
        const beltPhase = (elapsedMs / 1000) * edge.flowRate * curve.totalLength;
        drawPathUnder(ctx!, curve, camera, viewport, skin, beltPhase);
      }

      for (const renderItem of driver.getRenderItems()) {
        const curve = floorLayout.getEdgeCurve(renderItem.edgeId);
        if (!curve) continue;
        const worldPoint = curve.getPointAtProgress(renderItem.progress);
        if (
          worldPoint.x < bounds.minX ||
          worldPoint.x > bounds.maxX ||
          worldPoint.y < bounds.minY ||
          worldPoint.y > bounds.maxY
        ) {
          continue;
        }
        const skin = skinConfig.getEdgeSkin(renderItem.edgeId);
        const rotation = getItemRotation(skin.itemOrientation, curve, renderItem.progress, elapsedMs, skin.spinSpeed);
        const screen = camera.worldToScreen(worldPoint, viewport);
        const objectType = objectRegistry.resolve(renderItem.type);
        drawItemToken(
          ctx!,
          screen,
          objectType.size * camera.zoom,
          rotation,
          objectType.color,
          darkenHex(objectType.color, 0.32),
          objectType.shape,
        );
      }

      for (const edge of edges) {
        const curve = floorLayout.getEdgeCurve(edge.id);
        if (!curve) continue;
        const skin = skinConfig.getEdgeSkin(edge.id);
        drawPathOver(ctx!, curve, camera, viewport, skin);
        drawPathDirectionArrow(ctx!, curve, camera, viewport);
        if (
          (sel?.type === 'edge' && sel.id === edge.id) ||
          (sel?.type === 'multi' && sel.edgeIds.includes(edge.id))
        ) {
          drawCurveSelectionHighlight(ctx!, curve, camera, viewport);
        }
      }

      // Style-wire drag line when the origin is FLOATING (Falcon,
      // 2026-09-05: permissive start, mirroring sketch-draw) -- the
      // pinned-origin case is handled by the wireFromNodeId block
      // right below via a node-position lookup, which a floating
      // origin has no node to look up.
      if (pointerMode === 'style-wire' && !wireFromNodeId && styleDrawOrigin && wireCurrentWorld) {
        const headWorld = hoveredAnchor && !hoveredAnchor.occupied ? hoveredAnchor.point : wireCurrentWorld;
        const a = camera.worldToScreen(styleDrawOrigin, viewport);
        const b = camera.worldToScreen(headWorld, viewport);
        ctx!.save();
        ctx!.setLineDash([6, 4]);
        ctx!.strokeStyle = 'rgba(37, 99, 235, 0.7)';
        ctx!.lineWidth = Math.max(1.5, 2 * camera.zoom);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
        ctx!.restore();
        drawEndpointDot(ctx!, a, camera.zoom, ANCHOR_ROLE_COLOR.out);
        drawEndpointDot(ctx!, b, camera.zoom, ANCHOR_ROLE_COLOR.in);
      }

      // Live wire-drag line, drawn under the nodes so the node bodies
      // still read clearly on top of it.
      if (wireFromNodeId && wireCurrentWorld) {
        const fromPos = floorLayout.getNodePosition(wireFromNodeId);
        if (fromPos) {
          const headWorld =
            hoveredAnchor && !hoveredAnchor.occupied && hoveredAnchor.nodeId !== wireFromNodeId
              ? hoveredAnchor.point
              : wireCurrentWorld;
          const a = camera.worldToScreen(fromPos, viewport);
          const b = camera.worldToScreen(headWorld, viewport);
          ctx!.save();
          ctx!.setLineDash([6, 4]);
          ctx!.strokeStyle = 'rgba(37, 99, 235, 0.7)';
          ctx!.lineWidth = Math.max(1.5, 2 * camera.zoom);
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
          ctx!.restore();
          if (wireFromAnchorIndex !== undefined) {
            const sourceAnchorPoint = floorLayout.getAnchorPoint(wireFromNodeId, wireFromAnchorIndex);
            if (sourceAnchorPoint) {
              drawAnchorRing(ctx!, camera.worldToScreen(sourceAnchorPoint, viewport), camera.zoom, 'rgba(37, 99, 235, 0.9)');
            }
          }
          drawEndpointDot(ctx!, a, camera.zoom, ANCHOR_ROLE_COLOR.out);
          drawEndpointDot(ctx!, b, camera.zoom, ANCHOR_ROLE_COLOR.in);
        }
      }

      // --- Nodes: octagon body + icon + badge, sorted by skin-owned
      // z-order (design doc §4.1, §4.5) so higher zIndex paints last. ---
      const visibleNodes: { node: NodeDef; pos: Point }[] = [];
      for (const node of graph.getAllNodes()) {
        const pos = floorLayout.getNodePosition(node.id);
        if (!pos) continue;
        if (pos.x < bounds.minX || pos.x > bounds.maxX || pos.y < bounds.minY || pos.y > bounds.maxY) continue;
        visibleNodes.push({ node, pos });
      }
      visibleNodes.sort((a, b) => skinConfig.getNodeZIndex(a.node.id) - skinConfig.getNodeZIndex(b.node.id));

      // FBP014 (2026-09-05): marquee bounds computed once per frame
      // (world space) so every node's live-preview ring below is a
      // cheap containment check, not a re-derivation.
      const marqueeBounds =
        pointerMode === 'marquee' && marqueeOrigin && marqueeCurrent
          ? {
              minX: Math.min(marqueeOrigin.x, marqueeCurrent.x),
              maxX: Math.max(marqueeOrigin.x, marqueeCurrent.x),
              minY: Math.min(marqueeOrigin.y, marqueeCurrent.y),
              maxY: Math.max(marqueeOrigin.y, marqueeCurrent.y),
            }
          : null;

      for (const { node, pos } of visibleNodes) {
        const screen = camera.worldToScreen(pos, viewport);
        const r = NODE_RADIUS * camera.zoom;
        const state = engine.getNodeState(node.id) ?? {};
        drawNode(ctx!, node, state, screen, r, camera.zoom);
        if (skinConfig.getNodeLocked(node.id)) {
          drawNodeLockBadge(ctx!, screen, r, camera.zoom);
        }
        const inMarquee =
          !!marqueeBounds &&
          pos.x >= marqueeBounds.minX &&
          pos.x <= marqueeBounds.maxX &&
          pos.y >= marqueeBounds.minY &&
          pos.y <= marqueeBounds.maxY;
        const isMultiSelected = sel?.type === 'multi' && sel.nodeIds.includes(node.id);
        if ((sel?.type === 'node' && sel.id === node.id) || isMultiSelected || inMarquee) {
          drawNodeSelectionRing(ctx!, screen, r, camera.zoom);
        }
      }

      // --- Annotations (INSERT tab, Falcon 2026-09-09): free-
      // floating icon+label markers, no simulation meaning -- drawn
      // on top of nodes/paths/sketches so they always read clearly. ---
      for (const annotation of annotationLayer.getAll()) {
        const screen = camera.worldToScreen(annotation.position, viewport);
        const isSelected = sel?.type === 'annotation' && sel.id === annotation.id;

        if (annotation.kind === 'text') {
          // Falcon, 2026-09-09 ("insert textbox"): plain text, no
          // glyph/badge at all -- an empty one still renders a faint
          // "Text" placeholder so a freshly-dropped box is findable
          // and clickable before anything's been typed into it.
          const hasLabel = !!annotation.label;
          const text = hasLabel ? annotation.label! : 'Text';
          ctx!.save();
          ctx!.font = annotationFont(annotation, camera.zoom);
          ctx!.textAlign = 'center';
          ctx!.textBaseline = 'middle';
          ctx!.fillStyle = hasLabel ? (annotation.color ?? ANNOTATION_DEFAULT_COLOR) : 'rgba(31, 36, 48, 0.4)';
          ctx!.fillText(text, screen.x, screen.y);
          if (isSelected) {
            const metrics = ctx!.measureText(text);
            const w = metrics.width + 14;
            const h = 22;
            ctx!.setLineDash([4, 3]);
            ctx!.strokeStyle = 'rgba(37, 99, 235, 0.85)';
            ctx!.lineWidth = 1.5;
            ctx!.strokeRect(screen.x - w / 2, screen.y - h / 2, w, h);
          }
          ctx!.restore();
          continue;
        }

        if (annotation.kind === 'custom') {
          const entry = annotation.customIconId ? customIconLibrary.get(annotation.customIconId) : undefined;
          const r = ANNOTATION_ICON_SIZE * camera.zoom * 0.5;
          ctx!.save();
          if (entry) {
            const img = getCustomIconImage(entry.id, entry.dataUrl);
            if (img.complete && img.naturalWidth > 0) {
              // Fit the image inside the same circular footprint an
              // icon annotation uses, preserving aspect ratio rather
              // than stretching a non-square import to a square.
              const aspect = img.naturalWidth / img.naturalHeight;
              const boxSize = r * 1.6;
              const w = aspect >= 1 ? boxSize : boxSize * aspect;
              const h = aspect >= 1 ? boxSize / aspect : boxSize;
              ctx!.drawImage(img, screen.x - w / 2, screen.y - h / 2, w, h);
            } else {
              // Still loading -- a faint placeholder ring so the drop
              // isn't invisible for the one/two frames before the
              // Image finishes decoding.
              ctx!.beginPath();
              ctx!.arc(screen.x, screen.y, r, 0, Math.PI * 2);
              ctx!.strokeStyle = 'rgba(31, 36, 48, 0.25)';
              ctx!.lineWidth = 1.5;
              ctx!.stroke();
            }
          } else {
            // Falcon, 2026-09-09: the referenced library entry is
            // gone (deleted from the shared library, possibly by a
            // different project) -- never silently vanish, same
            // spirit as ObjectRegistry.resolve()'s fallback.
            ctx!.beginPath();
            ctx!.arc(screen.x, screen.y, r, 0, Math.PI * 2);
            ctx!.setLineDash([3, 3]);
            ctx!.strokeStyle = 'rgba(200, 60, 60, 0.7)';
            ctx!.lineWidth = 1.5;
            ctx!.stroke();
            ctx!.setLineDash([]);
            ctx!.font = `700 ${Math.max(9, r)}px system-ui, sans-serif`;
            ctx!.textAlign = 'center';
            ctx!.textBaseline = 'middle';
            ctx!.fillStyle = 'rgba(200, 60, 60, 0.85)';
            ctx!.fillText('?', screen.x, screen.y);
          }
          if (isSelected) {
            ctx!.beginPath();
            ctx!.arc(screen.x, screen.y, r + 4, 0, Math.PI * 2);
            ctx!.strokeStyle = 'rgba(37, 99, 235, 0.85)';
            ctx!.lineWidth = 2;
            ctx!.stroke();
          }
          if (annotation.label) {
            ctx!.font = annotationFont(annotation, camera.zoom);
            ctx!.textAlign = 'center';
            ctx!.textBaseline = 'top';
            const labelY = screen.y + r + 4;
            const metrics = ctx!.measureText(annotation.label);
            const padX = 4;
            const padY = 2;
            const lineH = (annotation.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) * camera.zoom + padY * 2;
            ctx!.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx!.fillRect(screen.x - metrics.width / 2 - padX, labelY - 1, metrics.width + padX * 2, lineH);
            ctx!.fillStyle = annotation.color ?? ANNOTATION_DEFAULT_COLOR;
            ctx!.fillText(annotation.label, screen.x, labelY);
          }
          ctx!.restore();
          continue;
        }

        const icon = annotation.icon ?? 'marker';
        const r = ANNOTATION_ICON_SIZE * camera.zoom * 0.5;
        ctx!.save();
        ctx!.beginPath();
        ctx!.arc(screen.x, screen.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = '#ffffff';
        ctx!.fill();
        ctx!.strokeStyle = ANNOTATION_ICON_COLOR[icon];
        ctx!.lineWidth = isSelected ? 2.5 : 1.5;
        ctx!.stroke();
        ctx!.fillStyle = ANNOTATION_ICON_COLOR[icon];
        ctx!.strokeStyle = ANNOTATION_ICON_COLOR[icon];
        annotationIcons[icon](ctx!, screen.x, screen.y, r * 1.5);
        if (isSelected) {
          ctx!.beginPath();
          ctx!.arc(screen.x, screen.y, r + 4, 0, Math.PI * 2);
          ctx!.strokeStyle = 'rgba(37, 99, 235, 0.85)';
          ctx!.lineWidth = 2;
          ctx!.stroke();
        }
        if (annotation.label) {
          ctx!.font = annotationFont(annotation, camera.zoom);
          ctx!.textAlign = 'center';
          ctx!.textBaseline = 'top';
          const labelY = screen.y + r + 4;
          const metrics = ctx!.measureText(annotation.label);
          const padX = 4;
          const padY = 2;
          const lineH = (annotation.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) * camera.zoom + padY * 2;
          ctx!.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx!.fillRect(screen.x - metrics.width / 2 - padX, labelY - 1, metrics.width + padX * 2, lineH);
          ctx!.fillStyle = annotation.color ?? ANNOTATION_DEFAULT_COLOR;
          ctx!.fillText(annotation.label, screen.x, labelY);
        }
        ctx!.restore();
      }

      // FBP014 (2026-09-05): the marquee rectangle itself, drawn last
      // so it reads on top of everything while the drag is live.
      if (marqueeOrigin && marqueeCurrent) {
        const a = camera.worldToScreen(marqueeOrigin, viewport);
        const b = camera.worldToScreen(marqueeCurrent, viewport);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx!.save();
        ctx!.fillStyle = 'rgba(37, 99, 235, 0.12)';
        ctx!.strokeStyle = 'rgba(37, 99, 235, 0.85)';
        ctx!.lineWidth = 1.5;
        ctx!.setLineDash([5, 4]);
        ctx!.fillRect(x, y, w, h);
        ctx!.strokeRect(x, y, w, h);
        ctx!.restore();
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // --- Pointer interaction state machine ---
    // A click (movement under the threshold) selects/deselects or
    // places a node. From a node's body: a plain drag MOVES the node
    // (a no-op if it's locked); Shift+drag instead drags out a new
    // edge, same as Milestone 5. From empty space, a drag pans the
    // camera.
    type PointerMode =
      | 'idle'
      | 'pan'
      | 'node-down'
      | 'edge-down'
      | 'sketch-down'
      | 'sketch-move'
      | 'annotation-down'
      | 'annotation-move'
      | 'wire'
      | 'style-wire'
      | 'move'
      | 'placement'
      | 'sketch-draw'
      | 'marquee'
      | 'reshape';
    let pointerMode: PointerMode = 'idle';
    let dragOriginScreen: { x: number; y: number } | null = null;
    let dragLastScreen: { x: number; y: number } | null = null;
    let pendingNodeHitId: NodeId | undefined;
    let pendingEdgeHitId: string | undefined;
    let pendingSketchHitId: string | undefined;
    // Falcon, 2026-09-09 (INSERT tab): the annotation under an
    // 'annotation-down'/'annotation-move' drag, and the point it
    // started at -- same single-delta-from-original convention as
    // sketchMoveOriginalPoints/-OriginWorld just below, so a whole
    // drag never compounds tiny per-frame rounding.
    let pendingAnnotationHitId: string | undefined;
    let annotationMoveOriginalPosition: Point | undefined;
    let annotationMoveOriginWorld: Point | undefined;
    // Falcon, 2026-09-05 ("click directly on that segment"): which
    // leg of pendingSketchHitId the press actually landed on, if it
    // turns into a drill-down click (see onPointerUp).
    let pendingSketchSegmentIndex: number | undefined;
    // Falcon, 2026-09-05 ("the sketch cannot be moved like its locked
    // on a position" -> chose "pinned" for the follow-up: a pinned
    // end is locked in by design, move the node instead): whole-
    // sketch drag-to-move, but only ever offered when NEITHER end is
    // attached -- computed once at grab time (pendingSketchCanMove),
    // then acted on in onPointerMove once the drag clears the click
    // threshold. sketchMoveOriginalPoints/-OriginWorld snapshot the
    // shape and the press position the instant that transition
    // happens, so the whole drag is a single delta applied to the
    // ORIGINAL points every frame (not compounding tiny per-frame
    // deltas, which would drift under rounding).
    let pendingSketchCanMove = false;
    let sketchMoveOriginalPoints: Point[] | undefined;
    let sketchMoveOriginWorld: Point | undefined;
    let wireFromNodeId: NodeId | undefined;
    let wireCurrentWorld: Point | undefined;
    // Precise port targeting (Falcon, 2026-09-05): the exact dot a
    // wire/sketch drag started or is currently hovering, if any.
    let wireFromAnchorIndex: number | undefined;
    let hoveredAnchor: AnchorHit | undefined;
    // Falcon, 2026-09-05 ("why i still cant draw other paths like how
    // the sketch get drawn?"): the style-wire drag's fixed start
    // point, set on every armed-style pointerdown regardless of
    // whether it landed on a real port -- a style-drawn path can
    // start floating too and fall back to becoming a sketch (see
    // onPointerUp).
    let styleDrawOrigin: Point | undefined;
    let sketchDrawCurrent: Point | undefined;
    // Falcon, 2026-09-05 ("l3 connected non linear paths (sketched)"):
    // a multi-segment sketch chain's committed waypoints so far, plus
    // which (if any) real port each is pinned to -- only ever
    // meaningful at index 0 and the LAST index, since every interior
    // point is a plain shape waypoint. Persists ACROSS pointerdown/up
    // cycles while a chain is being built (see onPointerUp's
    // stayingInChain check) -- unlike every other pointer mode's
    // state, this one isn't reset at the end of a single down/up.
    let sketchChainPoints: Point[] = [];
    let sketchChainAttachments: (SketchAttachment | null)[] = [];
    let sketchLastCommitScreen: { x: number; y: number } | undefined;
    let sketchLastCommitTime = 0;
    // Falcon, 2026-09-05: if the Sketch-style dropdown gets
    // switched away from 'polypath' mid-chain (armed the whole
    // time, so the disarm-abandon check below doesn't fire),
    // abandon the stale chain too rather than leaving orphaned
    // points a later 'single' drag would silently inherit.
    let lastSketchStyle: SketchStyle = sketchStyleRef.current;
    // Path-to-path visual snap (Falcon, 2026-09-05: "allow snapping
    // paths ... to other paths") -- alignment only, no attachment
    // recorded; only ever set when no port dot is already hovered.
    let hoveredPathSnapPoint: Point | undefined;
    // Latched at pointerdown (not re-read live) so a gesture commits
    // to one interpretation for its whole drag, rather than switching
    // mid-drag if a modifier key state changes.
    let wireGesture = false;
    let moveLocked = false;
    // Offset from the node's own position to the point the user
    // actually grabbed it at, so the node doesn't jump to re-center
    // under the cursor the instant a drag starts.
    let moveGrabOffset: Point | null = null;
    // Multi-select tool (FBP014, 2026-09-05): a rubber-band drag on
    // empty canvas while armed -- world-space origin/current corner,
    // both undefined outside a marquee drag.
    let marqueeOrigin: Point | undefined;
    let marqueeCurrent: Point | undefined;
    // Set at the 'node-down' -> 'move' transition when the grabbed
    // node belongs to an active multi selection with 2+ members --
    // every member then translates by the same delta the grabbed one
    // does, hard-blocked as a whole (never partially applied) exactly
    // like a single node hitting wouldOverlap.
    let groupMoveActive = false;
    let groupOriginalPositions: Map<NodeId, Point> | null = null;
    // FBP016 (2026-09-06): Move/Rotate's own drag state -- which
    // selection is being reshaped, its ORIGINAL interior points and
    // fixed center (both captured once at pointerdown so every frame
    // recomputes from the same starting shape rather than compounding
    // per-frame deltas, same anti-drift convention group-move/sketch-
    // move already use), and (rotate only) the pointer's starting
    // angle around that center.
    let reshapeKind: 'edge' | 'sketch' | undefined;
    let reshapeId: string | undefined;
    let reshapeTool: 'move' | 'rotate' | undefined;
    let reshapeOriginalPoints: Point[] | undefined;
    let reshapeCenter: Point | undefined;
    let reshapeOriginWorld: Point | undefined;
    let reshapeStartAngle = 0;

    function onPointerDown(e: PointerEvent): void {
      dragOriginScreen = { x: e.clientX, y: e.clientY };
      dragLastScreen = { x: e.clientX, y: e.clientY };
      canvas!.setPointerCapture(e.pointerId);

      const worldPoint = toWorld(e.clientX, e.clientY);

      // FBP016 (2026-09-06): Move/Rotate override every hit test --
      // a drag starting anywhere reshapes the CURRENT SELECTION (if
      // it's a single path or sketch) instead of grabbing whatever's
      // under the cursor, same "arm a mode" convention Pan used to
      // have this slot for. Falls through to ordinary hit-testing
      // below when nothing valid is selected yet, so the user can
      // still click a path/sketch to select it first.
      if (moveArmedRef.current || rotateArmedRef.current) {
        const sel = selectionRef.current;
        let originalPoints: Point[] | undefined;
        let allPointsForCenter: Point[] | undefined;
        let kind: 'edge' | 'sketch' | undefined;
        let id: string | undefined;
        if (sel?.type === 'edge') {
          const ends = floorLayout.getEdgeEndpoints(sel.id);
          if (ends) {
            originalPoints = floorLayout.getEdgeReshapePoints(sel.id);
            allPointsForCenter = [ends.from, ends.to, ...originalPoints];
            kind = 'edge';
            id = sel.id;
          }
        } else if (sel?.type === 'sketch') {
          const sketch = sketchLayer.get(sel.id);
          if (sketch) {
            originalPoints = getSketchReshapePoints(sketch);
            allPointsForCenter = sketch.points;
            kind = 'sketch';
            id = sel.id;
          }
        }
        if (originalPoints && allPointsForCenter && kind && id) {
          pointerMode = 'reshape';
          reshapeKind = kind;
          reshapeId = id;
          reshapeTool = moveArmedRef.current ? 'move' : 'rotate';
          reshapeOriginalPoints = originalPoints;
          reshapeCenter = shapeCenter(allPointsForCenter);
          reshapeOriginWorld = worldPoint;
          reshapeStartAngle = Math.atan2(worldPoint.y - reshapeCenter.y, worldPoint.x - reshapeCenter.x);
          return;
        }
      }

      if (placementKindRef.current) {
        pointerMode = 'placement';
        return;
      }

      if (armedEdgeStyleRef.current) {
        // Falcon, 2026-09-05: "I want to draw the selected path
        // directly ... no need to draw or sketch first in order to
        // convert it later", then "why i still cant draw other paths
        // like how the sketch get drawn?" -- this now mirrors sketch-
        // draw's own permissiveness exactly: ANY drag start is
        // accepted, snapping onto a free port if it begins right on
        // one, else starting from a plain floating point. A
        // stationary click still restyles whatever existing edge is
        // under the cursor at release, same as before -- see
        // onPointerUp, which now decides between restyle / new edge /
        // sketch-fallback all under this one 'style-wire' mode.
        pointerMode = 'style-wire';
        const anchorHit = floorLayout.findNearestAnchor(worldPoint, PORT_SNAP_RADIUS_PX / camera.zoom);
        if (anchorHit && !anchorHit.occupied) {
          wireFromNodeId = anchorHit.nodeId;
          wireFromAnchorIndex = anchorHit.anchorIndex;
          styleDrawOrigin = anchorHit.point;
        } else {
          wireFromNodeId = undefined;
          wireFromAnchorIndex = undefined;
          styleDrawOrigin = worldPoint;
        }
        return;
      }

      if (sketchArmedRef.current) {
        pointerMode = 'sketch-draw';
        if (sketchStyleRef.current === 'single') {
          // Falcon, 2026-09-05 ("no way to end the continuous lines"
          // -> "single path" style): the original one-drag-one-segment
          // gesture -- the origin is captured right here on press
          // (snapping onto a free port if the drag starts right on
          // one), and release commits the far end and finalizes
          // immediately (see onPointerUp) instead of waiting for a
          // second click.
          const anchorHit = floorLayout.findNearestAnchor(worldPoint, SKETCH_PORT_SNAP_RADIUS_PX / camera.zoom);
          const originAttachment: SketchAttachment | null =
            anchorHit && !anchorHit.occupied
              ? { nodeId: anchorHit.nodeId, anchorIndex: anchorHit.anchorIndex }
              : null;
          sketchChainPoints = [anchorHit && !anchorHit.occupied ? anchorHit.point : worldPoint];
          sketchChainAttachments = [originAttachment];
        }
        // 'polypath' ("l3 connected non linear paths (sketched) ...
        // Click to place each point"): a chain is built entirely from
        // clicks (see onPointerUp), not one continuous drag, so
        // pointerdown itself doesn't need to compute or commit
        // anything here -- it just keeps this gesture alive long
        // enough for onPointerUp to tell a click from a drag and
        // commit wherever the release lands.
        return;
      }

      const nodeId = hitTestNode(worldPoint);
      if (nodeId) {
        pointerMode = 'node-down';
        pendingNodeHitId = nodeId;
        // FBP014 (2026-09-05): while the multi-select tool is armed,
        // a plain click/drag on a node is a selection action (toggle
        // membership, or drag the group it already belongs to), never
        // a wire drag -- Shift has no meaning in this mode.
        wireGesture = !multiSelectArmedRef.current && e.shiftKey;
        moveLocked = skinConfig.getNodeLocked(nodeId);
        const nodePos = floorLayout.getNodePosition(nodeId);
        moveGrabOffset = nodePos ? { x: worldPoint.x - nodePos.x, y: worldPoint.y - nodePos.y } : { x: 0, y: 0 };
        // Precise port targeting (Falcon, 2026-09-05): remember which
        // exact dot the press landed on, if any — only matters if
        // this turns into a wire drag (checked below on release).
        const anchorHit = floorLayout.nearestAnchorOnNode(nodeId, worldPoint, PORT_SNAP_RADIUS_PX / camera.zoom);
        wireFromAnchorIndex = anchorHit?.anchorIndex;
        return;
      }

      const edgeId = hitTestEdge(worldPoint);
      if (edgeId) {
        pointerMode = 'edge-down';
        pendingEdgeHitId = edgeId;
        return;
      }

      const sketchHit = hitTestSketch(worldPoint);
      if (sketchHit) {
        pointerMode = 'sketch-down';
        pendingSketchHitId = sketchHit.id;
        pendingSketchSegmentIndex = sketchHit.segmentIndex;
        // Falcon, 2026-09-05 ("pinned" -- a pinned end is locked in by
        // design, move the node instead): a sketch with EITHER end
        // attached never becomes draggable here, no matter how far
        // the pointer travels -- see onPointerMove's sketch-down ->
        // sketch-move transition, which checks this same flag.
        const hitSketch = sketchLayer.get(sketchHit.id);
        pendingSketchCanMove = !!hitSketch && !hitSketch.fromAttachment && !hitSketch.toAttachment;
        return;
      }

      const annotationHit = hitTestAnnotation(worldPoint);
      if (annotationHit) {
        pointerMode = 'annotation-down';
        pendingAnnotationHitId = annotationHit;
        annotationMoveOriginalPosition = annotationLayer.get(annotationHit)?.position;
        annotationMoveOriginWorld = worldPoint;
        return;
      }

      // FBP014 (2026-09-05): empty canvas while the multi-select tool
      // is armed draws a marquee instead of panning -- panning from
      // empty space stays free the rest of the time, same as always.
      if (multiSelectArmedRef.current) {
        pointerMode = 'marquee';
        marqueeOrigin = worldPoint;
        marqueeCurrent = worldPoint;
        return;
      }

      pointerMode = 'pan';
    }

    function onPointerMove(e: PointerEvent): void {
      if (!dragOriginScreen || !dragLastScreen) return;
      const totalMove = Math.hypot(e.clientX - dragOriginScreen.x, e.clientY - dragOriginScreen.y);

      if (pointerMode === 'pan') {
        const dx = e.clientX - dragLastScreen.x;
        const dy = e.clientY - dragLastScreen.y;
        dragLastScreen = { x: e.clientX, y: e.clientY };
        camera.pan(dx, dy);
        return;
      }

      if (pointerMode === 'reshape' && reshapeKind && reshapeId && reshapeOriginalPoints && reshapeCenter) {
        // FBP016 (2026-09-06): both tools recompute from the ORIGINAL
        // captured points every frame (never the previous frame's
        // result), same anti-drift convention as group-move/sketch-
        // move -- Move translates by the raw world delta since
        // pointerdown, Rotate spins by the change in angle around the
        // shape's own fixed center (bezier.ts's rotatePoints applies
        // the 15°-ish magnetic snap).
        const current = toWorld(e.clientX, e.clientY);
        const newPoints =
          reshapeTool === 'move'
            ? translatePoints(reshapeOriginalPoints, current.x - reshapeOriginWorld!.x, current.y - reshapeOriginWorld!.y)
            : rotatePoints(
                reshapeOriginalPoints,
                reshapeCenter,
                Math.atan2(current.y - reshapeCenter.y, current.x - reshapeCenter.x) - reshapeStartAngle,
              );
        if (reshapeKind === 'edge') {
          floorLayout.setEdgeReshapePoints(reshapeId, newPoints);
        } else {
          const sketch = sketchLayer.get(reshapeId);
          if (sketch) sketchLayer.update(reshapeId, applySketchReshapePoints(sketch, newPoints));
        }
        return;
      }

      if (pointerMode === 'node-down' && totalMove > CLICK_MOVE_THRESHOLD_PX) {
        if (wireGesture) {
          pointerMode = 'wire';
          wireFromNodeId = pendingNodeHitId;
        } else if (!moveLocked) {
          pointerMode = 'move';
          // FBP014 (2026-09-05): dragging a node that's part of an
          // active 2+-member multi selection moves the WHOLE group,
          // regardless of whether the multi-select tool is still
          // armed -- building the selection is what arming is for,
          // moving it works like any other node drag from then on.
          // Snapshot every member's pre-drag position now so the
          // group's relative layout never drifts as deltas accumulate
          // frame to frame.
          const sel = selectionRef.current;
          if (sel?.type === 'multi' && pendingNodeHitId && sel.nodeIds.includes(pendingNodeHitId)) {
            groupMoveActive = true;
            groupOriginalPositions = new Map();
            for (const id of sel.nodeIds) {
              const p = floorLayout.getNodePosition(id);
              if (p) groupOriginalPositions.set(id, p);
            }
          } else {
            groupMoveActive = false;
            groupOriginalPositions = null;
          }
        }
        // else: dragging a locked node with no Shift — stays
        // 'node-down' with no visible effect; releasing past the
        // click threshold then selects nothing new (see onPointerUp).
      }

      if (pointerMode === 'sketch-down' && pendingSketchCanMove && totalMove > CLICK_MOVE_THRESHOLD_PX) {
        // Falcon, 2026-09-05 ("pinned"): only ever reached when
        // NEITHER end is attached (pendingSketchCanMove, set at
        // grab-time in onPointerDown) -- a sketch with a pinned end
        // stays 'sketch-down' with no visible effect here, exactly
        // like dragging a locked node above, and a release past the
        // click threshold does nothing (see onPointerUp).
        const hitSketch = pendingSketchHitId ? sketchLayer.get(pendingSketchHitId) : undefined;
        if (hitSketch) {
          pointerMode = 'sketch-move';
          sketchMoveOriginalPoints = hitSketch.points.map((p) => ({ x: p.x, y: p.y }));
          sketchMoveOriginWorld = toWorld(dragOriginScreen.x, dragOriginScreen.y);
        }
      }

      if (pointerMode === 'sketch-move' && pendingSketchHitId && sketchMoveOriginalPoints && sketchMoveOriginWorld) {
        // Falcon, 2026-09-05 ("the sketch cannot be moved"): the whole
        // shape translates as one rigid body -- every point shifts by
        // the SAME delta, computed from the drag's ORIGIN each frame
        // (not the previous frame's point) so tiny per-frame errors
        // never accumulate into drift. Applying an equal delta to
        // every point also can't distort any segment's curve: bow is
        // a fraction of the (to - from) vector, and that vector is
        // unchanged when both its ends move together.
        const current = toWorld(e.clientX, e.clientY);
        const dx = current.x - sketchMoveOriginWorld.x;
        const dy = current.y - sketchMoveOriginWorld.y;
        const points = sketchMoveOriginalPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        sketchLayer.update(pendingSketchHitId, { points });
      }

      if (pointerMode === 'annotation-down' && totalMove > CLICK_MOVE_THRESHOLD_PX) {
        pointerMode = 'annotation-move';
      }

      if (
        pointerMode === 'annotation-move' &&
        pendingAnnotationHitId &&
        annotationMoveOriginalPosition &&
        annotationMoveOriginWorld
      ) {
        // Falcon, 2026-09-09 (INSERT tab): same single-delta-from-
        // origin convention as sketch-move just above, so the drag
        // never drifts under rounding.
        const current = toWorld(e.clientX, e.clientY);
        const dx = current.x - annotationMoveOriginWorld.x;
        const dy = current.y - annotationMoveOriginWorld.y;
        annotationLayer.update(pendingAnnotationHitId, {
          position: { x: annotationMoveOriginalPosition.x + dx, y: annotationMoveOriginalPosition.y + dy },
        });
      }

      if (pointerMode === 'marquee') {
        marqueeCurrent = toWorld(e.clientX, e.clientY);
      }

      if (pointerMode === 'wire' || pointerMode === 'style-wire') {
        wireCurrentWorld = toWorld(e.clientX, e.clientY);
        const hit = floorLayout.findNearestAnchor(wireCurrentWorld, PORT_SNAP_RADIUS_PX / camera.zoom);
        hoveredAnchor = hit && hit.nodeId !== wireFromNodeId ? hit : undefined;
      }

      if (pointerMode === 'sketch-draw') {
        sketchDrawCurrent = toWorld(e.clientX, e.clientY);
        hoveredAnchor = floorLayout.findNearestAnchor(sketchDrawCurrent, SKETCH_PORT_SNAP_RADIUS_PX / camera.zoom);
        // Path-to-path visual snap only matters when no port dot is
        // already close enough to take priority (Falcon, 2026-09-05:
        // ports are the "real" targets; other paths are alignment
        // only).
        hoveredPathSnapPoint = hoveredAnchor
          ? undefined
          : nearestPointOnAnyPath(sketchDrawCurrent, SKETCH_PORT_SNAP_RADIUS_PX / camera.zoom);
      }

      if (pointerMode === 'move' && groupMoveActive && groupOriginalPositions && pendingNodeHitId && moveGrabOffset) {
        // FBP014 (2026-09-05): group move -- every member translates
        // by the SAME delta the grabbed node does (computed from its
        // own snapped candidate position), so relative spacing within
        // the group never drifts. Hard-blocked as a whole, exactly
        // like a single node hitting a wall: if ANY member's candidate
        // would overlap a node outside the group, nothing moves this
        // frame rather than some members moving and others not.
        const currentWorld = toWorld(e.clientX, e.clientY);
        const grabbedOriginal = groupOriginalPositions.get(pendingNodeHitId);
        if (grabbedOriginal) {
          const rawGrabbedPos = { x: currentWorld.x - moveGrabOffset.x, y: currentWorld.y - moveGrabOffset.y };
          const snappedGrabbedPos = snapToGridPoint(rawGrabbedPos);
          const delta = { x: snappedGrabbedPos.x - grabbedOriginal.x, y: snappedGrabbedPos.y - grabbedOriginal.y };
          const groupIds = [...groupOriginalPositions.keys()];
          const candidates = new Map<NodeId, Point>();
          for (const [id, origPos] of groupOriginalPositions) {
            candidates.set(id, { x: origPos.x + delta.x, y: origPos.y + delta.y });
          }
          let blocked = false;
          for (const cand of candidates.values()) {
            if (floorLayout.wouldOverlap(cand, groupIds)) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            for (const [id, cand] of candidates) {
              floorLayout.setNodePosition(id, cand);
              for (const edge of edgesTouchingNode(id)) {
                floorLayout.recomputeEdgeCurve(edge.id, edge.source, edge.target);
              }
              syncSketchEndpointsToNode(id);
            }
          }
        }
      } else if (pointerMode === 'move' && pendingNodeHitId && moveGrabOffset) {
        const currentWorld = toWorld(e.clientX, e.clientY);
        const rawPos = { x: currentWorld.x - moveGrabOffset.x, y: currentWorld.y - moveGrabOffset.y };
        const snappedPos = snapToGridPoint(rawPos);
        // Falcon, 2026-09-05: "dont allow overlapping of nodes ...
        // even creating new node it will hardblock if attempted or
        // cause overlapping" -- a drag that WOULD land the node on
        // top of another one simply doesn't move it any further this
        // frame (the node behaves like it hit a wall), rather than
        // being allowed through and corrected after the fact.
        if (floorLayout.wouldOverlap(snappedPos, pendingNodeHitId)) return;
        floorLayout.setNodePosition(pendingNodeHitId, snappedPos);
        for (const edge of edgesTouchingNode(pendingNodeHitId)) {
          floorLayout.recomputeEdgeCurve(edge.id, edge.source, edge.target);
        }
        // Keep any sketch endpoint pinned to this node glued to its
        // (moved) port, same spirit as recomputeEdgeCurve above —
        // Falcon, 2026-09-05: a "planned connection" should track the
        // node it's pinned to.
        syncSketchEndpointsToNode(pendingNodeHitId);
      }
    }

    function onPointerUp(e: PointerEvent): void {
      const worldPoint = toWorld(e.clientX, e.clientY);
      const totalMove = dragOriginScreen
        ? Math.hypot(e.clientX - dragOriginScreen.x, e.clientY - dragOriginScreen.y)
        : 0;
      const isClick = totalMove <= CLICK_MOVE_THRESHOLD_PX;

      if (pointerMode === 'placement') {
        if (isClick && placementKindRef.current) {
          onPlaceNodeRef.current(placementKindRef.current, snapToGridPoint(worldPoint));
        }
      } else if (pointerMode === 'wire' && wireFromNodeId) {
        // Precise port targeting (Falcon, 2026-09-05): a release right
        // on a free dot locks onto that exact port; right on a TAKEN
        // dot rejects the connection outright (the user asked for
        // that specific port, so there's no "close enough" fallback);
        // otherwise fall back to today's body-drop auto-pick, still
        // honoring an explicitly-grabbed source dot if there was one.
        if (hoveredAnchor && hoveredAnchor.nodeId !== wireFromNodeId) {
          if (!hoveredAnchor.occupied) {
            onCreateEdgeRef.current(wireFromNodeId, hoveredAnchor.nodeId, {
              sourceAnchor: wireFromAnchorIndex,
              targetAnchor: hoveredAnchor.anchorIndex,
            });
          } else {
            // Falcon, 2026-09-05: released precisely on a dot that's
            // already taken — the user asked for that specific port,
            // so there's no "close enough" fallback (see the comment
            // above onCreateEdgeRef.current). Never reaches App.tsx's
            // handleCreateEdge at all, so this is the one rejection
            // reason FluxCanvas has to report itself.
            onConnectionRejectedRef.current?.('That port is already connected.');
          }
        } else {
          const targetNodeId = hitTestNode(worldPoint);
          if (targetNodeId && targetNodeId !== wireFromNodeId) {
            onCreateEdgeRef.current(
              wireFromNodeId,
              targetNodeId,
              wireFromAnchorIndex !== undefined ? { sourceAnchor: wireFromAnchorIndex } : undefined,
            );
          }
        }
      } else if (pointerMode === 'style-wire' && armedEdgeStyleRef.current) {
        const style = armedEdgeStyleRef.current;
        if (isClick) {
          // A stationary click still restyles whatever existing edge
          // is under the cursor -- no longer depends on where the
          // click started (Falcon, 2026-09-05: "why i still cant draw
          // other paths like how the sketch get drawn?").
          const edgeId = hitTestEdge(worldPoint);
          if (edgeId) onApplyEdgeStyleRef.current(edgeId, style);
        } else {
          // A real drag: try a genuine node-to-node edge first,
          // mirroring the 'wire' branch above exactly -- but the
          // origin may itself be floating (wireFromNodeId undefined),
          // which can never form a real edge no matter where it
          // lands.
          const bodyHit = !hoveredAnchor ? hitTestNode(worldPoint) : undefined;
          if (hoveredAnchor && wireFromNodeId && hoveredAnchor.nodeId !== wireFromNodeId) {
            if (!hoveredAnchor.occupied) {
              onCreateEdgeRef.current(
                wireFromNodeId,
                hoveredAnchor.nodeId,
                { sourceAnchor: wireFromAnchorIndex, targetAnchor: hoveredAnchor.anchorIndex },
                style,
              );
            } else {
              onConnectionRejectedRef.current?.('That port is already connected.');
            }
          } else if (wireFromNodeId && bodyHit === wireFromNodeId) {
            // Released back on the very node the drag started from --
            // a no-op, same as a plain 'wire' drag snapping onto
            // itself.
          } else if (wireFromNodeId && bodyHit) {
            onCreateEdgeRef.current(
              wireFromNodeId,
              bodyHit,
              wireFromAnchorIndex !== undefined ? { sourceAnchor: wireFromAnchorIndex } : undefined,
              style,
            );
          } else if (styleDrawOrigin) {
            // Falcon, 2026-09-05: "falls back to a sketch" -- either
            // the origin was floating, or the release didn't land on
            // a real node/port either, so this becomes a plain
            // planning sketch instead, exactly like sketch-draw's own
            // fallback. Sketches don't carry a style of their own
            // (picked later at convert time), so the armed style is
            // simply spent, not carried over.
            const toAnchorHit = hoveredAnchor && !hoveredAnchor.occupied ? hoveredAnchor : undefined;
            const fromAttachment: SketchAttachment | null =
              wireFromNodeId !== undefined && wireFromAnchorIndex !== undefined
                ? { nodeId: wireFromNodeId, anchorIndex: wireFromAnchorIndex }
                : null;
            const toAttachment: SketchAttachment | null = toAnchorHit
              ? { nodeId: toAnchorHit.nodeId, anchorIndex: toAnchorHit.anchorIndex }
              : null;
            const finalTo = toAnchorHit ? toAnchorHit.point : worldPoint;
            onCreateSketchRef.current([styleDrawOrigin, finalTo], [{ bow: 0 }], fromAttachment, toAttachment);
          }
        }
      } else if (pointerMode === 'sketch-draw') {
        const toAnchorHit = hoveredAnchor && !hoveredAnchor.occupied ? hoveredAnchor : undefined;
        const committedPoint = toAnchorHit ? toAnchorHit.point : (hoveredPathSnapPoint ?? worldPoint);
        const committedAttachment: SketchAttachment | null = toAnchorHit
          ? { nodeId: toAnchorHit.nodeId, anchorIndex: toAnchorHit.anchorIndex }
          : null;
        if (sketchStyleRef.current === 'single') {
          // One drag, one segment -- the origin was already captured
          // on press, so this release is always the second (and
          // last) point; finalize right away instead of waiting for
          // a double-click.
          sketchChainPoints.push(committedPoint);
          sketchChainAttachments.push(committedAttachment);
          finalizeSketchChain();
        } else {
          // Falcon, 2026-09-05 ("Click to place each point ... double-
          // click ... to finish"): every release commits a waypoint at
          // wherever it landed (snapping onto a free port if close
          // enough), UNLESS it lands close enough in time and space to
          // the previous commit to count as a double-click -- that
          // finishes the chain instead (see SKETCH_DOUBLE_CLICK_MS).
          const screenPoint = { x: e.clientX, y: e.clientY };
          const isDoubleClick =
            sketchLastCommitScreen !== undefined &&
            Date.now() - sketchLastCommitTime < SKETCH_DOUBLE_CLICK_MS &&
            Math.hypot(screenPoint.x - sketchLastCommitScreen.x, screenPoint.y - sketchLastCommitScreen.y) <=
              CLICK_MOVE_THRESHOLD_PX * 2;
          if (isDoubleClick) {
            finalizeSketchChain();
          } else {
            sketchChainPoints.push(committedPoint);
            sketchChainAttachments.push(committedAttachment);
            sketchLastCommitScreen = screenPoint;
            sketchLastCommitTime = Date.now();
          }
        }
      } else if (pointerMode === 'sketch-down' && isClick && pendingSketchHitId) {
        // Falcon, 2026-09-05 ("click directly on that segment"):
        // clicking a specific leg of an ALREADY-selected multi-
        // segment sketch drills into just that segment; any other
        // click (a fresh sketch, or a 1-segment sketch with nothing
        // to drill into) selects the whole thing, same as before.
        const alreadySelected =
          selectionRef.current?.type === 'sketch' && selectionRef.current.id === pendingSketchHitId;
        const clickedSketch = sketchLayer.get(pendingSketchHitId);
        const canDrillDown = alreadySelected && !!clickedSketch && clickedSketch.segments.length > 1;
        onSelectRef.current(
          canDrillDown
            ? { type: 'sketch', id: pendingSketchHitId, segmentIndex: pendingSketchSegmentIndex }
            : { type: 'sketch', id: pendingSketchHitId },
        );
      } else if (pointerMode === 'sketch-move' && pendingSketchHitId) {
        // Falcon, 2026-09-05 ("the sketch cannot be moved"): every
        // pointermove during the drag already applied the sketch's
        // new position -- select the whole sketch on release, same
        // as a plain click would, rather than leaving the prior
        // selection (or none) in place.
        onSelectRef.current({ type: 'sketch', id: pendingSketchHitId });
      } else if (pointerMode === 'annotation-down' && isClick && pendingAnnotationHitId) {
        onSelectRef.current({ type: 'annotation', id: pendingAnnotationHitId });
      } else if (pointerMode === 'annotation-move' && pendingAnnotationHitId) {
        // Every pointermove during the drag already applied the
        // annotation's new position -- select it on release, same as
        // sketch-move above.
        onSelectRef.current({ type: 'annotation', id: pendingAnnotationHitId });
      } else if (pointerMode === 'move' && pendingNodeHitId) {
        // FBP014 (2026-09-05): a group move already applied every
        // member's new position on each pointermove above -- leave
        // the multi selection exactly as it was rather than
        // collapsing it down to just the node that happened to be
        // grabbed. A single-node move still selects that node, same
        // as always.
        if (!groupMoveActive) onSelectRef.current({ type: 'node', id: pendingNodeHitId });
      } else if (pointerMode === 'node-down' && isClick && pendingNodeHitId) {
        // FBP014 (2026-09-05): with the multi-select tool armed, a
        // plain click toggles that node into/out of the current
        // selection instead of replacing it -- a stationary click
        // outside armed mode still just selects the one node, same
        // as always.
        if (
          multiSelectArmedRef.current &&
          (quickSelectFilterRef.current === 'nodes' || quickSelectFilterRef.current === 'all')
        ) {
          const parts = normalizeMultiParts(selectionRef.current);
          const already = parts.nodeIds.includes(pendingNodeHitId);
          const nodeIds = already
            ? parts.nodeIds.filter((id) => id !== pendingNodeHitId)
            : [...parts.nodeIds, pendingNodeHitId];
          onSelectRef.current(collapseSelection({ ...parts, nodeIds }));
        } else if (!multiSelectArmedRef.current) {
          onSelectRef.current({ type: 'node', id: pendingNodeHitId });
        }
        // else: multi-select is armed but scoped to paths/sketches --
        // a plain click on a node does nothing, keeping the box-drag
        // the only way to add to a filtered selection.

      } else if (pointerMode === 'edge-down' && isClick && pendingEdgeHitId) {
        onSelectRef.current({ type: 'edge', id: pendingEdgeHitId });
      } else if (pointerMode === 'pan' && isClick) {
        onSelectRef.current(null);
      } else if (pointerMode === 'marquee' && marqueeOrigin && marqueeCurrent) {
        // FBP014 (2026-09-05), scoped by Falcon's quick-select filter
        // (2026-09-05): which kind of item counts as "inside" the
        // dragged rectangle depends on quickSelectFilterRef -- a
        // "Paths only"/"Sketches only" pick arms this same marquee
        // tool narrowed to just that kind, so a box that also happens
        // to cross a node or sketch ignores it entirely; the default
        // (plain-armed) filter is 'nodes', matching the original
        // node-center-in-rectangle behavior exactly. Merged with
        // whatever was already selected (so successive drags/toggles
        // build up a group) rather than replacing it. A marquee that
        // encloses nothing of the active kind clears the selection,
        // same spirit as an empty-space click in the default
        // (un-armed) pan mode.
        const minX = Math.min(marqueeOrigin.x, marqueeCurrent.x);
        const maxX = Math.max(marqueeOrigin.x, marqueeCurrent.x);
        const minY = Math.min(marqueeOrigin.y, marqueeCurrent.y);
        const maxY = Math.max(marqueeOrigin.y, marqueeCurrent.y);
        const inRect = (p: Point): boolean => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        const filter = quickSelectFilterRef.current;

        const enclosedNodeIds: NodeId[] = [];
        const enclosedEdgeIds: EdgeId[] = [];
        const enclosedSketchIds: string[] = [];

        // 'all' runs every check below (no kind restriction); a
        // specific kind only runs its own -- independent ifs, not a
        // chain, since 'all' needs more than one to fire.
        if (filter === 'all' || filter === 'nodes') {
          for (const node of graph.getAllNodes()) {
            const pos = floorLayout.getNodePosition(node.id);
            if (pos && inRect(pos)) enclosedNodeIds.push(node.id);
          }
        }
        if (filter === 'all' || filter === 'paths') {
          const samples = 24;
          for (const edge of graph.getAllEdges()) {
            const curve = floorLayout.getEdgeCurve(edge.id);
            if (!curve) continue;
            for (let i = 0; i <= samples; i++) {
              if (inRect(curve.getPointAtProgress(i / samples))) {
                enclosedEdgeIds.push(edge.id);
                break;
              }
            }
          }
        }
        if (filter === 'all' || filter === 'sketches') {
          const samples = 20;
          for (const sketch of sketchLayer.getAll()) {
            let enclosed = false;
            for (let s = 0; s < sketch.segments.length && !enclosed; s++) {
              const curve = new BezierPath(
                curveBetween(sketch.points[s]!, sketch.points[s + 1]!, sketch.segments[s]!.bow),
              );
              for (let i = 0; i <= samples; i++) {
                if (inRect(curve.getPointAtProgress(i / samples))) {
                  enclosed = true;
                  break;
                }
              }
            }
            if (enclosed) enclosedSketchIds.push(sketch.id);
          }
        }

        const totalEnclosed = enclosedNodeIds.length + enclosedEdgeIds.length + enclosedSketchIds.length;
        if (totalEnclosed > 0) {
          const parts = normalizeMultiParts(selectionRef.current);
          const nodeIds = [...new Set([...parts.nodeIds, ...enclosedNodeIds])];
          const edgeIds = [...new Set([...parts.edgeIds, ...enclosedEdgeIds])];
          const sketchIds = [...new Set([...parts.sketchIds, ...enclosedSketchIds])];
          onSelectRef.current(collapseSelection({ nodeIds, edgeIds, sketchIds }));
        } else {
          onSelectRef.current(null);
        }
      }

      // Falcon, 2026-09-05 ("l3 connected non linear paths"): a
      // multi-segment chain spans many pointerdown/up cycles -- unlike
      // every other gesture here, it must NOT reset back to 'idle'
      // (or clear the live preview state) between individual clicks,
      // since the chain-preview render block and the anchor-ring/
      // path-snap-marker blocks all still gate on pointerMode ===
      // 'sketch-draw'. finalizeSketchChain/cancelSketchChain already
      // reset pointerMode themselves once the chain is actually done,
      // so by the time this runs after either of those, chain.length
      // is back to 0 and this correctly falls through to the normal
      // reset below.
      const stayingInChain = pointerMode === 'sketch-draw' && sketchChainPoints.length > 0;
      if (!stayingInChain) {
        pointerMode = 'idle';
        hoveredAnchor = undefined;
        sketchDrawCurrent = undefined;
        hoveredPathSnapPoint = undefined;
      }
      dragOriginScreen = null;
      dragLastScreen = null;
      pendingNodeHitId = undefined;
      pendingEdgeHitId = undefined;
      pendingSketchHitId = undefined;
      pendingSketchSegmentIndex = undefined;
      pendingSketchCanMove = false;
      sketchMoveOriginalPoints = undefined;
      sketchMoveOriginWorld = undefined;
      wireFromNodeId = undefined;
      wireCurrentWorld = undefined;
      wireFromAnchorIndex = undefined;
      styleDrawOrigin = undefined;
      wireGesture = false;
      moveLocked = false;
      moveGrabOffset = null;
      marqueeOrigin = undefined;
      marqueeCurrent = undefined;
      groupMoveActive = false;
      groupOriginalPositions = null;
      reshapeKind = undefined;
      reshapeId = undefined;
      reshapeTool = undefined;
      reshapeOriginalPoints = undefined;
      reshapeCenter = undefined;
      reshapeOriginWorld = undefined;
      reshapeStartAngle = 0;

      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be released — harmless
      }
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const viewport = currentViewport();
      const factor = Math.exp(-e.deltaY * 0.001);
      camera.zoomAt(screenPoint, viewport, factor);
    }

    /** StatusBar's coordinate readout -- independent of the drag-
     * gesture pointermove above (which only tracks once a gesture is
     * already in progress, via dragOriginScreen): this reports on
     * every hover, dragging or not, and clears to null on pointer
     * leave. */
    function onHoverMove(e: PointerEvent): void {
      onCursorWorldPositionChangeRef.current?.(toWorld(e.clientX, e.clientY));
      // Falcon, 2026-09-05 ("l3 connected non linear paths"): a multi-
      // segment chain is built from individual clicks, not one
      // continuous drag -- the rubber-band preview (and even the very
      // first click's own port-snap detection) need to track the
      // cursor on plain hover, not only during an actively-held
      // pointer (onPointerMove above only runs during a captured
      // drag, which a between-clicks hover isn't).
      if (sketchArmedRef.current) {
        sketchDrawCurrent = toWorld(e.clientX, e.clientY);
        hoveredAnchor = floorLayout.findNearestAnchor(sketchDrawCurrent, SKETCH_PORT_SNAP_RADIUS_PX / camera.zoom);
        hoveredPathSnapPoint = hoveredAnchor
          ? undefined
          : nearestPointOnAnyPath(sketchDrawCurrent, SKETCH_PORT_SNAP_RADIUS_PX / camera.zoom);
      }
    }
    function onHoverLeave(): void {
      onCursorWorldPositionChangeRef.current?.(null);
    }

    /** Falcon, 2026-09-05 ("double-click (or press Enter/Escape) to
     * finish the chain"): Enter finishes the chain with whatever's
     * already committed (without adding a point at the live cursor);
     * Escape discards it outright. Scoped to only fire while a chain
     * actually has at least one committed point, so it never steals
     * Enter/Escape from anything else on the page. */
    function onSketchChainKeyDown(e: KeyboardEvent): void {
      if (sketchChainPoints.length === 0) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finalizeSketchChain();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelSketchChain();
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointermove', onHoverMove);
    canvas.addEventListener('pointerleave', onHoverLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onSketchChainKeyDown);

    // INSERT tab (Falcon, 2026-09-09): a native HTML5 drag-and-drop
    // from the ribbon's icon swatches -- dragover must call
    // preventDefault or the browser refuses the drop entirely.
    // dataTransfer carries the icon kind as plain text.
    function onDragOver(e: DragEvent): void {
      e.preventDefault();
    }
    function onDrop(e: DragEvent): void {
      e.preventDefault();
      const worldPoint = toWorld(e.clientX, e.clientY);
      const isText = e.dataTransfer?.getData('application/x-fluxboard-annotation-text');
      if (isText) {
        onDropAnnotationRef.current({ kind: 'text' }, worldPoint);
        return;
      }
      const customIconId = e.dataTransfer?.getData('application/x-fluxboard-annotation-custom');
      if (customIconId) {
        onDropAnnotationRef.current({ kind: 'custom', customIconId }, worldPoint);
        return;
      }
      const icon = e.dataTransfer?.getData('application/x-fluxboard-annotation-icon');
      if (!icon) return;
      onDropAnnotationRef.current({ kind: 'icon', icon: icon as AnnotationIconKind }, worldPoint);
    }
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('drop', onDrop);

    return () => {
      cancelAnimationFrame(raf);
      driverRef.current = null;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onHoverMove);
      canvas.removeEventListener('pointerleave', onHoverLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onSketchChainKeyDown);
      canvas.removeEventListener('dragover', onDragOver);
      canvas.removeEventListener('drop', onDrop);
    };
    // Interaction props (selection, onSelect, placementKind,
    // onPlaceNode, onCreateEdge, snapToGrid, gridSpacing,
    // armedEdgeStyle, onApplyEdgeStyle, multiSelectArmed,
    // quickSelectFilter, moveArmed, rotateArmed)
    // are intentionally excluded — they're read through refs above so
    // a click doesn't tear down and recreate the SimEngine/driver.
    // onRunningChange is invoked through a ref too, for the same
    // reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, floorLayout, skinConfig, objectRegistry, tickIntervalMs]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
      />
    </div>
  );
});

FluxCanvas.displayName = 'FluxCanvas';

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, viewport: Viewport, spacing: number, color: string): void {
  const bounds = camera.getVisibleWorldBounds(viewport);
  const startX = Math.floor(bounds.minX / spacing) * spacing;
  const startY = Math.floor(bounds.minY / spacing) * spacing;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= bounds.maxX; x += spacing) {
    const screen = camera.worldToScreen({ x, y: 0 }, viewport);
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, viewport.height);
  }
  for (let y = startY; y <= bounds.maxY; y += spacing) {
    const screen = camera.worldToScreen({ x: 0, y }, viewport);
    ctx.moveTo(0, screen.y);
    ctx.lineTo(viewport.width, screen.y);
  }
  ctx.stroke();
}

/** A small directional arrowhead at a sketch's midpoint, pointing
 * from->to — the same visual language as a real path's own direction
 * arrow (skin/pathSkin.ts's drawPathDirectionArrow), but computed
 * directly from two points since a sketch is a plain line, not a
 * BezierPath (Falcon, 2026-09-05: a sketch should have a legible
 * sense of direction even though nothing simulates along it). */
function drawStraightDirectionArrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  camera: Camera,
  viewport: Viewport,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return;
  const angle = Math.atan2(dy, dx);
  const midWorld = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const screen = camera.worldToScreen(midWorld, viewport);
  const size = Math.max(5, 7 * camera.zoom);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.62);
  ctx.lineTo(-size * 0.6, -size * 0.62);
  ctx.closePath();
  ctx.fillStyle = 'rgba(124, 58, 237, 0.85)';
  ctx.fill();
  ctx.restore();
}

/** A small hollow ring at a sketch endpoint that ISN'T pinned to a
 * real port — visually distinct from a real node's filled anchor dot,
 * so a half-connected sketch (Falcon, 2026-09-05) reads at a glance:
 * one end is a genuine port, the other is still just a placeholder. */
function drawLooseEndpointMarker(ctx: CanvasRenderingContext2D, worldPoint: Point, camera: Camera, viewport: Viewport): void {
  const screen = camera.worldToScreen(worldPoint, viewport);
  const r = Math.max(3, 4 * camera.zoom);
  ctx.save();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.75)';
  ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
  ctx.stroke();
  ctx.restore();
}

/** Falcon, 2026-09-05 ("there is no way i can snap a sketch to a
 * node's port"): the affirmative counterpart to
 * drawLooseEndpointMarker -- a small SOLID green ring right on the
 * port a sketch end is actually pinned to, so "pinned" reads as
 * clearly different from "loose" as the colors/fill make it, instead
 * of the pinned case drawing nothing at all and just hoping the
 * coincidence with the node's own port dot reads as confirmation. */
function drawPinnedEndpointMarker(ctx: CanvasRenderingContext2D, worldPoint: Point, camera: Camera, viewport: Viewport): void {
  const screen = camera.worldToScreen(worldPoint, viewport);
  const r = Math.max(3, 4 * camera.zoom);
  ctx.save();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(46, 204, 113, 0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(20, 90, 50, 0.9)';
  ctx.lineWidth = Math.max(1, 1 * camera.zoom);
  ctx.stroke();
  ctx.restore();
}

/** A highlight ring drawn over a port dot the cursor is currently
 * near while dragging out a new path or sketch (Falcon, 2026-09-05:
 * "snap on those dots") — color communicates whether that dot can
 * actually be attached to (free) or not (already taken). */
function drawAnchorRing(ctx: CanvasRenderingContext2D, screenPoint: Point, zoom: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(screenPoint.x, screenPoint.y, Math.max(6, 8 * zoom), 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, 2.5 * zoom);
  ctx.stroke();
  ctx.restore();
}

/** A small filled dot at a wire/sketch drag's own endpoint -- always
 * shown while drawing, independent of whether anything is under the
 * cursor (Falcon, 2026-09-05: "the path should also have green and
 * red at the end when drawing mode or sketch mode was activated").
 * Red at the fixed origin (outgoing), green at the moving head
 * (incoming) -- the same two colors a real port dot uses once wired,
 * so the preview already reads the way the finished connection will. */
function drawEndpointDot(ctx: CanvasRenderingContext2D, screenPoint: Point, zoom: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(screenPoint.x, screenPoint.y, Math.max(3, 4 * zoom), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.2 * zoom);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.stroke();
  ctx.restore();
}

/** A small diamond marking where a drawn sketch's loose end has
 * visually snapped onto an EXISTING path/sketch (Falcon, 2026-09-05:
 * "allow snapping paths ... to other paths") -- deliberately a
 * different shape from drawAnchorRing's circle, so "aligned to a
 * path" never reads as "attached to a port," since it isn't one. */
function drawPathSnapMarker(ctx: CanvasRenderingContext2D, screenPoint: Point, zoom: number): void {
  const size = Math.max(5, 6 * zoom);
  ctx.save();
  ctx.translate(screenPoint.x, screenPoint.y);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = 'rgba(58, 58, 66, 0.75)';
  ctx.lineWidth = Math.max(1.5, 2 * zoom);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}
