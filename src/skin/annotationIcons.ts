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

/** People — a pasted-in three-person cluster glyph (Falcon, 2026-09-10,
 * titled "people" in its source SVG), filled "currentColor"
 * fill-rule="evenodd" (viewBox 0 0 20 20), four paths -- two are
 * ring-shaped heads needing evenodd to punch their hole (same pattern
 * cityWorker's head ring above already uses), the other two are thin
 * connecting shoulder/body curves. All four filled with the same
 * evenodd rule the source `<g>` declared for its whole group. */
const PEOPLE_PATHS = [
  new Path2D('M5 9a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 1a3 3 0 1 0 0-6a3 3 0 0 0 0 6'),
  new Path2D(
    'M3.854 8.896a.5.5 0 0 1 0 .708l-.338.337A3.47 3.47 0 0 0 2.5 12.394v1.856a.5.5 0 1 1-1 0v-1.856a4.47 4.47 0 0 1 1.309-3.16l.337-.338a.5.5 0 0 1 .708 0m11.792-.3a.5.5 0 0 0 0 .708l.338.337A3.47 3.47 0 0 1 17 12.094v2.156a.5.5 0 0 0 1 0v-2.156a4.47 4.47 0 0 0-1.309-3.16l-.337-.338a.5.5 0 0 0-.708 0',
  ),
  new Path2D(
    'M14 9a2 2 0 1 1 0-4a2 2 0 0 1 0 4m0 1a3 3 0 1 1 0-6a3 3 0 0 1 0 6m-4.5 3.25a2.5 2.5 0 0 0-2.5 2.5v1.3a.5.5 0 0 1-1 0v-1.3a3.5 3.5 0 0 1 7 0v1.3a.5.5 0 1 1-1 0v-1.3a2.5 2.5 0 0 0-2.5-2.5',
  ),
  new Path2D('M9.5 11.75a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 1a3 3 0 1 0 0-6a3 3 0 0 0 0 6'),
];
const people: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 20;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-10, -10);
  for (const p of PEOPLE_PATHS) ctx.fill(p, 'evenodd');
  ctx.restore();
};

/** Food — a pasted-in glyph (Falcon, 2026-09-10, titled
 * "food-20-regular" in its source SVG), filled "currentColor"
 * (viewBox 0 0 20 20), a single path. */
const FOOD_PATH = new Path2D(
  'M4.67 2c-.624 0-1.175.438-1.29 1.068C3.232 3.886 3 5.342 3 6.5c0 1.231.636 2.313 1.595 2.936c.271.177.405.405.405.6v.41q0 .027-.003.054c-.027.26-.151 1.429-.268 2.631C4.614 14.316 4.5 15.581 4.5 16a2 2 0 1 0 4 0c0-.42-.114-1.684-.229-2.869a302 302 0 0 0-.268-2.63L8 10.446v-.41c0-.196.134-.424.405-.6A3.5 3.5 0 0 0 10 6.5c0-1.158-.232-2.614-.38-3.432A1.305 1.305 0 0 0 8.33 2c-.34 0-.65.127-.884.336A1.5 1.5 0 0 0 6.5 2c-.359 0-.688.126-.946.336A1.32 1.32 0 0 0 4.671 2M6 3.5a.5.5 0 0 1 1 0v3a.5.5 0 0 0 1 0V3.33A.33.33 0 0 1 8.33 3c.157 0 .28.108.306.247C8.783 4.06 9 5.439 9 6.5a2.5 2.5 0 0 1-1.14 2.098c-.439.285-.86.786-.86 1.438v.41q0 .08.008.16c.028.258.151 1.424.268 2.622c.118 1.215.224 2.415.224 2.772a1 1 0 1 1-2 0c0-.357.106-1.557.224-2.772c.117-1.198.24-2.364.268-2.622q.008-.08.008-.16v-.41c0-.652-.421-1.153-.86-1.438A2.5 2.5 0 0 1 4 6.5c0-1.06.217-2.44.364-3.253A.305.305 0 0 1 4.671 3A.33.33 0 0 1 5 3.33V6.5a.5.5 0 0 0 1 0zm5 3A4.5 4.5 0 0 1 15.5 2a.5.5 0 0 1 .5.5v6.978l.02.224a626 626 0 0 1 .228 2.696c.124 1.507.252 3.161.252 3.602a2 2 0 1 1-4 0c0-.44.128-2.095.252-3.602c.062-.761.125-1.497.172-2.042l.03-.356H12.5A1.5 1.5 0 0 1 11 8.5zm2.998 3.044l-.021.245l-.057.653c-.047.544-.11 1.278-.172 2.038c-.126 1.537-.248 3.132-.248 3.52a1 1 0 1 0 2 0c0-.388-.122-1.983-.248-3.52a565 565 0 0 0-.229-2.691l-.021-.244v-.001L15 9.5V3.035A3.5 3.5 0 0 0 12 6.5v2a.5.5 0 0 0 .5.5h1a.5.5 0 0 1 .498.544',
);
const food: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 20;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-10, -10);
  ctx.fill(FOOD_PATH);
  ctx.restore();
};

