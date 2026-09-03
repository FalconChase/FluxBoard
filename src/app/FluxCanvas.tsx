import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Camera, type Viewport } from '../floor/camera';
import { NODE_RADIUS, type FloorLayout } from '../floor/floorLayout';
import { InterpolatedSimDriver } from '../floor/interpolatedSim';
import { GraphModel } from '../core/GraphModel';
import { SimEngine } from '../core/SimEngine';
import type { EdgeDef, EdgeId, NodeDef, NodeId, NodeKind } from '../core/types';
import type { Point } from '../floor/bezier';
import type { SkinConfig } from '../skin/SkinConfig';
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
import { SketchLayer } from './sketchLayer';

interface FluxCanvasProps {
  graph: GraphModel;
  floorLayout: FloorLayout;
  skinConfig: SkinConfig;
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
   * Simple body-to-body for now — see FBP009 for why this isn't
   * per-socket yet. Ports/flowRate/gate are then tuned in the
   * properties panel. Plain drag (no Shift) MOVES the node instead —
   * see the pointer state machine below. */
  onCreateEdge: (sourceNodeId: NodeId, targetNodeId: NodeId) => void;
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
   * — pure visual scratch lines, not real GraphModel edges. Mutated
   * directly like graph/floorLayout/skinConfig, so adding one doesn't
   * need to re-run this component's setup effect. */
  sketchLayer: SketchLayer;
  /** When true, the next drag ANYWHERE on the canvas (node or empty
   * space, doesn't matter — a sketch has no real endpoints) draws a
   * new sketch instead of doing anything else (armed by PathPalette,
   * mirrors placementKind/armedEdgeStyle's arm-then-act flow). */
  sketchArmed: boolean;
  onCreateSketch: (from: Point, to: Point) => void;
}

/** Imperative handle (App.tsx's Play/Pause button lives in the bottom
 * bar, outside this component, but the sim driver it controls is only
 * ever created inside FluxCanvas's own effect). */
export interface FluxCanvasHandle {
  toggleRunning: () => void;
}

const ITEM_RADIUS = 7;
const ITEM_FILL = '#2ecc71';
const ITEM_STROKE = '#1c8a4f';
const CLICK_MOVE_THRESHOLD_PX = 5;
const EDGE_HIT_TOLERANCE_PX = 12;

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
    tickIntervalMs = 400,
    selection,
    onSelect,
    placementKind,
    onPlaceNode,
    onCreateEdge,
    snapToGrid,
    gridSpacing,
    armedEdgeStyle,
    onApplyEdgeStyle,
    onRunningChange,
    sketchLayer,
    sketchArmed,
    onCreateSketch,
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
      ctx!.fillStyle = '#faf9fb';
      ctx!.fillRect(0, 0, viewport.width, viewport.height);

      drawGrid(ctx!, camera, viewport, gridSpacingRef.current);

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
      }
      if (pointerMode === 'sketch-draw' && sketchDrawOrigin && sketchDrawCurrent) {
        const a = camera.worldToScreen(sketchDrawOrigin, viewport);
        const b = camera.worldToScreen(sketchDrawCurrent, viewport);
        ctx!.save();
        ctx!.setLineDash([7, 5]);
        ctx!.strokeStyle = 'rgba(124, 58, 237, 0.7)';
        ctx!.lineWidth = Math.max(1.5, 2 * camera.zoom);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
        ctx!.restore();
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
        drawItemToken(ctx!, screen, ITEM_RADIUS * camera.zoom, rotation, ITEM_FILL, ITEM_STROKE);
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
          const a = camera.worldToScreen(fromPos, viewport);
          const b = camera.worldToScreen(wireCurrentWorld, viewport);
          ctx!.save();
          ctx!.setLineDash([6, 4]);
          ctx!.strokeStyle = 'rgba(37, 99, 235, 0.7)';
          ctx!.lineWidth = Math.max(1.5, 2 * camera.zoom);
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
          ctx!.restore();
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
    let sketchDrawOrigin: Point | undefined;
    let sketchDrawCurrent: Point | undefined;
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
        sketchDrawOrigin = worldPoint;
        sketchDrawCurrent = worldPoint;
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
      }

      if (pointerMode === 'sketch-draw') {
        sketchDrawCurrent = toWorld(e.clientX, e.clientY);
      }

      if (pointerMode === 'move' && pendingNodeHitId && moveGrabOffset) {
        const currentWorld = toWorld(e.clientX, e.clientY);
        const rawPos = { x: currentWorld.x - moveGrabOffset.x, y: currentWorld.y - moveGrabOffset.y };
        floorLayout.setNodePosition(pendingNodeHitId, snapToGridPoint(rawPos));
        for (const edge of edgesTouchingNode(pendingNodeHitId)) {
          floorLayout.recomputeEdgeCurve(edge.id, edge.source, edge.target);
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
        const targetNodeId = hitTestNode(worldPoint);
        if (targetNodeId && targetNodeId !== wireFromNodeId) {
          onCreateEdgeRef.current(wireFromNodeId, targetNodeId);
        }
      } else if (pointerMode === 'sketch-draw' && sketchDrawOrigin) {
        // A real drag only — a plain click while armed draws nothing,
        // same spirit as requiring an actual gesture for wiring.
        if (!isClick) {
          onCreateSketchRef.current(sketchDrawOrigin, worldPoint);
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
      sketchDrawOrigin = undefined;
      sketchDrawCurrent = undefined;
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

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      driverRef.current = null;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
    // Interaction props (selection, onSelect, placementKind,
    // onPlaceNode, onCreateEdge, snapToGrid, gridSpacing,
    // armedEdgeStyle, onApplyEdgeStyle) are intentionally excluded —
    // they're read through refs above so a click doesn't tear down
    // and recreate the SimEngine/driver. onRunningChange is invoked
    // through a ref too, for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, floorLayout, skinConfig, tickIntervalMs]);

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

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, viewport: Viewport, spacing: number): void {
  const bounds = camera.getVisibleWorldBounds(viewport);
  const startX = Math.floor(bounds.minX / spacing) * spacing;
  const startY = Math.floor(bounds.minY / spacing) * spacing;

  ctx.strokeStyle = '#eceaf0';
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
