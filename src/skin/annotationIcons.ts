/**
 * Small built-in icon glyph set for canvas annotations (app/
 * annotationLayer.ts — the INSERT tab's "icon/label overlay" concept,
 * scoped to free-floating markers, 2026-09-09). Same drawing
 * convention as nodeIcons.ts: simple vector paths centered at
 * (cx, cy) sized relative to `size`, filled/stroked by the caller's
 * chosen color rather than baking one in here — an annotation's color
 * is a per-kind display default (see ANNOTATION_ICON_COLOR below),
 * not a fixed part of the glyph.
 */

export type AnnotationIconDrawFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void;

/** Marker/pin — a classic map-pin teardrop. */
const marker: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const s = size;
  const r = s * 0.34;
  const tipY = cy + s * 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.1, r, Math.PI * 0.15, Math.PI * 0.85, true);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.1, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
};

/** Warning — a triangle with an exclamation mark. */
const warning: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.65);
  ctx.lineTo(cx + s * 0.62, cy + s * 0.5);
  ctx.lineTo(cx - s * 0.62, cy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  const prevFill = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - s * 0.08, cy - s * 0.28, s * 0.16, s * 0.42);
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.32, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = prevFill;
};

/** Info — a circle with an "i". */
const info: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const r = size * 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const prevFill = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.42, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - r * 0.14, cy - r * 0.08, r * 0.28, r * 0.62);
  ctx.fillStyle = prevFill;
};

/** Arrow — a directional pointer, e.g. "flow goes this way". */
const arrow: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.6;
  ctx.lineWidth = Math.max(1.5, size * 0.16);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.65, cy);
  ctx.lineTo(cx + s * 0.5, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.15, cy - s * 0.4);
  ctx.lineTo(cx + s * 0.65, cy);
  ctx.lineTo(cx + s * 0.15, cy + s * 0.4);
  ctx.closePath();
  ctx.fill();
};

/** Star — a 5-point star, e.g. "highlight this". */
const star: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const outerR = size * 0.55;
  const innerR = outerR * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
};

/** Flag — a small pennant on a pole, e.g. "milestone/checkpoint". */
const flag: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.6;
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.55, cy + s * 0.65);
  ctx.lineTo(cx - s * 0.55, cy - s * 0.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.55, cy - s * 0.62);
  ctx.lineTo(cx + s * 0.55, cy - s * 0.38);
  ctx.lineTo(cx - s * 0.55, cy - s * 0.14);
  ctx.closePath();
  ctx.fill();
};

export const annotationIcons: Record<'marker' | 'warning' | 'info' | 'arrow' | 'star' | 'flag', AnnotationIconDrawFn> = {
  marker,
  warning,
  info,
  arrow,
  star,
  flag,
};

/** A sensible default display color per icon kind — an annotation is
 * pure UI scratch with no logic-layer color config of its own (unlike
 * ObjectRegistry's per-type color), so this just keeps each kind
 * visually distinct out of the box. */
export const ANNOTATION_ICON_COLOR: Record<keyof typeof annotationIcons, string> = {
  marker: '#e0424a',
  warning: '#f5a524',
  info: '#3d7fff',
  arrow: '#7c3aed',
  star: '#eab308',
  flag: '#17b3a3',
};

export const ANNOTATION_ICON_LABEL: Record<keyof typeof annotationIcons, string> = {
  marker: 'Marker',
  warning: 'Warning',
  info: 'Info',
  arrow: 'Arrow',
  star: 'Star',
  flag: 'Flag',
};

export const ANNOTATION_ICON_ORDER: (keyof typeof annotationIcons)[] = ['marker', 'warning', 'info', 'arrow', 'star', 'flag'];
