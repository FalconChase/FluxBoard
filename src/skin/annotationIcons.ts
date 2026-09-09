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

/** Money (stack) — a third pasted-in money glyph (Falcon, 2026-09-09),
 * a flat single-path "currentColor" icon (viewBox 0 0 512 512).
 * Same baked-in-verbatim Path2D approach as `moneyAlt`. */
const MONEY_STACK_PATH = new Path2D(
  'M327.027 65.816L229.79 128.23l9.856 5.397l86.51-55.53l146.735 83.116l-84.165 54.023l4.1 2.244v6.848l65.923-42.316l13.836 7.838l-79.76 51.195v11.723l64.633-41.487l15.127 8.57l-79.76 51.195v11.723l64.633-41.487l15.127 8.57l-79.76 51.195v11.723l100.033-64.21l-24.828-14.062l24.827-15.937l-24.828-14.064l24.827-15.937l-23.537-13.333l23.842-15.305zm31.067 44.74c-21.038 10.556-49.06 12.342-68.79 4.383l-38.57 24.757l126.903 69.47l36.582-23.48c-14.41-11.376-13.21-28.35 2.942-41.67zM227.504 147.5l-70.688 46.094l135.61 78.066l1.33-.85c2.5-1.61 6.03-3.89 10.242-6.613c8.42-5.443 19.563-12.66 30.674-19.86c16.002-10.37 24.248-15.72 31.916-20.694zm115.467 1.17a8.583 14.437 82.068 0 1 .003 0a8.583 14.437 82.068 0 1 8.32 1.945a8.583 14.437 82.068 0 1-.87 12.282a8.583 14.437 82.068 0 1-20.273 1.29a8.583 14.437 82.068 0 1 .87-12.28a8.583 14.437 82.068 0 1 11.95-3.237m-218.423 47.115L19.143 263.44l23.537 13.333l-23.842 15.305l24.828 14.063l-24.828 15.938l24.828 14.063l-24.828 15.938l166.135 94.106L285.277 381.8v-11.72l-99.433 63.824L39.11 350.787l14.255-9.15l131.608 74.547L285.277 351.8v-11.72l-99.433 63.824L39.11 320.787l14.255-9.15l131.608 74.547L285.277 321.8v-11.72l-99.433 63.824L39.11 290.787l13.27-8.52l132.9 75.28l99.997-64.188v-5.05l-5.48-3.154l-93.65 60.11l-146.73-83.116l94.76-60.824l-9.63-5.543zm20.46 11.78l-46.92 30.115c14.41 11.374 13.21 28.348-2.942 41.67l59.068 33.46c21.037-10.557 49.057-12.342 68.787-4.384l45.965-29.504l-123.96-71.358zm229.817 32.19c-8.044 5.217-15.138 9.822-30.363 19.688a36222 36222 0 0 1-30.69 19.873c-4.217 2.725-7.755 5.01-10.278 6.632c-.09.06-.127.08-.215.137v85.924l71.547-48.088zm-200.99 17.48a8.583 14.437 82.068 0 1 8.32 1.947a8.583 14.437 82.068 0 1-.87 12.28a8.583 14.437 82.068 0 1-20.27 1.29a8.583 14.437 82.068 0 1 .87-12.28a8.583 14.437 82.068 0 1 11.95-3.236z',
);
const moneyStack: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 512;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-256, -256);
  ctx.fill(MONEY_STACK_PATH);
  ctx.restore();
};

/** Money (line) — a fourth pasted-in money glyph (Falcon,
 * 2026-09-09), a STROKE-only "currentColor" icon (fill="none",
 * viewBox 0 0 24 24) -- a stack of coin ellipses drawn as outlines
 * rather than filled shapes, unlike every other baked-in icon so far.
 * Baked in the same verbatim-Path2D way, but drawn with ctx.stroke()
 * instead of ctx.fill() to match the source SVG's stroke-width="2"
 * line art; the canvas scale transform below scales that line width
 * along with the coordinates, same as an SVG's stroke would. */
