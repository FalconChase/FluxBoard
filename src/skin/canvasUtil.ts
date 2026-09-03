/** Small canvas drawing helpers shared across the skin layer. No
 * simulation or floor knowledge — pure pixel-level utilities. */

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** #rrggbb (+ optional alpha channel) -> rgba() string at the given
 * opacity. Falls back to the input string unchanged if it isn't a hex
 * color (e.g. already an rgba()/named color) — callers pass a plain
 * opaque hex string. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1]!, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
