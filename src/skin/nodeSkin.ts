import type { NodeDef, NodeKind } from '../core/types';
import type { RuntimeState } from '../core/NodeRuntimeState';
import type { Point } from '../floor/bezier';
import { octagonVertices, traceClosedPath, octagonPortAnchor, OCTAGON_PORT_COUNT } from './octagon';
import { nodeIcons } from './nodeIcons';
import { roundRectPath } from './canvasUtil';

/**
 * Per-node-kind visual defaults (design doc §4.5, §2 property table:
 * node icon/badge/z-order are Skin-owned — a cosmetic view of Logic
 * state, never a second source of truth for it).
 */
interface NodeSkinDefaults {
  fill: string;
  stroke: string;
  icon: (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void;
}

export const nodeSkinDefaults: Record<NodeKind, NodeSkinDefaults> = {
  source: { fill: '#3d7fff', stroke: '#2a5fd0', icon: nodeIcons.source },
  sink: { fill: '#ff5d5d', stroke: '#d8393f', icon: nodeIcons.sink },
  distributor: { fill: '#f2a93c', stroke: '#c9821e', icon: nodeIcons.distributor },
  sorter: { fill: '#8a5cf6', stroke: '#6a3fd1', icon: nodeIcons.sorter },
  mixer: { fill: '#17b3a3', stroke: '#128f83', icon: nodeIcons.mixer },
  buffer: { fill: '#6b7280', stroke: '#4b5158', icon: nodeIcons.buffer },
};

/**
 * Reads the one existing logic-layer counter each node kind already
 * tracks in its own runtime state (source.spawnedCount,
 * distributor/sorter.routedCount, mixer.producedCount,
 * sink.consumedCount, buffer's live queue length) — never computes a
 * new count itself, since the badge is a *view* of logic state, not a
 * second tally of it (design doc §2, §4.5).
 *
 * Returns undefined when the kind has nothing countable yet, so the
 * caller skips drawing a badge entirely rather than showing "0" for
 * something that was never spawned.
 */
export function getBadgeCount(kind: NodeKind, state: RuntimeState): number | undefined {
  switch (kind) {
    case 'source':
      return typeof state.spawnedCount === 'number' ? state.spawnedCount : undefined;
    case 'sink':
      return typeof state.consumedCount === 'number' ? state.consumedCount : undefined;
    case 'distributor':
    case 'sorter':
      return typeof state.routedCount === 'number' ? state.routedCount : undefined;
    case 'mixer':
      return typeof state.producedCount === 'number' ? state.producedCount : undefined;
    case 'buffer': {
      const queue = state.queue;
      return Array.isArray(queue) ? queue.length : undefined;
    }
    default:
      return undefined;
  }
}

/** Badge is a pill overlaid ON TOP of the icon — not exclusive with it
 * (design doc §4.5: "under/over layering pattern the path skin stack
 * already uses"). Genuinely unbounded: sized by measured text width,
 * no digit cap, no "999+" truncation. */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  count: number,
  zoom: number,
  accentColor: string,
): void {
  const text = String(count);
  const fontSize = Math.max(8, 10 * zoom);
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const paddingX = 5 * zoom;
  const height = fontSize + 5 * zoom;
  const width = Math.max(height, textWidth + paddingX * 2);
  const bx = center.x + radius * 0.68;
  const by = center.y - radius * 0.68;

  roundRectPath(ctx, bx - width / 2, by - height / 2, width, height, height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.3 * zoom);
  ctx.strokeStyle = accentColor;
  ctx.stroke();

  ctx.fillStyle = '#1c1c1e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx, by + 0.5 * zoom);
}

/**
 * Draws one node: octagon body (design doc §4.1) + faint port-socket
 * hints at the 8 edge midpoints (not interactive until Milestone 5) +
 * icon (skin-under) + counter badge (skin-over) — the same
 * under/over layering the path skin stack uses (§5.2).
 *
 * `center`/`radius` are already in screen space (camera-projected) —
 * this function has no floor-layer knowledge of its own.
 */
/** Selection ring (Milestone 5) — drawn as an extra pass OUTSIDE the
 * node body, purely a UI affordance with no logic/floor meaning of
 * its own. Kept separate from drawNode so the canvas decides whether
 * to call it, rather than baking "am I selected" into the node's own
 * draw call. */
export function drawNodeSelectionRing(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  zoom: number,
): void {
  const verts = octagonVertices(center, radius + 5 * zoom);
  traceClosedPath(ctx, verts);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = Math.max(1.5, 2.5 * zoom);
  ctx.setLineDash([Math.max(3, 4 * zoom), Math.max(2, 3 * zoom)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawNode(
  ctx: CanvasRenderingContext2D,
  node: NodeDef,
  state: RuntimeState,
  center: Point,
  radius: number,
  zoom: number,
): void {
  const skin = nodeSkinDefaults[node.kind];

  const verts = octagonVertices(center, radius);
  traceClosedPath(ctx, verts);
  ctx.fillStyle = skin.fill;
  ctx.fill();
  ctx.strokeStyle = skin.stroke;
  ctx.lineWidth = Math.max(1, 1.5 * zoom);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let p = 0; p < OCTAGON_PORT_COUNT; p++) {
    const anchor = octagonPortAnchor(center, radius, p);
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, Math.max(1, 1.4 * zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  skin.icon(ctx, center.x, center.y, radius * 0.92);

  const count = getBadgeCount(node.kind, state);
  if (count !== undefined) {
    drawBadge(ctx, center, radius, count, zoom, skin.stroke);
  }
}