const MONEY_LINE_PATH = new Path2D(
  'M16 16c0-1.105-3.134-2-7-2s-7 .895-7 2s3.134 2 7 2s7-.895 7-2ZM2 16v4.937C2 22.077 5.134 23 9 23s7-.924 7-2.063V16M9 5c-4.418 0-8 .895-8 2s3.582 2 8 2M1 7v5c0 1.013 3.582 2 8 2M23 4c0-1.105-3.1-2-6.923-2s-6.923.895-6.923 2s3.1 2 6.923 2S23 5.105 23 4Zm-7 12c3.824 0 7-.987 7-2V4M9.154 4v10.166M9 9c0 1.013 3.253 2 7.077 2S23 10.013 23 9',
);
const moneyLine: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.lineWidth = 2;
  ctx.stroke(MONEY_LINE_PATH);
  ctx.restore();
};

/** Services — a pasted-in gear/sparkle-cluster glyph (Falcon,
 * 2026-09-09), stroke-only "currentColor" (fill="none",
 * stroke-width="2", viewBox 0 0 24 24) -- same baked-in-verbatim
 * Path2D + ctx.stroke() approach as `moneyLine`. */
const SERVICES_PATH = new Path2D(
  'M6 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6Zm0-6V0m0 12V9M0 6h3m6 0h3M2 2l2 2m4 4l2 2m0-8L8 4M4 8l-2 2m16 2a3 3 0 1 0 0-6a3 3 0 0 0 0 6Zm0-6V3m0 12v-3m-6-3h3m6 0h3M14 5l2 2m4 4l2 2m0-8l-2 2m-4 4l-2 2m-5 8a3 3 0 1 0 0-6a3 3 0 0 0 0 6Zm0-6v-3m0 12v-3m-6-3h3m6 0h3M5 14l2 2m4 4l2 2m0-8l-2 2m-4 4l-2 2',
);
const services: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.lineWidth = 2;
  ctx.stroke(SERVICES_PATH);
  ctx.restore();
};

/** Goods (outline) — a pasted-in box/crate glyph (Falcon, 2026-09-09),
 * stroke-only "currentColor" (fill="none", viewBox 0 0 16 16, no
 * explicit stroke-width so it uses SVG's own default of 1) -- same
 * verbatim-Path2D + ctx.stroke() approach as moneyLine/services, just
 * a thinner default line to match this glyph's smaller native
 * viewBox. */
const GOODS_PATH = new Path2D(
  'M8 13.5H3a.5.5 0 0 1-.5-.5V8a.5.5 0 0 1 .5-.5h5m0 6v-6m0 6h5a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H8m2.5.5v2m-2-7v2m-3 3v2m-1-7v4.5h7V3a.5.5 0 0 0-.5-.5H5a.5.5 0 0 0-.5.5Z',
);
const goods: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 16;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-8, -8);
  ctx.lineWidth = 1;
  ctx.stroke(GOODS_PATH);
  ctx.restore();
};

/** Worker — a pasted-in hard-hat figure glyph (Falcon, 2026-09-09),
 * a filled "currentColor" icon (viewBox 0 0 24 24). Same
 * verbatim-Path2D + ctx.fill() approach as `money`/`moneyAlt`. */
const WORKER_PATH = new Path2D(
  'M12 15c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4M8 9a4 4 0 0 0 4 4a4 4 0 0 0 4-4m-4.5-7c-.3 0-.5.21-.5.5v3h-1V3s-2.25.86-2.25 3.75c0 0-.75.14-.75 1.25h10c-.05-1.11-.75-1.25-.75-1.25C16.25 3.86 14 3 14 3v2.5h-1v-3c0-.29-.19-.5-.5-.5z',
);
const worker: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fill(WORKER_PATH);
  ctx.restore();
};

/** City worker — a pasted-in avatar glyph (Falcon, 2026-09-09), filled
 * "currentColor" (viewBox 0 0 48 48), two paths: a ring-shaped head
 * (needs the 'evenodd' fill rule -- Path2D.fill()'s second arg -- or
 * the ring's inner circle fills solid instead of punching a hole) and
 * a body path (default nonzero rule). */
