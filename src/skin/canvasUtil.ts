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

/** #rrggbb -> a darkened #rrggbb, `amount` in [0,1] (0 = unchanged, 1 =
 * black) — derives an item token's stroke color from its registry
 * fill color (ObjectRegistry.ts), the same fill/stroke-pair
 * relationship nodeSkinDefaults hand-picks per node kind. Falls back
 * to the input unchanged if it isn't a plain opaque hex color. */
export function darkenHex(hex: string, amount: number): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1]!, 16);
  const r = Math.round(((int >> 16) & 255) * (1 - amount));
  const g = Math.round(((int >> 8) & 255) * (1 - amount));
  const b = Math.round((int & 255) * (1 - amount));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
