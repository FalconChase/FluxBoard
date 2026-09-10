import type { EdgePath } from '../floor/bezier';
import type { Point } from '../floor/bezier';
import type { Camera, Viewport } from '../floor/camera';
import { hexWithAlpha, roundRectPath } from './canvasUtil';
import type { ObjectShape } from './ObjectRegistry';
import { annotationIcons, type AnnotationIconKind } from './annotationIcons';

/** Skin-owned edge style (design doc §5.2, §5.4). "Transparent" is not
 * a distinct style in its own right — it's the base state with no
 * skin applied on top of the always-present, style-agnostic item
 * movement layer. 'trace' (Falcon, 2026-09-04, comparing the ribbon
 * port against the approved mockup): a thin single line with the
 * path's own color, no belt/tube band at all — the clean PCB-trace
 * look the mockup's paths used, now a real selectable style rather
 * than an artifact of how that mockup happened to render. */
export type EdgeStyle = 'transparent' | 'conveyor' | 'glassTube' | 'trace' | 'copper';

/** Copper (design doc §5.5, 2026-09-09 follow-up): the visual identity
 * for a Sensor's signal path — the render-side half of the glow that
 * §5.5 originally deferred ("visual treatment ... explicitly deferred
 * to a later Skin-layer pass"). Falcon: "it will only glow so grey
 * orange when no pulse but light orange when triggered" — direction-
 * agnostic, so App.tsx's wiring rule (only a Sensor/Gate on both ends)
 * is what actually restricts where this style is used, not the color
 * itself. Exported so a swatch preview (Ribbon/PropertiesPanel) can't
 * visually drift from the real render, same convention as every other
 * style's colors. */
export const COPPER_IDLE_COLOR = '#9c8267';
export const COPPER_TRIGGERED_COLOR = '#ff9d3d';

/** Skin-owned item orientation mode (design doc §5.3) — edge-owned for
 * v1, not item-owned. */
export type ItemOrientationMode = 'static' | 'parallel' | 'circling';

export interface EdgeSkin {
  style: EdgeStyle;
  color: string;
  /** World-space width of the path's visual band. */
  strokeWidth: number;
  itemOrientation: ItemOrientationMode;
  /** Radians/sec — only used by 'circling' orientation. */
  spinSpeed: number;
}

export const defaultEdgeSkin: EdgeSkin = {
  style: 'transparent',
  color: '#8a8a93',
  strokeWidth: 10,
  itemOrientation: 'static',
  spinSpeed: 2.4,
};

function strokeCurve(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
  lineWidth: number,
  color: string,
  sampleCount = 40,
): void {
  if (curve.totalLength === 0 || lineWidth <= 0) return;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= sampleCount; i++) {
    const p = curve.getPointAtProgress(i / sampleCount);
    const s = camera.worldToScreen(p, viewport);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
}

/** Strokes a curve offset perpendicular to its own tangent at every
 * sample — the glass-tube boundary lines run parallel to the curve,
 * not along it. */
function strokeCurveOffset(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
  offset: number,
  lineWidth: number,
  color: string,
  sampleCount = 40,
): void {
  if (curve.totalLength === 0) return;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const p = curve.getPointAtProgress(t);
    const angle = curve.getTangentAngleAtProgress(t);
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const offsetPoint: Point = { x: p.x + nx * offset, y: p.y + ny * offset };
    const s = camera.worldToScreen(offsetPoint, viewport);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
}

/** Perpendicular tick marks along the belt, offset by `phaseDistance`
 * (world units) so they scroll — the "animated dash" conveyor look
 * (design doc §5.2 table). `phaseDistance` is expected to grow over
 * time at the edge's own flow speed, so the ticks appear to travel
 * with the items riding the belt. */
function drawConveyorTicks(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
  skin: EdgeSkin,
  phaseDistance: number,
): void {
  if (curve.totalLength === 0) return;
  const zoom = camera.zoom;
  const spacing = Math.max(10, skin.strokeWidth * 1.4);
  const tickLen = skin.strokeWidth * 0.9;

  ctx.strokeStyle = hexWithAlpha(skin.color, 0.55);
  ctx.lineWidth = Math.max(1, 2 * zoom);
  ctx.beginPath();

  let dist = ((phaseDistance % spacing) + spacing) % spacing;
  while (dist < curve.totalLength) {
    const progress = dist / curve.totalLength;
    const p = curve.getPointAtProgress(progress);
    const angle = curve.getTangentAngleAtProgress(progress);
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const a = camera.worldToScreen({ x: p.x + (nx * tickLen) / 2, y: p.y + (ny * tickLen) / 2 }, viewport);
    const b = camera.worldToScreen({ x: p.x - (nx * tickLen) / 2, y: p.y - (ny * tickLen) / 2 }, viewport);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    dist += spacing;
  }
  ctx.stroke();
}