/** Travel — a pasted-in glyph (Falcon, 2026-09-10, titled "travel" in
 * its source SVG), filled "currentColor" (viewBox 0 0 24 24), a
 * single path. */
const TRAVEL_PATH = new Path2D(
  'M12 4H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3l-1 1v1h1l2-2.03L9 18v-5H4V6h9v2h2V7a3 3 0 0 0-3-3M5 14a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m15.57-4.34c-.14-.4-.52-.66-.97-.66h-7.19c-.46 0-.83.26-.98.66L10 13.77v5.51c0 .38.32.72.7.72h.62c.38 0 .68-.38.68-.76V18h8v1.24c0 .38.31.76.69.76h.61c.38 0 .7-.34.7-.72v-5.51zm-8.16.34h7.19l1.03 3h-9.25zM12 16a1 1 0 0 1-1-1a1 1 0 0 1 1-1a1 1 0 0 1 1 1a1 1 0 0 1-1 1m8 0a1 1 0 0 1-1-1a1 1 0 0 1 1-1a1 1 0 0 1 1 1a1 1 0 0 1-1 1',
);
const travel: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fill(TRAVEL_PATH);
  ctx.restore();
};

/** Health (outline) — a pasted-in glyph (Falcon, 2026-09-10, titled
 * "health-outline" in its source SVG), filled "currentColor" (viewBox
 * 0 0 48 48), two paths: a plain cross (default nonzero fill) and a
 * badge outline that needs 'evenodd' (Path2D.fill()'s second arg) or
 * it fills solid instead of staying a thin ring — same two-rule split
 * cityWorker's head/body pair above already uses. */
const HEALTH_CROSS_PATH = new Path2D('M22 22v-7h4v7h7v4h-7l-.001 7h-4v-7h-7v-4z');
const HEALTH_BADGE_PATH = new Path2D(
  'M13.823 36.991c2.448 2.211 5.13 4.037 8.158 5.477c1.622.77 3.546.7 5.101-.187c2.623-1.496 4.906-3.297 7.113-5.29c4.679-4.226 7.406-10.041 7.585-16.174l.209-7.151c.024-.832.001-2.666.001-2.666a71 71 0 0 0-3.162-.426c-3.27-.392-6.526-.781-9.383-2.528l-2.037-1.245a5.54 5.54 0 0 0-5.737 0L19.72 7.994c-3.267 1.996-7.248 2.374-11.101 2.74c-.873.083-1.74.166-2.59.266c0 0-.024 1.845 0 2.689l.209 7.128c.179 6.133 2.906 11.948 7.585 16.174m-5.804-24.19c0 .32.003.615.01.83l.208 7.128c.163 5.57 2.64 10.876 6.926 14.748c2.312 2.087 4.833 3.802 7.677 5.154a3.55 3.55 0 0 0 3.252-.117c2.455-1.4 4.619-3.101 6.763-5.037c4.286-3.872 6.763-9.177 6.926-14.748l.209-7.151c.006-.224.01-.539.01-.875q-.702-.089-1.43-.176l-.054-.006a69 69 0 0 1-3.322-.455c-2.244-.38-4.592-.999-6.792-2.343l-2.037-1.246a3.54 3.54 0 0 0-3.651 0L20.763 9.7c-2.32 1.417-4.88 2.089-7.347 2.486c-1.53.246-3.178.403-4.721.551z',
);
const healthOutline: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 48;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-24, -24);
  ctx.fill(HEALTH_CROSS_PATH);
  ctx.fill(HEALTH_BADGE_PATH, 'evenodd');
  ctx.restore();
};

/** Paper (line) — a pasted-in glyph (Falcon, 2026-09-10, titled
 * "paper-line" in its source SVG), filled "currentColor" (viewBox 0 0
 * 24 24), a single path — despite the source name ending "-line" this
 * is actually a filled glyph (thin strokes drawn AS fill shapes), not
 * a stroke-only one like moneyLine/services/goods above, so it's
 * filled with plain ctx.fill() same as every other filled icon here. */
