import type { Point } from '../floor/bezier';

/** Falcon, 2026-09-09: the INSERT tab's long-deferred "icon/label
 * overlays for explaining a flow" concept, scoped down to its first,
 * simplest useful shape — a free-floating icon + optional text label
 * dropped anywhere on the canvas, purely for annotation/explanation.
 * Explicitly NOT pinned to a path or a node this pass (Falcon: "free-
 * floating on canvas for now") — riding along a path is a later
 * extension of this same shape, not a rebuild.
 *
 * Deliberately outside Logic/Floor/Skin (design doc §2), same spirit
 * as sketchLayer.ts's planning sketches: an annotation carries zero
 * simulation meaning, isn't tied to any GraphModel node/edge id, and
 * nothing about it ever affects the sim. */
export type AnnotationIconKind = 'marker' | 'warning' | 'info' | 'arrow' | 'star' | 'flag';

export interface Annotation {
  id: string;
  position: Point;
  icon: AnnotationIconKind;
  /** Free text shown next to the icon — optional, an icon alone is a
   * valid annotation. */
  label?: string;
}

/**
 * Mutated directly and read by FluxCanvas's render loop every frame —
 * same pattern as GraphModel/FloorLayout/SkinConfig/SketchLayer — so
 * adding, moving, or updating an annotation doesn't need to re-run
 * FluxCanvas's setup effect.
 */
export class AnnotationLayer {
  private annotations = new Map<string, Annotation>();

  add(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation);
  }

  remove(id: string): void {
    this.annotations.delete(id);
  }

  get(id: string): Annotation | undefined {
    return this.annotations.get(id);
  }

  getAll(): Annotation[] {
    return [...this.annotations.values()];
  }

  /** Merges `patch` into an existing annotation — a no-op if `id`
   * isn't present. Used to move one (position) and to edit its label,
   * without needing to reconstruct the whole object at every call
   * site (same convention as SketchLayer.update). */
  update(id: string, patch: Partial<Annotation>): void {
    const existing = this.annotations.get(id);
    if (!existing) return;
    this.annotations.set(id, { ...existing, ...patch });
  }
}
