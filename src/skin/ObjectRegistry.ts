import type { ItemType } from '../core/types';
import type { AnnotationIconKind } from './annotationIcons';

/**
 * OBJECTS registry (design doc's item-typing gap, backlog FBP011 —
 * Falcon, 2026-09-03: "objects is the registry or create or modify
 * objects that will be used in the app... create or modify object
 * features also or add own object with basic shapes and sizes").
 * First-pass scope (2026-09-05): a shape/size/color per item TYPE,
 * user-editable, replacing the single hardcoded circle every item
 * used to render as regardless of its `item.type` tag.
 *
 * Skin-owned (design doc §2 — a visual registry for logic's flat
 * `item.type` string is exactly "a cosmetic view of logic state,"
 * the same relationship nodeIcons.ts already has to NodeKind). Items
 * themselves stay a flat `{ id, type }` tag (§4.7, FBD004 — unchanged
 * by this) — this is purely what a given `type` string LOOKS like,
 * never a second place item data lives.
 */
/** Falcon, 2026-09-09 ("also want to have it or those icons to
 * access and become objects (icons along the path) also"): 'icon'
 * renders one of the built-in annotation glyphs (annotationIcons.ts)
 * instead of a plain geometric body -- same icon SET the INSERT tab's
 * canvas annotations use, not the shared custom-icon import library
 * (Falcon scoped it to built-ins only). */
export type ObjectShape = 'circle' | 'square' | 'triangle' | 'icon';

export interface ObjectTypeDef {
  /** Matches the `ItemType` string a source node's `itemType` config,
   * a sorter rule, or a mixer recipe/output actually reference. */
  id: ItemType;
  name: string;
  shape: ObjectShape;
  /** Only meaningful when `shape` is 'icon' -- which built-in glyph to
   * draw. Falcon chose "recolor the icon" (2026-09-09): `color` below
   * still drives the glyph's fill, same as it already tints
   * circle/square/triangle, rather than the icon keeping the fixed
   * color it shows in INSERT-tab annotations. Optional so every
   * existing circle/square/triangle type parses unchanged; ignored
   * for those shapes. */
  icon?: AnnotationIconKind;
  /** World-space size — same meaning as the old hardcoded ITEM_RADIUS
   * every item token used to share (FluxCanvas.tsx, pre-registry). */
  size: number;
  /** Fill color; the token's outline is a darkened derivative at draw
   * time (canvasUtil.darkenHex), matching the fill/stroke convention
   * nodeSkinDefaults already uses per node kind. */
  color: string;
}

/** The one type every project starts with — matches exactly what
 * every item rendered as before this registry existed (FluxCanvas.tsx's
 * old ITEM_RADIUS=7/ITEM_FILL='#2ecc71' constants), so a pre-existing
 * save loses nothing visually on first load under this feature. */
export const DEFAULT_OBJECT_TYPE_ID: ItemType = 'item';

function builtinRoundType(): ObjectTypeDef {
  return { id: DEFAULT_OBJECT_TYPE_ID, name: 'Round (default)', shape: 'circle', size: 7, color: '#2ecc71' };
}

let nextAutoId = 1;

export class ObjectRegistry {
  private types = new Map<ItemType, ObjectTypeDef>();

  constructor() {
    this.types.set(DEFAULT_OBJECT_TYPE_ID, builtinRoundType());
  }

  list(): ObjectTypeDef[] {
    return Array.from(this.types.values());
  }

  get(id: ItemType): ObjectTypeDef | undefined {
    return this.types.get(id);
  }

  /** Falls back to the built-in default type if `id` isn't registered
   * — a node's itemType referencing a since-deleted (or never-typed-
   * in, pre-registry) type should still render as SOMETHING rather
   * than nothing. */
  resolve(id: ItemType): ObjectTypeDef {
    return this.types.get(id) ?? this.types.get(DEFAULT_OBJECT_TYPE_ID) ?? builtinRoundType();
  }

  /** Creates a new registry entry. An explicit `explicitId` is honored
   * as-is (e.g. round-tripping a save); otherwise a fresh one is
   * generated — never derived from `fields.name`, so renaming later
   * can't collide with or orphan anything referencing this type by
   * id. */
  create(fields: Omit<ObjectTypeDef, 'id'>, explicitId?: ItemType): ObjectTypeDef {
    const id = explicitId && explicitId.trim() ? explicitId : `obj-${Date.now().toString(36)}-${nextAutoId++}`;
    const entry: ObjectTypeDef = { id, ...fields };
    this.types.set(id, entry);
    return entry;
  }

  update(id: ItemType, fields: Partial<Omit<ObjectTypeDef, 'id'>>): void {
    const current = this.types.get(id);
    if (!current) return;
    this.types.set(id, { ...current, ...fields });
  }

  /** Refuses to remove the built-in default type (every item that
   * falls through to it via `resolve` needs somewhere to land) —
   * same "reject rather than leave something silently broken"
   * convention port-capacity/anchor-booking already use elsewhere.
   * Whether a type is still REFERENCED by the graph is the caller's
   * own check (App.tsx, which has the GraphModel — this class
   * deliberately has no logic-layer dependency, design doc §2). */
  remove(id: ItemType): boolean {
    if (id === DEFAULT_OBJECT_TYPE_ID) return false;
    return this.types.delete(id);
  }

  /** Wholesale replace (persistence load) — clears everything and
   * re-seeds from `defs`, guaranteeing the built-in default always
   * exists afterward even if the saved list somehow omitted it (e.g.
   * a hand-edited save file). */
  replaceAll(defs: ObjectTypeDef[]): void {
    this.types.clear();
    for (const d of defs) this.types.set(d.id, d);
    if (!this.types.has(DEFAULT_OBJECT_TYPE_ID)) this.types.set(DEFAULT_OBJECT_TYPE_ID, builtinRoundType());
  }
}
