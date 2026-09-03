// Floor-layer curve geometry (design doc §5.1). Maps a plain 0-1
// progress value — the only thing the logic layer knows about an
// item's position — onto a real (x, y) world point along a curve.
//
// The design doc's reference implementation is SVG's
// `getPointAtLength(path, progress × totalLength)`. This is a pure-TS
// equivalent instead of an SVGPathElement: it keeps the floor layer
// testable outside a real browser (jsdom doesn't implement layout-
// dependent SVG methods) and free of any DOM dependency at all.

export interface Point {
  x: number;
  y: number;
}

export interface CubicBezier {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cubicPointAt(b: CubicBezier, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const bb = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * b.p0.x + bb * b.p1.x + c * b.p2.x + d * b.p3.x,
    y: a * b.p0.y + bb * b.p1.y + c * b.p2.y + d * b.p3.y,
  };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

interface LengthSample {
  t: number;
  /** Cumulative arc length from t=0 up to this sample. */
  length: number;
}

/** Arc-length-parameterized cubic bezier — the floor layer's curve type. */
export class BezierPath {
  readonly totalLength: number;
  private readonly samples: LengthSample[];
  private readonly bezier: CubicBezier;

  constructor(bezier: CubicBezier, sampleCount = 64) {
    this.bezier = bezier;
    const samples: LengthSample[] = [{ t: 0, length: 0 }];
    let prevPoint = cubicPointAt(bezier, 0);
    let cumulative = 0;
    for (let i = 1; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const point = cubicPointAt(bezier, t);
      cumulative += dist(prevPoint, point);
      samples.push({ t, length: cumulative });
      prevPoint = point;
    }
    this.samples = samples;
    this.totalLength = cumulative;
  }

  /** Maps a 0-1 logic-layer progress value to a world-space point. */
  getPointAtProgress(progress: number): Point {
    const clamped = Math.max(0, Math.min(1, progress));
    if (this.totalLength === 0) return cubicPointAt(this.bezier, clamped);

    const targetLength = clamped * this.totalLength;

    let lo = this.samples[0]!;
    let hi = this.samples[this.samples.length - 1]!;
    for (let i = 1; i < this.samples.length; i++) {
      const sample = this.samples[i]!;
      if (sample.length >= targetLength) {
        hi = sample;
        lo = this.samples[i - 1]!;
        break;
      }
    }

    const span = hi.length - lo.length;
    const localT = span === 0 ? 0 : (targetLength - lo.length) / span;
    const t = lerp(lo.t, hi.t, localT);
    return cubicPointAt(this.bezier, t);
  }

  /** Tangent direction (radians) at a progress value — for the future
   * "parallel" item orientation mode (design doc §5.3). */
  getTangentAngleAtProgress(progress: number): number {
    const eps = 0.001;
    const a = this.getPointAtProgress(Math.max(0, progress - eps));
    const b = this.getPointAtProgress(Math.min(1, progress + eps));
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}

/** A gentle curve between two points (rather than a dead-straight line)
 * so curve geometry is actually exercised even for a simple two-node
 * graph. `bow` is a fraction of the direct distance, offset perpendicular
 * to it. */
export function curveBetween(from: Point, to: Point, bow = 0.15): CubicBezier {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const nx = -dy;
  const ny = dx;
  const offsetX = nx * bow;
  const offsetY = ny * bow;
  return {
    p0: from,
    p1: { x: from.x + dx / 3 + offsetX, y: from.y + dy / 3 + offsetY },
    p2: { x: from.x + (dx * 2) / 3 + offsetX, y: from.y + (dy * 2) / 3 + offsetY },
    p3: to,
  };
}
