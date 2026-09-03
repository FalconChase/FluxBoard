import { useEffect, useRef } from 'react';
import { Camera, type Viewport } from '../floor/camera';
import type { FloorLayout } from '../floor/floorLayout';
import { InterpolatedSimDriver } from '../floor/interpolatedSim';
import { GraphModel } from '../core/GraphModel';
import { SimEngine } from '../core/SimEngine';

interface FluxCanvasProps {
  graph: GraphModel;
  floorLayout: FloorLayout;
  /** Fixed logic-tick interval — decoupled from render frame rate
   * (design doc §5.1). */
  tickIntervalMs?: number;
}

const GRID_SPACING = 64;
const ITEM_RADIUS = 7;
const NODE_RADIUS = 18;

/**
 * Milestone 2: infinite canvas (pan/zoom/culling) rendering the current
 * item(s) on a "transparent"-style path (design doc §5.2 — transparent
 * is the base state, so no path skin is drawn, only the item tokens
 * themselves). Node markers here are schematic placeholders, not the
 * octagon/icon skin layer that lands later (§9, Milestones 3-4).
 */
export function FluxCanvas({ graph, floorLayout, tickIntervalMs = 400 }: FluxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const engine = new SimEngine(graph);
    const driver = new InterpolatedSimDriver(engine, tickIntervalMs);

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

      const viewport: Viewport = { width: canvas!.clientWidth, height: canvas!.clientHeight };
      ctx!.clearRect(0, 0, viewport.width, viewport.height);
      ctx!.fillStyle = '#faf9fb';
      ctx!.fillRect(0, 0, viewport.width, viewport.height);

      drawGrid(ctx!, camera, viewport);

      // Culling: only draw entities whose position intersects the
      // visible world rect (design doc §3 — virtualization).
      const bounds = camera.getVisibleWorldBounds(viewport, NODE_RADIUS * 4);

      for (const node of graph.getAllNodes()) {
        const pos = floorLayout.getNodePosition(node.id);
        if (!pos) continue;
        if (pos.x < bounds.minX || pos.x > bounds.maxX || pos.y < bounds.minY || pos.y > bounds.maxY) continue;

        const screen = camera.worldToScreen(pos, viewport);
        const r = NODE_RADIUS * camera.zoom;
        ctx!.beginPath();
        ctx!.arc(screen.x, screen.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = node.kind === 'source' ? '#3d7fff' : '#ff5d5d';
        ctx!.fill();
        ctx!.fillStyle = '#fff';
        ctx!.font = `${Math.max(8, 11 * camera.zoom)}px system-ui, sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(node.kind, screen.x, screen.y);
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
        const screen = camera.worldToScreen(worldPoint, viewport);
        const r = ITEM_RADIUS * camera.zoom;
        ctx!.beginPath();
        ctx!.arc(screen.x, screen.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = '#2ecc71';
        ctx!.fill();
        ctx!.strokeStyle = '#1c8a4f';
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
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
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [graph, floorLayout, tickIntervalMs]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
    />
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