const PAPER_LINE_PATH = new Path2D(
  'M10 8a1 1 0 0 0 0 2zm4 2a1 1 0 1 0 0-2zm-4 2a1 1 0 1 0 0 2zm2 2a1 1 0 1 0 0-2zM6 8v1a1 1 0 0 0 1-1zm2 13H7a1 1 0 0 0 1 1zm0-.01v-1a1 1 0 0 0-1 1zM10 9v1h4V8h-4zm0 4v1h2v-2h-2zM5 4v1h1V3H5zm1 0H5v4h2V4zm0 4V7H3.25v2H6zm-3-.25h1V6H2v1.75zM6 4v1h10V3H6zm12 2h-1v11h2V6zM6 4H5v15.01h2V4zm2 17.01v1h2v-2H8zm12-3.76h-1V19h2v-1.75zM18 21v-1H8v2h10zm-8-2.01h1v-1.74H9v1.74zm.25-1.99v1h9.5v-2h-9.5zM8 21h1v-.01H7V21zm2-3.75h1a.75.75 0 0 1-.75.75v-2C9.56 16 9 16.56 9 17.25zM20 19h-1a1 1 0 0 1-1 1v2a3 3 0 0 0 3-3zm0-1.75h1c0-.69-.56-1.25-1.25-1.25v2a.75.75 0 0 1-.75-.75zM6 19.01H5a3 3 0 0 0 3 3v-2a1 1 0 0 1-1-1zM16 4v1a1 1 0 0 1 1 1h2a3 3 0 0 0-3-3zm-6 14.99H9a1 1 0 0 1-1 1v2a3 3 0 0 0 3-3zM3.25 8V7a.75.75 0 0 1 .75.75H2C2 8.44 2.56 9 3.25 9zM5 4V3a3 3 0 0 0-3 3h2a1 1 0 0 1 1-1z',
);
const paperLine: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fill(PAPER_LINE_PATH);
  ctx.restore();
};

/** Fruits (outline) — a pasted-in glyph (Falcon, 2026-09-10, titled
 * "fruits-outline" in its source SVG), filled "currentColor"
 * fill-rule="evenodd" (viewBox 0 0 48 48), thirteen paths — a stem/
 * leaf group (the first four) and nine overlapping ring shapes (each
 * needing evenodd, same reason people's head rings above need it). */
