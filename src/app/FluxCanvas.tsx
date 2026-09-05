import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Camera, type Viewport } from '../floor/camera';
import { NODE_RADIUS, type AnchorHit, type FloorLayout } from '../floor/floorLayout';
import { InterpolatedSimDriver } from '../floor/interpolatedSim';
import { GraphModel } from '../core/GraphModel';
import { SimEngine } from '../core/SimEngine';
import type { EdgeDef, EdgeId, NodeDef, NodeId, NodeKind } from '../core/types';
import type { Point } from '../floor/bezier';
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
import type { Selection } from './selection';
import { SketchLayer, type Sketch, type SketchAttachment } from './sketchLayer';
import { CANVAS_THEMES, type CanvasBackground } from './theme';

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
   * field, falling back to today's auto-pick behavior. */
  onCreateEdge: (
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    explicitAnchors?: { sourceAnchor?: number; targetAnchor?: number },
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
  /** Falcon, 2026-09-05: a sketch can pin either end to a real node's
   * port (fromAttachment/toAttachment, null/omitted for a floating
   * point) — App.tsx books the anchor in FloorLayout's shared
   * reservation pool so the sketch genuinely holds that port. */
  onCreateSketch: (
    from: Point,
    to: Point,
    fromAttachment?: SketchAttachment | null,
    toAttachment?: SketchAttachment | null,
  ) => void;

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
    onCreateSketch,
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
  const onCreateSketchRef = useRef(onCreateSketch);
  onCreateSketchRef.current = onCreateSketch;
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

    /** Closest-point-on-segment distance test — sketches are plain
     * straight lines (no bezier machinery needed, unlike hitTestEdge
     * above). */
    function hitTestSketch(worldPoint: Point): string | undefined {
      const toleranceWorld = EDGE_HIT_TOLERANCE_PX / camera.zoom;
      for (const sketch of sketchLayer.getAll()) {
        const dx = sketch.to.x - sketch.from.x;
        const dy = sketch.to.y - sketch.from.y;
        const lengthSq = dx * dx + dy * dy;
        let t = lengthSq === 0 ? 0 : ((worldPoint.x - sketch.from.x) * dx + (worldPoint.y - sketch.from.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));
        const closest = { x: sketch.from.x + t * dx, y: sketch.from.y + t * dy };
        const dist = Math.hypot(closest.x - worldPoint.x, closest.y - worldPoint.y);
        if (dist <= toleranceWorld) return sketch.id;
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
        const dx = sketch.to.x - sketch.from.x;
        const dy = sketch.to.y - sketch.from.y;
        const lengthSq = dx * dx + dy * dy;
        let t = lengthSq === 0 ? 0 : ((worldPoint.x - sketch.from.x) * dx + (worldPoint.y - sketch.from.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));
        const closest = { x: sketch.from.x + t * dx, y: sketch.from.y + t * dy };
        const d = Math.hypot(closest.x - worldPoint.x, closest.y - worldPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = closest;
        }
      }

      return best;
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

      canvas!.style.cursor = placementKindRef.current || armedEdgeStyleRef.current || sketchArmedRef.current
        ? 'crosshair'
        : pointerMode === 'move'
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

      // --- Planning sketches (Falcon, 2026-09-03) — drawn first, so
      // real nodes/paths always read on top of a draft guide. Purely
      // visual: dashed, muted, no simulation meaning at all. ---
      for (const sketch of sketchLayer.getAll()) {
        const a = camera.worldToScreen(sketch.from, viewport);
        const b = camera.worldToScreen(sketch.to, viewport);
        const isSelected = sel?.type === 'sketch' && sel.id === sketch.id;
        ctx!.save();
        ctx!.setLineDash([7, 5]);
        ctx!.strokeStyle = isSelected ? 'rgba(124, 58, 237, 0.9)' : 'rgba(124, 58, 237, 0.45)';
        ctx!.lineWidth = isSelected ? Math.max(2, 3 * camera.zoom) : Math.max(1.5, 2 * camera.zoom);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
        ctx!.restore();
        // Falcon, 2026-09-05: a sketch should read as having a
        // direction even though nothing flows along it — from -> to
        // is that direction, same visual language as a real path's
        // own arrow. Loose (unattached) ends get a small hollow ring
        // instead of a filled port dot, so it's obvious at a glance
        // which ends still need a node to snap onto.
        drawStraightDirectionArrow(ctx!, sketch.from, sketch.to, camera, viewport);
        if (!sketch.fromAttachment) drawLooseEndpointMarker(ctx!, sketch.from, camera, viewport);
        if (!sketch.toAttachment) drawLooseEndpointMarker(ctx!, sketch.to, camera, viewport);
      }
      if (pointerMode === 'sketch-draw' && sketchDrawOrigin && sketchDrawCurrent) {
        const headWorld =
          hoveredAnchor && !hoveredAnchor.occupied
            ? hoveredAnchor.point
            : (hoveredPathSnapPoint ?? sketchDrawCurrent);
        const a = camera.worldToScreen(sketchDrawOrigin, viewport);
        const b = camera.worldToScreen(headWorld, viewport);
        ctx!.save();
        ctx!.setLineDash([7, 5]);
        ctx!.strokeStyle = 'rgba(124, 58, 237, 0.7)';
        ctx!.lineWidth = Math.max(1.5, 2 * camera.zoom);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
        ctx!.restore();
        if (sketchFromAttachment) {
          drawAnchorRing(ctx!, camera.worldToScreen(sketchDrawOrigin, viewport), camera.zoom, 'rgba(124, 58, 237, 0.9)');
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
      if ((pointerMode === 'wire' || pointerMode === 'sketch-draw') && hoveredAnchor) {
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
        if (sel?.type === 'edge' && sel.id === edge.id) {
          drawCurveSelectionHighlight(ctx!, curve, camera, viewport);
        }
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

      for (const { node, pos } of visibleNodes) {
        const screen = camera.worldToScreen(pos, viewport);
        const r = NODE_RADIUS * camera.zoom;
        const state = engine.getNodeState(node.id) ?? {};
        drawNode(ctx!, node, state, screen, r, camera.zoom);
        if (skinConfig.getNodeLocked(node.id)) {
          drawNodeLockBadge(ctx!, screen, r, camera.zoom);
        }
        if (sel?.type === 'node' && sel.id === node.id) {
          drawNodeSelectionRing(ctx!, screen, r, camera.zoom);
        }
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
      | 'wire'
      | 'move'
      | 'placement'
      | 'apply-style'
      | 'sketch-draw';
    let pointerMode: PointerMode = 'idle';
    let dragOriginScreen: { x: number; y: number } | null = null;
    let dragLastScreen: { x: number; y: number } | null = null;
    let pendingNodeHitId: NodeId | undefined;
    let pendingEdgeHitId: string | undefined;
    let pendingSketchHitId: string | undefined;
    let wireFromNodeId: NodeId | undefined;
    let wireCurrentWorld: Point | undefined;
    // Precise port targeting (Falcon, 2026-09-05): the exact dot a
    // wire/sketch drag started or is currently hovering, if any.
    let wireFromAnchorIndex: number | undefined;
    let hoveredAnchor: AnchorHit | undefined;
    let sketchDrawOrigin: Point | undefined;
    let sketchDrawCurrent: Point | undefined;
    let sketchFromAttachment: SketchAttachment | null = null;
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

    function onPointerDown(e: PointerEvent): void {
      dragOriginScreen = { x: e.clientX, y: e.clientY };
      dragLastScreen = { x: e.clientX, y: e.clientY };
      canvas!.setPointerCapture(e.pointerId);

      const worldPoint = toWorld(e.clientX, e.clientY);

      if (placementKindRef.current) {
        pointerMode = 'placement';
        return;
      }

      if (armedEdgeStyleRef.current) {
        pointerMode = 'apply-style';
        return;
      }

      if (sketchArmedRef.current) {
        pointerMode = 'sketch-draw';
        // Precise port targeting (Falcon, 2026-09-05): start pinned to
        // a real port if the drag begins right on one, otherwise a
        // plain floating point exactly like before.
        const anchorHit = floorLayout.findNearestAnchor(worldPoint, PORT_SNAP_RADIUS_PX / camera.zoom);
        if (anchorHit && !anchorHit.occupied) {
          sketchFromAttachment = { nodeId: anchorHit.nodeId, anchorIndex: anchorHit.anchorIndex };
          sketchDrawOrigin = anchorHit.point;
        } else {
          sketchFromAttachment = null;
          sketchDrawOrigin = worldPoint;
        }
        sketchDrawCurrent = sketchDrawOrigin;
        return;
      }

      const nodeId = hitTestNode(worldPoint);
      if (nodeId) {
        pointerMode = 'node-down';
        pendingNodeHitId = nodeId;
        wireGesture = e.shiftKey;
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

      const sketchId = hitTestSketch(worldPoint);
      if (sketchId) {
        pointerMode = 'sketch-down';
        pendingSketchHitId = sketchId;
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

      if (pointerMode === 'node-down' && totalMove > CLICK_MOVE_THRESHOLD_PX) {
        if (wireGesture) {
          pointerMode = 'wire';
          wireFromNodeId = pendingNodeHitId;
        } else if (!moveLocked) {
          pointerMode = 'move';
        }
        // else: dragging a locked node with no Shift — stays
        // 'node-down' with no visible effect; releasing past the
        // click threshold then selects nothing new (see onPointerUp).
      }

      if (pointerMode === 'wire') {
        wireCurrentWorld = toWorld(e.clientX, e.clientY);
        const hit = floorLayout.findNearestAnchor(wireCurrentWorld, PORT_SNAP_RADIUS_PX / camera.zoom);
        hoveredAnchor = hit && hit.nodeId !== wireFromNodeId ? hit : undefined;
      }

      if (pointerMode === 'sketch-draw') {
        sketchDrawCurrent = toWorld(e.clientX, e.clientY);
        hoveredAnchor = floorLayout.findNearestAnchor(sketchDrawCurrent, PORT_SNAP_RADIUS_PX / camera.zoom);
        // Path-to-path visual snap only matters when no port dot is
        // already close enough to take priority (Falcon, 2026-09-05:
        // ports are the "real" targets; other paths are alignment
        // only).
        hoveredPathSnapPoint = hoveredAnchor
          ? undefined
          : nearestPointOnAnyPath(sketchDrawCurrent, PORT_SNAP_RADIUS_PX / camera.zoom);
      }

      if (pointerMode === 'move' && pendingNodeHitId && moveGrabOffset) {
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
        for (const sketch of sketchLayer.getAll()) {
          let patch: Partial<Sketch> | null = null;
          if (sketch.fromAttachment && sketch.fromAttachment.nodeId === pendingNodeHitId) {
            const pt = floorLayout.getAnchorPoint(pendingNodeHitId, sketch.fromAttachment.anchorIndex);
            if (pt) patch = { ...(patch ?? {}), from: pt };
          }
          if (sketch.toAttachment && sketch.toAttachment.nodeId === pendingNodeHitId) {
            const pt = floorLayout.getAnchorPoint(pendingNodeHitId, sketch.toAttachment.anchorIndex);
            if (pt) patch = { ...(patch ?? {}), to: pt };
          }
          if (patch) sketchLayer.update(sketch.id, patch);
        }
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
      } else if (pointerMode === 'apply-style') {
        if (isClick && armedEdgeStyleRef.current) {
          const edgeId = hitTestEdge(worldPoint);
          if (edgeId) onApplyEdgeStyleRef.current(edgeId, armedEdgeStyleRef.current);
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
      } else if (pointerMode === 'sketch-draw' && sketchDrawOrigin) {
        // A real drag only — a plain click while armed draws nothing,
        // same spirit as requiring an actual gesture for wiring.
        if (!isClick) {
          const toAnchorHit = hoveredAnchor && !hoveredAnchor.occupied ? hoveredAnchor : undefined;
          const finalTo = toAnchorHit ? toAnchorHit.point : (hoveredPathSnapPoint ?? worldPoint);
          const toAttachment = toAnchorHit ? { nodeId: toAnchorHit.nodeId, anchorIndex: toAnchorHit.anchorIndex } : null;
          onCreateSketchRef.current(sketchDrawOrigin, finalTo, sketchFromAttachment, toAttachment);
        }
      } else if (pointerMode === 'sketch-down' && isClick && pendingSketchHitId) {
        onSelectRef.current({ type: 'sketch', id: pendingSketchHitId });
      } else if (pointerMode === 'move' && pendingNodeHitId) {
        // The drag itself already committed the position on every
        // pointermove — this just leaves the moved node selected, so
        // the properties panel follows it.
        onSelectRef.current({ type: 'node', id: pendingNodeHitId });
      } else if (pointerMode === 'node-down' && isClick && pendingNodeHitId) {
        onSelectRef.current({ type: 'node', id: pendingNodeHitId });
      } else if (pointerMode === 'edge-down' && isClick && pendingEdgeHitId) {
        onSelectRef.current({ type: 'edge', id: pendingEdgeHitId });
      } else if (pointerMode === 'pan' && isClick) {
        onSelectRef.current(null);
      }

      pointerMode = 'idle';
      dragOriginScreen = null;
      dragLastScreen = null;
      pendingNodeHitId = undefined;
      pendingEdgeHitId = undefined;
      pendingSketchHitId = undefined;
      wireFromNodeId = undefined;
      wireCurrentWorld = undefined;
      wireFromAnchorIndex = undefined;
      hoveredAnchor = undefined;
      sketchDrawOrigin = undefined;
      sketchDrawCurrent = undefined;
      sketchFromAttachment = null;
      hoveredPathSnapPoint = undefined;
      wireGesture = false;
      moveLocked = false;
      moveGrabOffset = null;

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
    }
    function onHoverLeave(): void {
      onCursorWorldPositionChangeRef.current?.(null);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointermove', onHoverMove);
    canvas.addEventListener('pointerleave', onHoverLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

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
    };
    // Interaction props (selection, onSelect, placementKind,
    // onPlaceNode, onCreateEdge, snapToGrid, gridSpacing,
    // armedEdgeStyle, onApplyEdgeStyle) are intentionally excluded —
    // they're read through refs above so a click doesn't tear down
    // and recreate the SimEngine/driver. onRunningChange is invoked
    // through a ref too, for the same reason.
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
