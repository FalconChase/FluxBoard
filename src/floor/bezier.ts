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

/** Falcon, 2026-09-05 ("one continuous path... treating it as
 * simple paths connected as one"): the shape every edge's curve is
 * ultimately consumed as, by every reader anywhere in the app
 * (rendering, item interpolation, the speed-lock feature's length
 * lookup, hit-testing) — none of them ever reach past these three
 * members. That's what makes MultiSegmentPath below a drop-in
 * replacement for a plain BezierPath: FloorLayout can hand back
 * either one from getEdgeCurve and nothing downstream has to know or
 * care which it got. */
export interface EdgePath {
  readonly totalLength: number;
  getPointAtProgress(progress: number): Point;
  getTangentAngleAtProgress(progress: number): number;
}

/** Arc-length-parameterized cubic bezier — the floor layer's curve type. */
export class BezierPath implements EdgePath {
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

/** A curve between two points. `bow` is a fraction of the direct
 * distance, offset perpendicular to it — 0 is a dead-straight line
 * (Falcon, 2026-09-05: "the default when converting from sketch to a
 * path should be linear not curved" -- resolved as every new-path
 * creation path defaulting to bow=0, this function's own default
 * included, rather than the gentle curve new edges used to start
 * with). Picking "Curve" for an edge in the properties panel still
 * starts it at a visibly-curved 0.15 (PropertiesPanel.tsx's
 * PathShapeField) -- that's a distinct, still-curved starting point
 * for an explicit user choice, not this creation-time default. */
export function curveBetween(from: Point, to: Point, bow = 0): CubicBezier {
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


/** Falcon, 2026-09-05 ("one continuous path... treating it as simple
 * paths (curve/linear) connected as one"): an ordered chain of plain
 * BezierPath segments (each independently straight or bowed, same
 * curveBetween/bow model every single-segment edge already uses)
 * walked as ONE seamless EdgePath -- a global 0-1 progress maps onto
 * whichever segment it falls in, proportional to each segment's own
 * arc length, so an item crossing the seam between two segments moves
 * at a visually constant pace rather than jumping. Deliberately NOT
 * tangent-continuous at the joins (same scope boundary sketches
 * already settled on) -- a segment's own curve never reshapes to
 * blend into its neighbor's, it just needs to reach the exact same
 * point the next one starts from, which sharing `points` guarantees. */
export class MultiSegmentPath implements EdgePath {
  readonly totalLength: number;
  private readonly segments: { path: BezierPath; startLength: number }[];

  /** `points` must have exactly `bows.length + 1` entries -- points[i]
   * to points[i+1] is one segment, curved by bows[i]. */
  constructor(points: Point[], bows: number[]) {
    const segments: { path: BezierPath; startLength: number }[] = [];
    let cumulative = 0;
    for (let i = 0; i < bows.length; i++) {
      const path = new BezierPath(curveBetween(points[i]!, points[i + 1]!, bows[i]!));
      segments.push({ path, startLength: cumulative });
      cumulative += path.totalLength;
    }
    this.segments = segments;
    this.totalLength = cumulative;
  }

  getPointAtProgress(progress: number): Point {
    const first = this.segments[0];
    if (!first) return { x: 0, y: 0 }; // defensive -- never constructed with zero segments in practice
    if (this.totalLength === 0) return first.path.getPointAtProgress(0);

    const clamped = Math.max(0, Math.min(1, progress));
    const targetLength = clamped * this.totalLength;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]!;
      const segEnd = seg.startLength + seg.path.totalLength;
      // Last segment always claims anything left over (guards against
      // floating-point targetLength landing a hair past the final
      // segment's own cumulative length).
      if (targetLength <= segEnd || i === this.segments.length - 1) {
        const localLength = targetLength - seg.startLength;
        const localT = seg.path.totalLength === 0 ? 0 : localLength / seg.path.totalLength;
        return seg.path.getPointAtProgress(Math.max(0, Math.min(1, localT)));
      }
    }
    return first.path.getPointAtProgress(0); // unreachable; keeps TS happy
  }

  getTangentAngleAtProgress(progress: number): number {
    const eps = 0.001;
    const a = this.getPointAtProgress(Math.max(0, progress - eps));
    const b = this.getPointAtProgress(Math.min(1, progress + eps));
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}
