/**
 * User-imported custom icons/images (Falcon, 2026-09-09: "can we
 * still add some like import svgs or images for user custom?" /
 * "can i make my own custom icon library... became preloded on the
 * app?" — resolved to a SHARED, app-wide library rather than a
 * per-project one: import once, available in every FluxBoard project
 * from then on, same spirit as the built-in icon set but user-
 * extensible). Deliberately its own top-level store, not part of
 * ObjectRegistry (that's item TYPES flowing on paths, a Logic-facing
 * concept) or the per-project SavedFile (GraphModel/FloorLayout/
 * SkinConfig/SketchLayer/AnnotationLayer/ObjectRegistry/GroupRegistry
 * — every one of those is scoped to ONE project and threaded through
 * serializeState/clearAllStores/populateState; this one deliberately
 * is NOT, since it needs to survive switching projects entirely).
 *
 * `dataUrl` covers both an imported .svg file (data:image/svg+xml;...)
 * and a raster image (data:image/png;... etc.) uniformly — both load
 * into a plain `Image` and `ctx.drawImage()` the same way, so nothing
 * downstream needs to know or care which kind a given entry is.
 */
export interface CustomIconDef {
  id: string;
  /** Defaults to the imported file's name (minus extension) at
   * import time — editable later isn't built this pass. */
  name: string;
  dataUrl: string;
}

/**
 * Mutated directly and read by FluxCanvas's render loop / Ribbon's
 * INSERT tab every frame/render — same pattern as every other store
 * in this app (design doc §4.6). App.tsx is responsible for
 * persisting it to disk (a single shared JSON file, see
 * persistence.ts's loadCustomIconLibraryFile/saveCustomIconLibraryFile)
 * on every mutation, since this store itself has no disk access of
 * its own.
 */
export class CustomIconLibrary {
  private icons = new Map<string, CustomIconDef>();

  add(icon: CustomIconDef): void {
    this.icons.set(icon.id, icon);
  }

  remove(id: string): void {
    this.icons.delete(id);
  }

  get(id: string): CustomIconDef | undefined {
    return this.icons.get(id);
  }

  getAll(): CustomIconDef[] {
    return [...this.icons.values()];
  }

  /** Replaces the whole library in one shot — used once at app
   * startup to populate from the file loaded off disk. */
  replaceAll(icons: CustomIconDef[]): void {
    this.icons.clear();
    for (const icon of icons) this.icons.set(icon.id, icon);
  }
}