const CITY_WORKER_HEAD_PATH = new Path2D(
  'M34 16c0 5.523-4.477 10-10 10s-10-4.477-10-10S18.477 6 24 6s10 4.477 10 10m-2 0a8 8 0 1 1-16 0a8 8 0 0 1 16 0',
);
const CITY_WORKER_BODY_PATH = new Path2D(
  'M30.5 28a.48.48 0 0 0-.54.262L26 39.572V36l-.575-4.021a1 1 0 0 0 .764-.736l.5-2A1 1 0 0 0 25.72 28h-3.438a1 1 0 0 0-.97 1.242l.5 2a1 1 0 0 0 .764.737L22 36v2.696l-3.96-10.434A.48.48 0 0 0 17.5 28a139 139 0 0 1-1.148.272c-2.262.53-5.058 1.184-6.544 2.16C8.045 31.589 7 32.953 7 34.5V41h34v-6.5c0-1.547-1.045-2.91-2.808-4.068c-1.486-.976-4.282-1.63-6.544-2.16c-.403-.094-.79-.184-1.148-.272',
);
const cityWorker: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 48;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-24, -24);
  ctx.fill(CITY_WORKER_HEAD_PATH, 'evenodd');
  ctx.fill(CITY_WORKER_BODY_PATH);
  ctx.restore();
};

/** Bank — a pasted-in classical-bank-facade glyph (Falcon,
 * 2026-09-09), filled "currentColor" (viewBox 0 0 1920 1792 -- a
 * non-square viewBox, unlike every icon baked in so far). Scaled by
 * its longer dimension (width) so it fits within `size` without
 * distortion, same aspect-preserving idea CustomIconLibrary's canvas
 * rendering already uses for non-square imports. */
const BANK_PATH = new Path2D(
  'm960 0l960 384v128h-128q0 26-20.5 45t-48.5 19H197q-28 0-48.5-19T128 512H0V384zM256 640h256v768h128V640h256v768h128V640h256v768h128V640h256v768h59q28 0 48.5 19t20.5 45v64H128v-64q0-26 20.5-45t48.5-19h59zm1595 960q28 0 48.5 19t20.5 45v128H0v-128q0-26 20.5-45t48.5-19z',
);
const bank: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 1920;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-960, -896);
  ctx.fill(BANK_PATH);
  ctx.restore();
};

/** Buildings — a pasted-in two-tower skyline glyph (Falcon,
 * 2026-09-09), filled "currentColor" (viewBox 0 0 16 16), two paths:
 * the building outlines and a grid of small window squares drawn on
 * top. */
const BUILDINGS_BODY_PATH = new Path2D(
  'M14.763.075A.5.5 0 0 1 15 .5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V14h-1v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V10a.5.5 0 0 1 .342-.474L6 7.64V4.5a.5.5 0 0 1 .276-.447l8-4a.5.5 0 0 1 .487.022M6 8.694L1 10.36V15h5zM7 15h2v-1.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V15h2V1.309l-7 3.5z',
);
const BUILDINGS_WINDOWS_PATH = new Path2D(
  'M2 11h1v1H2zm2 0h1v1H4zm-2 2h1v1H2zm2 0h1v1H4zm4-4h1v1H8zm2 0h1v1h-1zm-2 2h1v1H8zm2 0h1v1h-1zm2-2h1v1h-1zm0 2h1v1h-1zM8 7h1v1H8zm2 0h1v1h-1zm2 0h1v1h-1zM8 5h1v1H8zm2 0h1v1h-1zm2 0h1v1h-1zm0-2h1v1h-1z',
);
const buildings: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 16;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-8, -8);
  ctx.fill(BUILDINGS_BODY_PATH);
  ctx.fill(BUILDINGS_WINDOWS_PATH);
  ctx.restore();
};

/** Factory — a pasted-in factory-with-smokestacks glyph (Falcon,
 * 2026-09-09), filled "currentColor" (viewBox 0 0 32 32), a single
 * (long) path. */
