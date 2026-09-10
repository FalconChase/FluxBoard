/**
 * Per-NodeKind icon glyphs (design doc §4.5 — "Node icon" is Skin-
 * owned, a cosmetic view of logic state, nothing more). Drawn as
 * simple vector paths rather than an image/sprite so there's no asset
 * pipeline dependency yet — swapping to real Kenney.nl art (design
 * doc §8) later is a one-file change: only this registry's drawFn
 * per kind needs to change, nothing that calls it.
 *
 * Every icon is drawn centered at (cx, cy) sized relative to `size`
 * (roughly the node's own radius) and filled white, so it reads
 * against any of the per-kind body colors in nodeSkin.ts.
 */

import { roundRectPath } from './canvasUtil';

export type IconDrawFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void;

/** Source — a right-pointing "emit" triangle. */
const source: IconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.55;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.5, cy - s * 0.62);
  ctx.lineTo(cx - s * 0.5, cy + s * 0.62);
  ctx.lineTo(cx + s * 0.62, cy);
  ctx.closePath();
  ctx.fill();
};

/** Sink — a downward funnel: everything that enters is consumed. */
const sink: IconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.58;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.62, cy - s * 0.5);
  ctx.lineTo(cx + s * 0.62, cy - s * 0.5);
  ctx.lineTo(cx, cy + s * 0.55);
  ctx.closePath();
  ctx.fill();
};

/** Distributor — one line splitting into two: routes onward. */
const distributor: IconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.55;
  ctx.lineWidth = Math.max(1.5, size * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.75, cy);
  ctx.lineTo(cx - s * 0.05, cy);
  ctx.lineTo(cx + s * 0.7, cy - s * 0.6);
  ctx.moveTo(cx - s * 0.05, cy);
  ctx.lineTo(cx + s * 0.7, cy + s * 0.6);
  ctx.stroke();
};

/** Merger — the mirror of the distributor icon: two lines converging
 * into one, instead of one splitting into two ("the opposite of
 * distributor," Falcon 2026-09-03). */
const merger: IconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.55;
  ctx.lineWidth = Math.max(1.5, size * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.7, cy - s * 0.6);
  ctx.lineTo(cx + s * 0.05, cy);
  ctx.moveTo(cx - s * 0.7, cy + s * 0.6);
  ctx.lineTo(cx + s * 0.05, cy);
  ctx.lineTo(cx + s * 0.75, cy);
  ctx.stroke();
};

/** Sorter — a funnel narrowing to a stem, like a filter. */
const sorter: IconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.58;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.62, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.62, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.12);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.55);
  ctx.lineTo(cx - s * 0.2, cy + s * 0.55);
  ctx.lineTo(cx - s * 0.2, cy + s * 0.12);
  ctx.closePath();
  ctx.fill();
};

/** Mixer — two overlapping rings: combining inputs into one output. */
const mixer: IconDrawFn = (ctx, cx, cy, size) => {
  const r = size * 0.34;
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.beginPath();
  ctx.arc(cx - r * 0.55, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.55, cy, r, 0, Math.PI * 2);
  ctx.stroke();
};

/** Buffer/overflow — three stacked bars: a queue/tray. */
const buffer: IconDrawFn = (ctx, cx, cy, size) => {
  const w = size * 0.95;
  const h = size * 0.16;
  const gap = size * 0.24;
  for (let i = -1; i <= 1; i++) {
    roundRectPath(ctx, cx - w / 2, cy + i * gap - h / 2, w, h, h * 0.35);
    ctx.fill();
  }
};

/** Gate (design doc §4.8) — a classic pipe-valve "bowtie": two
 * triangles pointing at each other, meeting at the center. Reads as a
 * valve regardless of which of its 2 physical/signal ports face which
 * direction (a Gate's in/out role comes from wiring, not config). */
const gate: IconDrawFn = (ctx, cx, cy, size) => {
  const s = size * 0.55;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.75, cy - s * 0.5);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx - s * 0.75, cy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.75, cy - s * 0.5);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + s * 0.75, cy + s * 0.5);
  ctx.closePath();
  ctx.fill();
};

/** Sensor (design doc §4.8 — "like a neuron"): a small dot with two
 * radiating pulse arcs, the familiar radar/signal-strength glyph. */
const sensor: IconDrawFn = (ctx, cx, cy, size) => {
  const dotY = cy + size * 0.25;
  const r = size * 0.16;
  ctx.beginPath();
  ctx.arc(cx, dotY, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.lineCap = 'round';
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.arc(cx, dotY, r + i * size * 0.22, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();
  }
};

export const nodeIcons = { source, sink, distributor, merger, sorter, mixer, buffer, gate, sensor } as const;
