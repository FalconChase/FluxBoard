import { useEffect, useRef, useState } from 'react';
import { Camera, type Viewport } from '../floor/camera';
import type { FloorLayout } from '../floor/floorLayout';
import { InterpolatedSimDriver } from '../floor/interpolatedSim';
import { GraphModel } from '../core/GraphModel';
import { SimEngine } from '../core/SimEngine';
import type { NodeDef } from '../core/types';
import type { Point } from '../floor/bezier';
import type { SkinConfig } from '../skin/SkinConfig';
import { drawNode } from '../skin/nodeSkin';
import { drawPathUnder, drawPathOver, drawItemToken, getItemRotation } from '../skin/pathSkin';

interface FluxCanvasProps {
  graph: GraphModel;
  floorLayout: FloorLayout;
  skinConfig: SkinConfig;
  /** Fixed logic-tick interval — decoupled from render frame rate
   * (design doc §5.1). */
  tickIntervalMs?: number;
}

const GRID_SPACING = 64;
const ITEM_RADIUS = 7;
const NODE_RADIUS = 22;
const ITEM_FILL = '#2ecc71';
const ITEM_STROKE = '#1c8a4f';

/**
 * Milestone 4: skin layer wired into the canvas (design doc §9 step 4)
 * — octagon node shapes with per-kind icons and unbounded counter
 * badges (§4.1, §4.5), nodes sorted by skin-owned z-order, and the
 * three-pass path render stack (skin-under -> item tokens -> skin-
 * over, §5.2) for conveyor/glass-tube/transparent edge styles with
 * static/parallel/circling item orientation (§5.3).
 *
 * Floor-layer geometry/camera (Milestone 2) and the full node
 * registry (Milestone 3) are unchanged by this — this file only
 * changes HOW things are painted, never where they are or what the
 * simulation does.
 */
export function FluxCanvas({ graph, floorLayout, skinConfig, tickIntervalMs = 400 }: FluxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef<InterpolatedSimDriver | null>(null);
  const [isRunning, setIsRunning] = useState(true);

  function toggleRunning(): void {
    const driver = driverRef.current;
    if (!driver) return;
    if (driver.isRunning()) {
      driver.pause();
    } else {
      driver.resume();
    }
    setIsRunning(driver.isRunning());
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const engine = new SimEngine(graph);
    const driver = new InterpolatedSimDriver(engine, tickIntervalMs);
    driverRef.current = driver;

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

      const viewport: Viewport = { width: canvas!.clientWidth, height: canvas!.clientHeight };
      ctx!.clearRect(0, 0, viewport.width, viewport.height);
      ctx!.fillStyle = '#faf9fb';
      ctx!.fillRect(0, 0, viewport.width, viewport.height);

      drawGrid(ctx!, camera, viewport);

      // Culling: only draw entities whose position intersects the
      // visible world rect (design doc §3 — virtualization).
      const bounds = camera.getVisibleWorldBounds(viewport, NODE_RADIUS * 4);

      // --- Three-pass path render stack (design doc §5.2) ---
      // Pass 1: skin-under for every edge (belt body / tube fill),
      // batched across all edges before any item is drawn.
      const edges = graph.getAllEdges();
      for (const edge of edges) {
        const curve = floorLayout.getEdgeCurve(edge.id);
        if (!curve) continue;
        const skin = skinConfig.getEdgeSkin(edge.id);
        const beltPhase = (elapsedMs / 1000) * edge.flowRate * curve.totalLength;
        drawPathUnder(ctx!, curve, camera, viewport, skin, beltPhase);
      }

      // Pass 2: item tokens — always drawn on the transparent movement
      // layer, regardless of the edge's style.
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

      // Pass 3: skin-over for every edge (tube boundary/highlight),
      // painted after items so a glass tube reads as translucent
      // around them. Empty for conveyor/transparent.
      for (const edge of edges) {
        const curve = floorLayout.getEdgeCurve(edge.id);
        if (!curve) continue;
        const skin = skinConfig.getEdgeSkin(edge.id);
        drawPathOver(ctx!, curve, camera, viewport, skin);
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
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    let dragStart: { x: number; y: number } | null = null;

    function onPointerDown(e: PointerEvent): void {
      dragStart = { x: e.clientX, y: e.clientY };
      canvas!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent): void {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      dragStart = { x: e.clientX, y: e.clientY };
      camera.pan(dx, dy);
    }
    function onPointerUp(e: PointerEvent): void {
      dragStart = null;
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
      const viewport: Viewport = { width: canvas!.clientWidth, height: canvas!.clientHeight };
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
  }, [graph, floorLayout, skinConfig, tickIntervalMs]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
      />
      <button
        type="button"
        onClick={toggleRunning}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          padding: '6px 14px',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          border: '1px solid ' + (isRunning ? '#d8555a' : '#2f8f57'),
          borderRadius: 6,
          background: isRunning ? '#ff5d5d' : '#2ecc71',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {isRunning ? '⏸ Hold' : '▶ Run'}
      </button>
    </div>
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, viewport: Viewport): void {
  const bounds = camera.getVisibleWorldBounds(viewport);
  const spacing = GRID_SPACING;
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