/**
 * Skin-under pass (design doc §5.2 render order, step 1): belt body /
 * tube fill. Drawn BEFORE item tokens, so items sit visually on top of
 * it. Empty for 'transparent'.
 */
export function drawPathUnder(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
  skin: EdgeSkin,
  beltPhaseDistance: number,
  /** Copper only (design doc §5.5) — true while the Sensor at either
   * end of this edge last evaluated its condition as true. Ignored by
   * every other style; defaults false so every pre-existing call site
   * (none of which know about copper) keeps rendering exactly as
   * before. */
  copperTriggered = false,
): void {
  const zoom = camera.zoom;
  if (skin.style === 'conveyor') {
    strokeCurve(ctx, curve, camera, viewport, skin.strokeWidth * zoom, hexWithAlpha(skin.color, 0.28));
    drawConveyorTicks(ctx, curve, camera, viewport, skin, beltPhaseDistance);
  } else if (skin.style === 'glassTube') {
    strokeCurve(ctx, curve, camera, viewport, skin.strokeWidth * zoom, hexWithAlpha(skin.color, 0.16));
  } else if (skin.style === 'trace') {
    // Deliberately ignores skin.strokeWidth (that's a belt/tube BAND
    // width — a trace is always a thin line regardless of what a
    // conveyor/glassTube on the same edge was last configured to) and
    // uses the color at full opacity, not hexWithAlpha, so it reads
    // crisp at any zoom.
    strokeCurve(ctx, curve, camera, viewport, Math.max(1.5, 2.2 * zoom), skin.color);
  } else if (skin.style === 'copper') {
    // Same thin-line treatment as 'trace' (ignores skin.color/
    // strokeWidth entirely — copper's whole point is the fixed idle/
    // triggered glow, not a user-picked color), just swapping which
    // fixed color it draws based on the connected Sensor's last
    // evaluated condition.
    const color = copperTriggered ? COPPER_TRIGGERED_COLOR : COPPER_IDLE_COLOR;
    strokeCurve(ctx, curve, camera, viewport, Math.max(2, 2.6 * zoom), color);
  }
  // 'transparent': nothing drawn — the base state (§5.2).
}

/**
 * Skin-over pass (design doc §5.2 render order, step 3): tube
 * boundary/highlight lines, painted AFTER item tokens so a glass tube
 * reads as translucent around the items inside it. Empty for
 * 'conveyor' and 'transparent' (items sit fully on top of those).
 */
export function drawPathOver(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
  skin: EdgeSkin,
): void {
  if (skin.style !== 'glassTube') return;
  const zoom = camera.zoom;
  const half = (skin.strokeWidth / 2) * zoom;
  const lineWidth = Math.max(1, 1.5 * zoom);
  const highlight = hexWithAlpha(skin.color, 0.65);
  strokeCurveOffset(ctx, curve, camera, viewport, skin.strokeWidth / 2, lineWidth, highlight);
  strokeCurveOffset(ctx, curve, camera, viewport, -skin.strokeWidth / 2, lineWidth, highlight);
  void half; // half kept for reference/future use (e.g. end caps)
}

/** Edge selection highlight (Milestone 5) — a bright overlay stroke
 * along the curve, drawn on top of everything else so it reads
 * regardless of the edge's own style (including 'transparent', which
 * otherwise draws nothing at all). Pure UI affordance, no skin-layer
 * meaning of its own. */
export function drawCurveSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
): void {
  strokeCurve(ctx, curve, camera, viewport, Math.max(2, 4 * camera.zoom), 'rgba(37, 99, 235, 0.55)');
}

/** A small directional arrowhead at a path's midpoint, drawn
 * regardless of style — even 'transparent', which otherwise renders
 * nothing at all (Falcon, 2026-09-03: a path's direction should read
 * at a glance, not only by watching an item travel it, especially
 * while paused or empty). Points along the curve's own tangent, so it
 * automatically flips if the path is ever recreated in the other
 * direction — no separate "reverse" state to keep in sync. */
export function drawPathDirectionArrow(
  ctx: CanvasRenderingContext2D,
  curve: EdgePath,
  camera: Camera,
  viewport: Viewport,
): void {
  if (curve.totalLength === 0) return;
  const progress = 0.5;
  const worldPoint = curve.getPointAtProgress(progress);
  const angle = curve.getTangentAngleAtProgress(progress);
  const screen = camera.worldToScreen(worldPoint, viewport);
  const size = Math.max(5, 7 * camera.zoom);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.62);
  ctx.lineTo(-size * 0.6, -size * 0.62);
  ctx.closePath();
  ctx.fillStyle = 'rgba(58, 58, 66, 0.6)';
  ctx.fill();
  ctx.restore();
}

