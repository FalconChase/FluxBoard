import { describe, expect, it } from 'vitest';
import { BezierPath, curveBetween } from '../bezier';

describe('BezierPath', () => {
  it('returns the endpoints at progress 0 and 1', () => {
    const curve = new BezierPath(curveBetween({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2));
    const start = curve.getPointAtProgress(0);
    const end = curve.getPointAtProgress(1);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
  });

  it("approximates a straight line's length when bow is 0", () => {
    const curve = new BezierPath(curveBetween({ x: 0, y: 0 }, { x: 300, y: 400 }, 0));
    // 3-4-5 triangle scaled by 100 => straight-line distance 500
    expect(curve.totalLength).toBeCloseTo(500, 0);
  });

  it('moves monotonically further from the start as progress increases', () => {
    const curve = new BezierPath(curveBetween({ x: 0, y: 0 }, { x: 200, y: 50 }, 0.3));
    const p0 = curve.getPointAtProgress(0);
    let lastDist = 0;
    for (let progress = 0.1; progress <= 1; progress += 0.1) {
      const point = curve.getPointAtProgress(progress);
      const d = Math.hypot(point.x - p0.x, point.y - p0.y);
      expect(d).toBeGreaterThanOrEqual(lastDist);
      lastDist = d;
    }
  });

  it('clamps out-of-range progress', () => {
    const curve = new BezierPath(curveBetween({ x: 0, y: 0 }, { x: 10, y: 0 }));
    expect(curve.getPointAtProgress(-1)).toEqual(curve.getPointAtProgress(0));
    expect(curve.getPointAtProgress(2)).toEqual(curve.getPointAtProgress(1));
  });
});
