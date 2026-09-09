import type { NodeId, EdgeId } from '../core/types';

/** What's currently selected on the canvas — a single node, edge, or
 * planning sketch (sketchLayer.ts — pure UI scratch data, not a real
 * GraphModel edge), or (FBP014, 2026-09-05; extended 2026-09-05 for
 * quick-select) a multi-select group mixing any number of nodes,
 * edges, and sketches together. Lives in src/app since it's UI/
 * interaction state, not part of any of the three layers proper. */
export type Selection =
  | { type: 'node'; id: NodeId }
  | { type: 'edge'; id: EdgeId }
  | {
      /** Falcon, 2026-09-09 (INSERT tab's icon/label overlay concept,
       * scoped to free-floating markers): a canvas annotation
       * (app/annotationLayer.ts) — pure UI scratch, not a real
       * GraphModel node/edge, carries no simulation meaning.
       * Deliberately left OUT of the 'multi' selection below for this
       * first pass (annotations aren't part of the multi-select
       * quick-select flyout's kinds yet) — a scope call, not an
       * oversight. */
      type: 'annotation';
      id: string;
    }
  | {
      type: 'sketch';
      id: string;
      /** Falcon, 2026-09-05 ("l3 connected non linear paths"):
       * drills into ONE segment of an already-selected multi-segment
       * sketch (click a specific leg a second time) so its own
       * properties -- including "Convert to arc" -- can be edited
       * independently of the sketch as a whole. undefined/omitted
       * means the WHOLE sketch is selected, same as before this
       * existed; meaningless (and never set) for a 1-segment sketch,
       * since there's nothing to drill into. */
      segmentIndex?: number;
    }
  /** Multi-select tool (FBP014, 2026-09-05) -- two or more items
   * selected together so Delete acts on the whole group at once.
   * Only `nodeIds` participate in drag-to-move-the-group and
   * Duplicate (design doc's node-centric convention -- an edge/
   * sketch has no independent position of its own to translate, and
   * Duplicate only ever clones nodes) -- `edgeIds`/`sketchIds` are
   * still fully covered by Delete and by the marquee/toggle-select
   * gesture's rendering (a selected edge/sketch highlights same as a
   * lone 'edge'/'sketch' selection would). A selection that would
   * shrink to exactly one member total collapses back down to the
   * matching singular variant instead -- see `collapseSelection`
   * below, the only place a 'multi' should ever be constructed. */
  | {
      type: 'multi';
      nodeIds: NodeId[];
      edgeIds: EdgeId[];
      sketchIds: string[];
      /** Falcon, 2026-09-06 ("use multiselect then those will get
       * group into one group as a local group"): set when this multi
       * selection IS a persisted GroupRegistry entry, not just a
       * transient marquee/quick-select group -- lets the ribbon's
       * Group/Ungroup buttons and PropertiesPanel tell the two apart
       * without a separate Selection variant. Undefined for every
       * ordinary transient multi-select, exactly as before this
       * existed. */
      groupId?: string;
    };

/** The three id arrays a 'multi' selection carries, also usable as a
 * plain working value while building/editing one up before it's
 * collapsed back into a real `Selection` via `collapseSelection`. */
export interface MultiSelectionParts {
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  sketchIds: string[];
}

/** Reads any current `Selection` (including null) out as
 * `MultiSelectionParts` -- a single node/edge/sketch selection comes
 * back as a one-item array in the matching field, so a toggle/merge
 * operation never needs to special-case "was this already a group or
 * just one thing". Used by FluxCanvas's click-to-toggle/marquee and
 * App.tsx's quick-select menu (both build a NEW parts object off the
 * current selection, then hand it to `collapseSelection` below). */
export function normalizeMultiParts(selection: Selection | null): MultiSelectionParts {
  if (!selection) return { nodeIds: [], edgeIds: [], sketchIds: [] };
  if (selection.type === 'multi') return { nodeIds: selection.nodeIds, edgeIds: selection.edgeIds, sketchIds: selection.sketchIds };
  if (selection.type === 'node') return { nodeIds: [selection.id], edgeIds: [], sketchIds: [] };
  if (selection.type === 'edge') return { nodeIds: [], edgeIds: [selection.id], sketchIds: [] };
  return { nodeIds: [], edgeIds: [], sketchIds: [selection.id] };
}

/** The inverse of `normalizeMultiParts` -- turns a working parts
 * object back into a real `Selection`: null if everything's empty,
 * the matching singular variant if exactly one id total across all
 * three arrays, otherwise a genuine 'multi'. This is the ONLY place
 * that should ever construct `{type:'multi', ...}` directly, so a
 * 'multi' selection can never end up with 0 or 1 total members. */
export function collapseSelection(parts: MultiSelectionParts): Selection | null {
  const total = parts.nodeIds.length + parts.edgeIds.length + parts.sketchIds.length;
  if (total === 0) return null;
  if (total === 1) {
    if (parts.nodeIds.length === 1) return { type: 'node', id: parts.nodeIds[0]! };
    if (parts.edgeIds.length === 1) return { type: 'edge', id: parts.edgeIds[0]! };
    return { type: 'sketch', id: parts.sketchIds[0]! };
  }
  return { type: 'multi', nodeIds: parts.nodeIds, edgeIds: parts.edgeIds, sketchIds: parts.sketchIds };
}
