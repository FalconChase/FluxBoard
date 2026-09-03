import type { Point } from '../floor/bezier';

export interface Sketch {
  id: string;
  from: Point;
  to: Point;
}

/**
 * Pure UI/planning scratch data — deliberately NOT part of the
 * Logic/Floor/Skin architecture (design doc §2): a sketch carries no
 * simulation meaning, isn't tied to any GraphModel node/edge id, and
 * nothing ever flows along it. Falcon, 2026-09-03: "maybe we can draw
 * paths without really needing node... give freedom to users to plan
 * the paths" — resolved as a pure visual planning sketch, not a real
 * (possibly dangling) GraphModel edge.
 *
 * Mutated directly and read by FluxCanvas's render loop every frame —
 * same pattern as GraphModel/FloorLayout/SkinConfig — so adding or
 * removing a sketch doesn't need to re-run FluxCanvas's setup effect.
 */
export class SketchLayer {
  private sketches = new Map<string, Sketch>();

  add(sketch: Sketch): void {
    this.sketches.set(sketch.id, sketch);
  }

  remove(id: string): void {
    this.sketches.delete(id);
  }

  get(id: string): Sketch | undefined {
    return this.sketches.get(id);
  }

  getAll(): Sketch[] {
    return [...this.sketches.values()];
  }
}
