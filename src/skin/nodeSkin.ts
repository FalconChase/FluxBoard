import type { NodeDef, NodeKind } from '../core/types';
import type { RuntimeState } from '../core/NodeRuntimeState';
import type { Point } from '../floor/bezier';
import { octagonVertices, traceClosedPath, octagonPortAnchor, OCTAGON_PORT_COUNT } from './octagon';
import { nodeIcons } from './nodeIcons';
import { roundRectPath, darkenHex } from './canvasUtil';
import { annotationIcons, ANNOTATION_ICON_COLOR, ANNOTATION_DEFAULT_FONT_FAMILY } from './annotationIcons';
import type { NodeIconSkin } from './SkinConfig';
import { NODE_RADIUS } from '../floor/floorLayout';

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
  // Trigger system (design doc §4.8, 2026-09-09): a valve-amber Gate
  // and a signal-blue Sensor, both distinct from every color above.
  gate: { fill: '#eab308', stroke: '#a16207', icon: nodeIcons.gate },
  sensor: { fill: '#0ea5e9', stroke: '#0369a1', icon: nodeIcons.sensor },
  // Counter (2026-09-10) — tally green, distinct from every kind above
  // (and readable next to sensor-blue/gate-amber on a graph that wires
  // all three together).
  counter: { fill: '#22c55e', stroke: '#15803d', icon: nodeIcons.counter },
  // Command (2026-09-10 follow-up) — indigo/violet, distinct from
  // every kind above including sensor-blue/gate-amber/counter-green,
  // the three kinds it most often sits between on a graph.
  command: { fill: '#6366f1', stroke: '#4338ca', icon: nodeIcons.command },
  // Transform (2026-09-10, "now i want to introduce the transform
  // node") — rose pink, distinct from every kind above.
  transform: { fill: '#ec4899', stroke: '#be185d', icon: nodeIcons.transform },
  // Time (design doc trigger-system finalization, 2026-09-11) — lime
  // green, the one genuinely free gap on the hue wheel between gate's
  // amber and counter's green, so it never gets mistaken for either
  // of the two kinds it most often sits near (Command mediates both
  // Gate and Time, and a Sensor can watch either).
  time: { fill: '#84cc16', stroke: '#4d7c0f', icon: nodeIcons.time },
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
 * — so it shows its LIVE queue length (current holdings), not a
 * lifetime counter.
 *
 * Counter (2026-09-10) is the one deliberate exception to "no lifetime
 * tally" above: for THIS kind a running lifetime count is the entire
 * point (Falcon: "it only counts what pass to it"), not a side effect
 * to hide — so its badge shows `state.count` directly, same live-
 * runtime-state mechanism as Buffer's, just a growing tally instead of
 * a current-holdings snapshot. It's also the only UI surface this
 * count gets — see counter.ts's own doc comment — reset via
 * PropertiesPanel's "Reset count" button (counter.ts's onTick).
 *
 * source.spawnedCount/sink.consumedCount/distributor+sorter.
 * routedCount/mixer.producedCount still exist in RuntimeState (tests
 * rely on them, and they're cheap to keep tracking for later use) —
 * this function just doesn't surface most of them as a badge.
 *
 * source (2026-09-10 follow-up — Falcon: "i want the source node to
 * have a set or limited spawn feature like a switch"): the one other
 * deliberate exception, alongside Counter, and only once that switch
 * (config.spawnLimitEnabled) is actually on — an unlimited Source (the
 * default, and every graph saved before this feature existed) shows no
 * badge at all, same as before. Once limited, this is a countdown of
 * spawns REMAINING (`config.spawnLimit` minus `state.spawnedCount`,
 * floored at 0), not a growing tally — Falcon, same session: "i want it
 * to show like countdown of or diminishing" (an earlier "count/limit"
 * string form, e.g. "5/10", read as ascending and didn't land). Reaches
 * 0 exactly when SimEngine.sourceCanSpawnThisTick stops it for good.
 *
 * Returns undefined when the kind (or an unlimited Source) has nothing
 * to show, so the caller skips drawing a badge entirely. Takes the
 * full NodeDef, not just its kind, because the Source case needs to
 * read `node.config` — Buffer/Counter still only ever look at `state`. */
export function getBadgeCount(node: NodeDef, state: RuntimeState): number | string | undefined {
  if (node.kind === 'buffer') {
    const queue = state.queue;
    return Array.isArray(queue) ? queue.length : undefined;
  }
  if (node.kind === 'counter') {
    const count = state.count;
    return typeof count === 'number' ? count : 0;
  }
  if (node.kind === 'source' && node.config.spawnLimitEnabled === true) {
    const spawnedCount = typeof state.spawnedCount === 'number' ? state.spawnedCount : 0;
    const limit = typeof node.config.spawnLimit === 'number' ? node.config.spawnLimit : 0;
    return Math.max(0, limit - spawnedCount);
  }
  // Time (design doc trigger-system finalization, 2026-09-11) — a 3rd
  // deliberate exception alongside Counter/limited-Source: its live
  // clock reading (`state.value`, time.ts's onTick) IS the point of
  // watching this node at all, same "this badge is its only UI
  // surface" reasoning Counter's tally already has. One decimal place
  // (unlike Counter's bare integer tally) since this is a continuous
  // real-world-seconds read, not a discrete arrival count.
  if (node.kind === 'time') {
    const value = typeof state.value === 'number' ? state.value : 0;
    return value.toFixed(1);
  }
  return undefined;
}

/** Badge is a pill overlaid ON TOP of the icon — not exclusive with it
 * (design doc §4.5: "under/over layering pattern the path skin stack
 * already uses"). Genuinely unbounded: sized by measured text width,
 * no digit cap, no "999+" truncation. `count` also accepts a pre-
 * formatted string (2026-09-10 follow-up, for Source's "spawned/limit"
 * badge above) — a bare number is still just stringified same as ever. */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  count: number | string,
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
  iconOverride?: NodeIconSkin,
  /** Falcon, 2026-09-09 ("to easily identify a deactivated node it
   * will have a dim color"; 2026-09-10, correcting the first attempt —
   * "it seems that the deactivated node was kind of transparent
   * instead of darken only"): a Source sitting at `active === false`
   * (manually off, or auto-paused because its path filled up) draws
   * DARKER, not see-through. The first version used `globalAlpha`,
   * which fades toward whatever's BEHIND the node (the grid showed
   * through) — wrong effect for "dim color". `ctx.filter =
   * 'brightness(...)'` scales each drawn pixel's own RGB down while
   * leaving its alpha alone, so a fully-opaque fill stays fully
   * opaque, just darker — exactly "dim color", not "fade out". Same
   * one-line-wrap shape as before: every per-kind skin (fill/stroke/
   * icon) still renders exactly as-is underneath, just darkened, no
   * second color table to keep in sync with nodeSkinDefaults.
   * FluxCanvas decides WHEN this is true; drawNode only knows how to
   * render it. */
  dimmed?: boolean,
): void {
  const skin = nodeSkinDefaults[node.kind];

  ctx.save();
  if (dimmed) ctx.filter = 'brightness(0.55)';

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

  // Falcon, 2026-09-09 ("add icon on the node properties with the
  // same configuration ... attach together the node and the icon"):
  // an opt-in built-in-icon override, drawn ON TOP of the node's own
  // octagon body in place of the kind's plain default glyph -- same
  // Size/Badge/Badge-color shape the annotation Icon panel uses, so
  // there's nothing new to learn. Falls through to the kind default
  // whenever no override is set.
  if (iconOverride) {
    const iconSize = iconOverride.iconSize ?? NODE_RADIUS;
    const r = iconSize * zoom * 0.5;
    if (iconOverride.badge) {
      const badgeColor = iconOverride.badgeColor ?? '#ffffff';
      ctx.beginPath();
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      ctx.strokeStyle = darkenHex(badgeColor, 0.25);
      ctx.lineWidth = Math.max(1, 1.5 * zoom);
      ctx.stroke();
    }
    ctx.fillStyle = ANNOTATION_ICON_COLOR[iconOverride.icon];
    ctx.strokeStyle = ANNOTATION_ICON_COLOR[iconOverride.icon];
    annotationIcons[iconOverride.icon](ctx, center.x, center.y, r * 1.6);
    if (iconOverride.label) {
      const fontSize = Math.max(4, (iconOverride.fontSize ?? 14) * zoom);
      const weight = iconOverride.bold ? '700' : '600';
      const style = iconOverride.italic ? 'italic ' : '';
      const family = iconOverride.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY;
      ctx.font = `${style}${weight} ${fontSize}px ${family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelY = center.y + Math.max(r, radius) + 4;
      const metrics = ctx.measureText(iconOverride.label);
      const padX = 4;
      const padY = 2;
      const lineH = fontSize + padY * 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(center.x - metrics.width / 2 - padX, labelY - 1, metrics.width + padX * 2, lineH);
      ctx.fillStyle = iconOverride.color ?? '#1f2430';
      ctx.fillText(iconOverride.label, center.x, labelY);
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    skin.icon(ctx, center.x, center.y, radius * 0.92);
  }

  const count = getBadgeCount(node, state);
  if (count !== undefined) {
    drawBadge(ctx, center, radius, count, zoom, skin.stroke);
  }

  ctx.restore();
}
