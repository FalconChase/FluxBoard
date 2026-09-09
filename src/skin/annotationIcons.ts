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

/** Money — baked in from a pasted duotone SVG icon (Falcon, 2026-09-09,
 * iconbuddy.com "money" glyph), rather than hand-drawn like the other
 * six above. Path2D lets the exact bezier/arc outlines from the
 * original SVG (viewBox 0 0 256 256) render as-is on canvas -- the
 * background shape keeps the source SVG's 20% opacity ("duotone"
 * shading), the foreground shape is drawn at full alpha on top. Scaled
 * uniformly from the 256x256 viewBox down to `size` and re-centered on
 * (cx, cy), same call signature as every other icon here. */
const MONEY_BG_PATH = new Path2D(
  'M160 128a32 32 0 1 1-32-32a32 32 0 0 1 32 32m40-64a48.85 48.85 0 0 0 40 40V64Zm0 128h40v-40a48.85 48.85 0 0 0-40 40M16 152v40h40a48.85 48.85 0 0 0-40-40m0-48a48.85 48.85 0 0 0 40-40H16Z',
);
const MONEY_FG_PATH = new Path2D(
  'M128 88a40 40 0 1 0 40 40a40 40 0 0 0-40-40m0 64a24 24 0 1 1 24-24a24 24 0 0 1-24 24m112-96H16a8 8 0 0 0-8 8v128a8 8 0 0 0 8 8h224a8 8 0 0 0 8-8V64a8 8 0 0 0-8-8M24 72h21.37A40.8 40.8 0 0 1 24 93.37Zm0 112v-21.37A40.8 40.8 0 0 1 45.37 184Zm208 0h-21.37A40.8 40.8 0 0 1 232 162.63Zm0-38.35A56.78 56.78 0 0 0 193.65 184H62.35A56.78 56.78 0 0 0 24 145.65v-35.3A56.78 56.78 0 0 0 62.35 72h131.3A56.78 56.78 0 0 0 232 110.35Zm0-52.28A40.8 40.8 0 0 1 210.63 72H232Z',
);
const money: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 256;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-128, -128);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * 0.2;
  ctx.fill(MONEY_BG_PATH);
  ctx.globalAlpha = prevAlpha;
  ctx.fill(MONEY_FG_PATH);
  ctx.restore();
};

/** Money (alt) — a second pasted-in money glyph (Falcon, 2026-09-09),
 * a flat single-path "currentColor" icon (viewBox 0 0 24 24) rather
 * than the first one's duotone style. Same baked-in-verbatim approach
 * as `money` above: the exact SVG path as a Path2D, filled with
 * whatever color the caller has set (no opacity trick needed since
 * this glyph has no separate background layer). */
const MONEY_ALT_PATH = new Path2D(
  'm4.93 14.228l-.001.002l8.839 5.886l5.303-3.532l-.003-.002l1.414-.942l1.417.944L13.768 22L2.1 14.23l1.416-.945zm0-3.408l-.001.002l8.839 5.887l5.303-3.532l-.003-.002l1.414-.943l1.417.945l-8.131 5.416L2.1 10.823l1.416-.945zM21.9 9.77l-8.132 5.417L2.1 7.415l8.131-5.416zM10.938 4.355c-.367.244-.945.26-1.337.046l-.077-.046l-3.89 2.59c.391.26.391.682 0 .942l7.425 4.945c.39-.26 1.024-.26 1.415 0l3.89-2.59c-.391-.26-.391-.681 0-.941V9.3zm3.359 6.005c.39-.26 1.024-.26 1.415 0c.39.26.39.682 0 .942s-1.025.26-1.415 0s-.39-.682 0-.942m-4.242-3.061c1.074-.715 2.814-.715 3.888 0s1.074 1.874 0 2.59s-2.814.715-3.888 0c-1.074-.716-1.074-1.875 0-2.59m2.828.706c-.488-.325-1.28-.325-1.768 0s-.488.853 0 1.178s1.28.325 1.768 0s.488-.853 0-1.178M7.934 6.12c.391-.26 1.024-.26 1.415 0c.39.26.39.682 0 .942s-1.024.26-1.414 0s-.39-.682 0-.942',
);
const moneyAlt: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fill(MONEY_ALT_PATH);
  ctx.restore();
};

export const annotationIcons: Record<'marker' | 'warning' | 'info' | 'arrow' | 'star' | 'flag' | 'money' | 'moneyAlt', AnnotationIconDrawFn> = {
  marker,
  warning,
  info,
  arrow,
  star,
  flag,
  money,
  moneyAlt,
};

/** Falcon, 2026-09-09 ("also want to have it or those icons to
 * access and become objects (icons along the path) also"): derived
 * straight from the icon map's own keys rather than hand-listed, so
 * adding a new built-in icon here (like `money`/`moneyAlt` were)
 * automatically flows through to ObjectRegistry's icon-shaped object
 * types too, with no second list to remember to update. */
export type AnnotationIconKind = keyof typeof annotationIcons;

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
  money: '#16a34a',
  moneyAlt: '#0d9488',
};

export const ANNOTATION_ICON_LABEL: Record<keyof typeof annotationIcons, string> = {
  marker: 'Marker',
  warning: 'Warning',
  info: 'Info',
  arrow: 'Arrow',
  star: 'Star',
  flag: 'Flag',
  money: 'Money',
  moneyAlt: 'Money (alt)',
};

export const ANNOTATION_ICON_ORDER: (keyof typeof annotationIcons)[] = ['marker', 'warning', 'info', 'arrow', 'star', 'flag', 'money', 'moneyAlt'];

/** Falcon, 2026-09-09 ("font style" — separate from the bold/italic
 * "type" controls): a small fixed picker of CSS font-family stacks
 * for annotation text, each with a real fallback so a font missing on
 * a given OS still renders something in the right spirit rather than
 * silently falling back to the browser default. */
export const ANNOTATION_FONT_FAMILIES: { value: string; label: string }[] = [
  { value: 'system-ui, sans-serif', label: 'Sans-serif' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'ui-monospace, "Courier New", monospace', label: 'Monospace' },
  { value: '"Comic Sans MS", "Segoe Print", cursive', label: 'Handwritten' },
  { value: '"Trebuchet MS", ui-rounded, sans-serif', label: 'Rounded' },
];
export const ANNOTATION_DEFAULT_FONT_FAMILY = ANNOTATION_FONT_FAMILIES[0]!.value;

