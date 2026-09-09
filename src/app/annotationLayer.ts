import type { Point } from '../floor/bezier';
import type { AnnotationIconKind } from '../skin/annotationIcons';

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
/** Re-exported from skin/annotationIcons.ts, which now derives this
 * union straight from the icon map's own keys (Falcon, 2026-09-09) --
 * kept as a re-export here rather than moving every import site over,
 * since App.tsx/FluxCanvas.tsx/Ribbon.tsx already import it from this
 * module. Imported (not just re-exported) so it's also usable below
 * in this file's own Annotation interface. */
export type { AnnotationIconKind };

export interface Annotation {
  id: string;
  position: Point;
  /** Falcon, 2026-09-09 ("insert textbox feature"): 'icon' (the
   * original shape — a colored badge + glyph, optional label below
   * it) vs 'text' (plain text only, no glyph/badge at all). Optional
   * so every annotation created before this existed — all icon-kind —
   * parses unchanged; App.tsx/FluxCanvas treat a missing `kind` as
   * 'icon'. */
  /** Falcon, 2026-09-09 ("insert svgs or images for user custom"):
   * 'custom' draws a user-imported icon/image (skin/
   * customIconLibrary.ts) instead of a built-in glyph — looked up by
   * `customIconId` at render time so deleting/renaming a library
   * entry never requires touching every annotation that uses it. */
  kind?: 'icon' | 'text' | 'custom';
  /** Only meaningful when kind is 'icon' (or absent) — ignored for a
   * plain text box or a custom icon. */
  icon?: AnnotationIconKind;
  /** Only meaningful when kind is 'custom' — the CustomIconLibrary
   * entry to draw. If that entry has since been deleted, the
   * annotation renders a neutral "missing" placeholder rather than
   * silently vanishing or crashing (same "never render as nothing"
   * spirit as ObjectRegistry.resolve()'s fallback). */
  customIconId?: string;
  /** Free text shown next to the icon (icon kind) or AS the whole
   * annotation (text kind) — optional for an icon annotation (an icon
   * alone is valid), effectively the whole point for a text one. */
  label?: string;
  /** Falcon, 2026-09-09 ("i notice that the text resizes when i
   * zoomed in and out like it has no fixed size ... adding font size
   * (to lock the sizing)"): a WORLD-space point size, same convention
   * as NODE_RADIUS -- multiplied by camera.zoom at render time, same
   * as every other on-canvas size, so text zooms consistently with
   * everything else instead of staying pinned to a fixed on-screen
   * pixel size while nodes/icons around it scale. Optional -- absent
   * defaults to ANNOTATION_DEFAULT_FONT_SIZE (FluxCanvas.tsx), same
   * convention as every other optional field here. */
  fontSize?: number;
  /** Falcon, 2026-09-09 asked for "font style" separately from
   * "type (bold, itallic)" -- this is the font-STYLE half (typeface
   * family); bold/italic below are the type/weight half. A plain CSS
   * font-family value (see ANNOTATION_FONT_FAMILIES in
   * annotationIcons.ts for the picker's actual choices) — optional,
   * defaults to the original system-ui sans-serif when absent. */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  /** #rrggbb text color — optional, defaults to the standard dark
   * label color when absent. Ignored for an empty text box's faint
   * "Text" placeholder, which always renders in its own muted gray
   * regardless of this setting. */
  color?: string;
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
