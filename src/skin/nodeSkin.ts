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
  merger: { fill: '#c026d3', stroke: '#9d1ba9', icon: nodeIcons.merger },
  sorter: { fill: '#8a5cf6', stroke: '#6a3fd1', icon: nodeIcons.sorter },
  mixer: { fill: '#17b3a3', stroke: '#128f83', icon: nodeIcons.mixer },
  buffer: { fill: '#6b7280', stroke: '#4b5158', icon: nodeIcons.buffer },
};

/**
 * A badge only makes sense on a node that actually HOLDS something —
 * a running lifetime tally on a pure pass-through node just grows
 * forever and doesn't describe its current state (Falcon, 2026-09-03:
 * source is unbounded by default so there's nothing worth counting
 * unless a future spawn limit is configured; sinks purely absorb/
 * destroy items, nothing to show; distributor/sorter/mixer route
 * items through in the same tick, they don't store anything either).
 * Buffer is the one kind that's genuinely a "silo" — it queues items
 * — so it's the only kind with a badge today, and it shows its LIVE
 * queue length (current holdings), not a lifetime counter.
 *
 * source.spawnedCount/sink.consumedCount/distributor+sorter.
 * routedCount/mixer.producedCount still exist in RuntimeState (tests
 * rely on them, and they're cheap to keep tracking for later use —
 * e.g. a future source spawn-limit badge) — this function just no
 * longer surfaces them as a badge. Returns undefined when the kind
 * has nothing to show, so the caller skips drawing a badge entirely.
 */
export function getBadgeCount(kind: NodeKind, state: RuntimeState): number | undefined {
  if (kind === 'buffer') {
    const queue = state.queue;
    return Array.isArray(queue) ? queue.length : undefined;
  }
  return undefined;
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

/** Lock badge (Milestone 5) — a small padlock glyph on the opposite
 * corner from the counter badge, drawn only when the node is locked.
 * Pure UI affordance, no logic/floor/skin meaning of its own. */
export function drawNodeLockBadge(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  zoom: number,
): void {
  const fontSize = Math.max(9, 11 * zoom);
  const bx = center.x - radius * 0.68;
  const by = center.y + radius * 0.68;

  ctx.beginPath();
  ctx.arc(bx, by, fontSize * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#6b6b73';
  ctx.lineWidth = Math.max(1, 1.2 * zoom);
  ctx.stroke();

  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3c3c43';
  ctx.fillText('\u{1F512}', bx, by + 0.5 * zoom);
}

/** Falcon, 2026-09-05, reverted the same day: tried per-anchor
 * green/red/grey role coloring on the node's own port dots (out/in/
 * free), then asked to put it back to the plain uniform dot. The
 * live red/green endpoint dots shown WHILE dragging a wire/sketch
 * (FluxCanvas's own ANCHOR_ROLE_COLOR) and the path-to-path visual
 * snap stayed — only this static per-node dot coloring was reverted. */
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