const FACTORY_PATH = new Path2D(
  'M5.51 1.5c-.556 0-1.01.454-1.01 1.01v17.233L2.21 20.89a.36.36 0 0 0-.21.32v8.77h2.01v-2.61c0-.21.17-.38.38-.38h4.23c.21 0 .38.17.38.38v2.61h2.01v-2.61c0-.21.17-.38.38-.38h4.23c.21 0 .38.17.38.38v2.61h2.01v.01h3.01v-3.81c0-.21.17-.38.38-.38h5.22c.21 0 .38.17.38.38v3.81h2.98V13.12c0-.63-.51-1.13-1.13-1.13h-9.71c-.63 0-1.13.51-1.13 1.13v3.86l-2.51 1.253V2.51c0-.556-.454-1.01-1.01-1.01h-1.98c-.556 0-1.01.454-1.01 1.01v17.72l-.96.48a.368.368 0 0 1-.54-.33v-2.79c0-.27-.29-.45-.54-.33l-.96.48V2.51c0-.556-.454-1.01-1.01-1.01zM5.5 19.243V17.49h2v.751zm9-1.753v1.243l-2 .998V17.49zM5.5 5.5h2v1.99h-2zm2 5.99v2h-2v-2zm5-5.99h2v1.99h-2zm2 5.99v2h-2v-2zm6.03 4.53c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53v.97c0 .3-.24.53-.53.53zm4.47-1.5v.97c0 .3-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m3 0v.97c0 .3-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m-6 2.99v.97c0 .29-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m3 0v.97c0 .29-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m3 0v.97c0 .29-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m-6 2.98v.97c0 .3-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m3 0v.97c0 .3-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53m3 0v.97c0 .3-.24.53-.53.53h-.94c-.29 0-.53-.24-.53-.53v-.97c0-.29.24-.53.53-.53h.94c.29 0 .53.24.53.53',
);
const factory: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 32;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-16, -16);
  ctx.fill(FACTORY_PATH);
  ctx.restore();
};

/** House — a pasted-in house-with-window glyph (Falcon, 2026-09-09),
 * filled "currentColor" (viewBox 0 0 32 32), two paths -- the source
 * SVG also wraps them in a clipPath, but that clip rect covers the
 * full 32x32 canvas (a common icon-library artifact, not an actual
 * crop), so it's safely dropped here. */
const HOUSE_WINDOW_PATH = new Path2D(
  'M23.14 21.002h-4.28c-.48 0-.86-.38-.86-.86v-4.28c0-.47.38-.86.86-.86h4.28c.47 0 .86.38.86.86v4.28c0 .48-.38.86-.86.86',
);
const HOUSE_BODY_PATH = new Path2D(
  'm18.28.923l.004.005l12.755 12.565l.003.003a3.17 3.17 0 0 1-.003 4.546a3.2 3.2 0 0 1-2.039.916v6.151a3.91 3.91 0 0 1 3 3.803v2.09H0v-2.09a3.904 3.904 0 0 1 3-3.804v-6.11a3.23 3.23 0 0 1-2.04-.917a3.183 3.183 0 0 1-.002-4.555l.003-.002L4 10.532v-7.01C4 2.059 5.208 1 6.543 1h2.924c1.102 0 2.092.72 2.42 1.769L13.752.93c1.26-1.252 3.28-1.228 4.526-.008M10 7.432v-3.91A.53.53 0 0 0 9.467 3H6.543A.53.53 0 0 0 6 3.523v7.846zm-5 8.314v11.256h2c0-.55.45-1 1-1v-9.61c0-.75.61-1.36 1.36-1.36h5.29c.75 0 1.36.61 1.36 1.36v9.612c.527.026.95.465.95.998H27V15.706L16.02 4.893zm10 4.756a.5.5 0 1 0-1 0a.5.5 0 0 0 1 0',
);
const house: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 32;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-16, -16);
  ctx.fill(HOUSE_WINDOW_PATH);
  ctx.fill(HOUSE_BODY_PATH);
  ctx.restore();
};

/** Farm — a pasted-in farmland-grid glyph (Falcon, 2026-09-09), filled
 * "currentColor" (viewBox 0 0 256 256), a single (long) path. */
const FARM_PATH = new Path2D(
  'M232 158a6 6 0 0 0 0-12a230.1 230.1 0 0 0-66.11 9.65a260 260 0 0 0-23.07-13.28A248.3 248.3 0 0 1 232 126a6 6 0 0 0 0-12c-6 0-12 .22-18 .62V80a6 6 0 0 0-2.4-4.8l-64-48a6 6 0 0 0-7.2 0l-64 48A6 6 0 0 0 74 80v38.77A264.3 264.3 0 0 0 24 114a6 6 0 0 0 0 12a249 249 0 0 1 195.17 93.75a6 6 0 0 0 4.69 2.25a6 6 0 0 0 4.67-9.75a265 265 0 0 0-18.69-20.94A191 191 0 0 1 232 190a6 6 0 0 0 0-12a199 199 0 0 0-33.21 2.79q-9.63-8.65-20-16.25A218.7 218.7 0 0 1 232 158m-106-23.44V102h36v21.46a259 259 0 0 0-33.93 12ZM86 83l58-43.5L202 83v32.71a261 261 0 0 0-28 4.73V96a6 6 0 0 0-6-6h-48a6 6 0 0 0-6 6v33.85a259 259 0 0 0-28-8.46Zm49.17 136.32a6 6 0 0 1-8.32 1.68A185.14 185.14 0 0 0 24 190a6 6 0 0 1 0-12a197.1 197.1 0 0 1 109.49 33a6 6 0 0 1 1.68 8.32m49.8-7.61a6 6 0 1 1-8.4 8.57A216.8 216.8 0 0 0 24 158a6 6 0 0 1 0-12a228.74 228.74 0 0 1 161 65.71Z',
);
const farm: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 256;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-128, -128);
  ctx.fill(FARM_PATH);
  ctx.restore();
};