/** Docking's visual "something in between" (design doc §5.6,
 * 2026-09-09 — Falcon: "there will be something in between the node
 * to indicate that they are docked"): a small connector plate at a
 * dock edge's midpoint, filling the few-world-unit gap
 * FloorLayout.dockedPosition deliberately leaves between the two
 * touching octagons (their own edges meet at the smaller apothem
 * distance; docking uses the same 2×NODE_RADIUS boundary
 * wouldOverlap treats as "not overlapping," which sits slightly
 * farther out). Drawn instead of the normal conveyor/glass-tube
 * render stack for a `edgeKind: 'dock'` edge — FluxCanvas's render
 * loop skips drawPathUnder/drawPathOver/the direction arrow for
 * those entirely, since a dock isn't a path the user drew, it's a
 * structural joint between two nodes acting "like a single unit." */
export function drawDockSeam(ctx: CanvasRenderingContext2D, curve: EdgePath, camera: Camera, viewport: Viewport): void {
  const worldPoint = curve.getPointAtProgress(0.5);
  const angle = curve.totalLength > 0 ? curve.getTangentAngleAtProgress(0.5) : 0;
  const screen = camera.worldToScreen(worldPoint, viewport);
  const halfLength = Math.max(4, 6 * camera.zoom);
  const halfWidth = Math.max(2, 3 * camera.zoom);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(angle + Math.PI / 2); // perpendicular to the docking direction, like a weld seam
  roundRectPath(ctx, -halfLength, -halfWidth, halfLength * 2, halfWidth * 2, halfWidth * 0.6);
  ctx.fillStyle = '#6b7280';
  ctx.fill();
  ctx.strokeStyle = '#3f4552';
  ctx.lineWidth = Math.max(1, camera.zoom);
  ctx.stroke();
  ctx.restore();
}

/** Rotation (radians) for an item token riding a path under the given
 * orientation mode (design doc §5.3). */
export function getItemRotation(
  mode: ItemOrientationMode,
  curve: EdgePath,
  progress: number,
  elapsedMs: number,
  spinSpeed: number,
): number {
  switch (mode) {
    case 'static':
      return 0;
    case 'parallel':
      return curve.getTangentAngleAtProgress(progress);
    case 'circling':
      return (elapsedMs / 1000) * spinSpeed;
    default:
      return 0;
  }
}

/** Item tokens are always drawn on the transparent movement layer,
 * regardless of path style (design doc §5.2 render order, step 2) — a
 * small circular body plus a directional "nose" so rotation actually
 * reads visually under 'parallel'/'circling' orientation. */
export function drawItemToken(
  ctx: CanvasRenderingContext2D,
  screen: Point,
  radius: number,
  rotation: number,
  fillColor: string,
  strokeColor: string,
  shape: ObjectShape = 'circle',
  icon?: AnnotationIconKind,
): void {
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(rotation);

  // Falcon, 2026-09-09 ("icons along the path also"): an icon-shaped
  // object draws one of the built-in annotation glyphs instead of a
  // plain geometric body -- no fill/stroke body and no directional
  // "nose" (the glyph itself is the visual identity; a nose arrow
  // fighting a money icon would just look cluttered), just the icon
  // recolored with the object type's own fill color, same "recolor
  // the icon" choice Falcon made for this feature. Rotation still
  // applies via the ctx.rotate above, same as every other shape.
  if (shape === 'icon') {
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor;
    annotationIcons[icon ?? 'marker'](ctx, 0, 0, radius * 1.8);
    ctx.restore();
    return;
  }

  ctx.beginPath();
  if (shape === 'square') {
    // Slightly smaller than `radius` so a square token reads as
    // roughly the same visual footprint as a circle of the same
    // registry `size` (ObjectRegistry.ts), not visibly larger.
    const half = radius * 0.86;
    ctx.rect(-half, -half, half * 2, half * 2);
  } else if (shape === 'triangle') {
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius * 0.87, radius * 0.62);
    ctx.lineTo(-radius * 0.87, radius * 0.62);
    ctx.closePath();
  } else {
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
  }
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Directional "nose" — kept identical across every shape (design
  // doc §5.3: rotation needs to read visually regardless of body
  // shape), small enough not to fight a square or triangle body.
  ctx.beginPath();
  ctx.moveTo(radius * 0.9, 0);
  ctx.lineTo(radius * 0.1, radius * 0.55);
  ctx.lineTo(radius * 0.1, -radius * 0.55);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();
}