const FRUITS_PATHS = [
  new Path2D('M18.88 7.566a1 1 0 0 1 1 1v6.6a1 1 0 1 1-2 0v-6.6a1 1 0 0 1 1-1'),
  new Path2D(
    'M11.78 13.905c1.13-.27 2.283-.065 3.48.553c.975.505 1.667.736 2.206.847c.538.112.966.114 1.483.114v2h-.02c-.516 0-1.12 0-1.868-.155c-.757-.157-1.622-.462-2.72-1.03c-.878-.453-1.54-.517-2.096-.384c-.584.14-1.201.53-1.912 1.264c-1.632 1.688-2.139 3.426-2.316 4.762c-.1 1.644.197 4.89 1.668 8.063c.5 1.08 1.21 2.57 2.076 3.737c.432.582.866 1.03 1.283 1.306c.405.267.741.34 1.046.288c3.123-.538 3.71-.551 4.319-.551h1.037v2H18.38c-.422 0-.92 0-3.95.522c-.94.162-1.787-.127-2.488-.59c-.689-.455-1.284-1.106-1.787-1.783c-1.005-1.353-1.791-3.024-2.284-4.088c-1.638-3.532-1.972-7.137-1.848-9.064l.003-.032l.004-.032c.212-1.644.844-3.839 2.866-5.928c.845-.874 1.783-1.556 2.885-1.82',
  ),
  new Path2D(
    'M14.64 11.41c1.496 1.431 2.307 3.166 2.307 4.51a1 1 0 1 0 2 0c0-2.05-1.168-4.275-2.925-5.956C14.244 8.265 11.743 7 8.896 7a1 1 0 0 0 0 2c2.244 0 4.268.999 5.743 2.41',
  ),
  new Path2D(
    'M8.574 7.009a1 1 0 0 1 1.116.868c.492 3.93 3.945 6 6.734 7.115a1 1 0 0 1-.743 1.857c-2.869-1.147-7.335-3.604-7.975-8.724a1 1 0 0 1 .868-1.116m17.188 6.894c-1.152-.264-2.334-.066-3.57.548c-1.02.506-1.747.74-2.317.853s-1.022.115-1.56.115a1 1 0 0 0 0 2h.019c.537 0 1.16 0 1.93-.153c.781-.155 1.676-.458 2.816-1.024c.924-.458 1.632-.528 2.236-.39c.626.144 1.277.542 2.017 1.277c1.716 1.703 2.235 3.452 2.414 4.784a1 1 0 0 0 1.982-.266c-.222-1.653-.884-3.85-2.987-5.938c-.881-.874-1.85-1.548-2.98-1.806m.945 20.377a1 1 0 0 0-1.414.027c-.757.786-1.393 1.05-1.931.962c-3.252-.538-3.86-.55-4.485-.55a1 1 0 0 0 0 2h.028c.447 0 .967 0 4.13.523c1.522.252 2.785-.6 3.699-1.548a1 1 0 0 0-.027-1.415',
  ),
  new Path2D(
    'M32.65 16.103c-1.003 1.81-1.263 3.709-.864 4.992a1 1 0 1 1-1.91.594c-.609-1.959-.153-4.43 1.025-6.556c1.193-2.152 3.206-4.101 5.925-4.947a1 1 0 1 1 .594 1.91c-2.143.666-3.78 2.222-4.77 4.007',
  ),
  new Path2D(
    'M34.719 17.379c-1.168 1.71-2.748 2.793-4.073 3.013a1 1 0 1 0 .326 1.973c2.023-.335 4.027-1.851 5.398-3.858c1.388-2.032 2.227-4.706 1.762-7.515a1 1 0 1 0-1.974.326c.367 2.214-.288 4.375-1.44 6.06',
  ),
  new Path2D('M31.78 23a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5m-4.5 2.5a4.5 4.5 0 1 1 9 0a4.5 4.5 0 0 1-9 0'),
  new Path2D(
    'M37.845 18.09a4.5 4.5 0 0 1 2.716 5.755a1 1 0 1 1-1.883-.675a2.5 2.5 0 1 0-4.706-1.69a1 1 0 1 1-1.882-.675a4.5 4.5 0 0 1 5.755-2.715',
  ),
  new Path2D(
    'M36.253 23.176a4.501 4.501 0 0 1 3.822 8.014a1 1 0 0 1-1.144-1.64a2.5 2.5 0 1 0-3.008-3.99a1 1 0 1 1-1.262-1.552a4.5 4.5 0 0 1 1.592-.832',
  ),
  new Path2D('M27.78 29a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5m-4.5 2.5a4.5 4.5 0 1 1 9 0a4.5 4.5 0 0 1-9 0'),
  new Path2D('M35.78 29a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5m-4.5 2.5a4.5 4.5 0 1 1 9 0a4.5 4.5 0 0 1-9 0'),
  new Path2D('M31.78 35a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5m-4.5 2.5a4.5 4.5 0 1 1 9 0a4.5 4.5 0 0 1-9 0'),
  new Path2D(
    'M37.834 33.966a1 1 0 0 1 1.278-.606a4.5 4.5 0 1 1-4.675 7.44a1 1 0 1 1 1.405-1.423a2.5 2.5 0 1 0 2.598-4.133a1 1 0 0 1-.606-1.279',
  ),
];
const fruitsOutline: AnnotationIconDrawFn = (ctx, cx, cy, size) => {
  const scale = size / 48;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-24, -24);
  for (const p of FRUITS_PATHS) ctx.fill(p, 'evenodd');
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
  | 'personOutline'
  | 'people'
  | 'food'
  | 'travel'
  | 'healthOutline'
  | 'paperLine'
  | 'fruitsOutline',
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
  people,
  food,
  travel,
  healthOutline,
  paperLine,
  fruitsOutline,
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
  people: '#db2777',
  food: '#ea580c',
  travel: '#0891b2',
  healthOutline: '#dc2626',
  paperLine: '#71717a',
  fruitsOutline: '#9333ea',
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
  people: 'People',
  food: 'Food',
  travel: 'Travel',
  healthOutline: 'Health (outline)',
  paperLine: 'Paper (line)',
  fruitsOutline: 'Fruits (outline)',
};

export const ANNOTATION_ICON_ORDER: (keyof typeof annotationIcons)[] = ['marker', 'warning', 'info', 'arrow', 'star', 'flag', 'money', 'moneyAlt', 'moneyStack', 'moneyLine', 'services', 'goods', 'worker', 'cityWorker', 'bank', 'buildings', 'factory', 'house', 'farm', 'person', 'personOutline', 'people', 'food', 'travel', 'healthOutline', 'paperLine', 'fruitsOutline'];

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