/** Person — a pasted-in filled figure glyph (Falcon, 2026-09-09),
 * filled "currentColor" (viewBox 0 0 32 32), a single path. */
const PERSON_PATH = new Path2D(
  'M18 30h-4a2 2 0 0 1-2-2v-7a2 2 0 0 1-2-2v-6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a2 2 0 0 1-2 2v7a2 2 0 0 1-2 2m-5-18a.94.94 0 0 0-1 1v6h2v9h4v-9h2v-6a.94.94 0 0 0-1-1Zm3-3a4 4 0 1 1 4-4a4 4 0 0 1-4 4m0-6a2 2 0 1 0 2 2a2 2 0 0 0-2-2',
);
const person: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 32;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-16, -16);
  ctx.fill(PERSON_PATH);
  ctx.restore();
};

/** Person (outline) — a second, stroke-only person glyph Falcon
 * pasted right after the filled one (also titled "person" in its
 * source SVG, hence the distinct key here) -- fill="none",
 * stroke-width="2", round caps/joins, viewBox 0 0 24 24. A circle
 * head plus a shoulders path, both stroked rather than filled, same
 * "currentColor" line-art style as moneyLine/services/goods. */
const PERSON_OUTLINE_SHOULDERS_PATH = new Path2D(
  'M17 14h.352a3 3 0 0 1 2.976 2.628l.391 3.124A2 2 0 0 1 18.734 22H5.266a2 2 0 0 1-1.985-2.248l.39-3.124A3 3 0 0 1 6.649 14H7',
);
const personOutline: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(12, 7, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.stroke(PERSON_OUTLINE_SHOULDERS_PATH);
  ctx.restore();
};

export const annotationIcons: Record<
  | 'marker'
  | 'warning'
  | 'info'
  | 'arrow'
  | 'star'
  | 'flag'
  | 'money'
  | 'moneyAlt'
  | 'moneyStack'
  | 'moneyLine'
  | 'services'
  | 'goods'
  | 'worker'
  | 'cityWorker'
  | 'bank'
  | 'buildings'
  | 'factory'
  | 'house'
  | 'farm'
  | 'person'
  | 'personOutline',
  AnnotationIconDrawFn
> = {
  marker,
  warning,
  info,
  arrow,
  star,
  flag,
  money,
  moneyAlt,
  moneyStack,
  moneyLine,
  services,
  goods,
  worker,
  cityWorker,
  bank,
  buildings,
  factory,
  house,
  farm,
  person,
  personOutline,
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
  moneyStack: '#ca8a04',
  moneyLine: '#334155',
  services: '#6366f1',
  goods: '#a16207',
  worker: '#92400e',
  cityWorker: '#0369a1',
  bank: '#1e3a8a',
  buildings: '#475569',
  factory: '#57534e',
  house: '#b45309',
  farm: '#65a30d',
  person: '#0f766e',
  personOutline: '#334155',
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
  moneyStack: 'Money (stack)',
  moneyLine: 'Money (line)',
  services: 'Services',
  goods: 'Goods',
  worker: 'Worker',
  cityWorker: 'City worker',
  bank: 'Bank',
  buildings: 'Buildings',
  factory: 'Factory',
  house: 'House',
  farm: 'Farm',
  person: 'Person',
  personOutline: 'Person (outline)',
};

export const ANNOTATION_ICON_ORDER: (keyof typeof annotationIcons)[] = ['marker', 'warning', 'info', 'arrow', 'star', 'flag', 'money', 'moneyAlt', 'moneyStack', 'moneyLine', 'services', 'goods', 'worker', 'cityWorker', 'bank', 'buildings', 'factory', 'house', 'farm', 'person', 'personOutline'];

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

