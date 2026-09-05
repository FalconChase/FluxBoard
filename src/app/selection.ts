import type { NodeId, EdgeId } from '../core/types';

/** What's currently selected on the canvas — a single node, edge, or
 * planning sketch (sketchLayer.ts — pure UI scratch data, not a real
 * GraphModel edge), or (FBP014, 2026-09-05) a multi-select group of
 * two or more nodes. Lives in src/app since it's UI/interaction
 * state, not part of any of the three layers proper. */
export type Selection =
  | { type: 'node'; id: NodeId }
  | { type: 'edge'; id: EdgeId }
  | { type: 'sketch'; id: string }
  /** Multi-select tool (FBP014, 2026-09-05) -- two or more nodes
   * selected together so Delete/Duplicate/drag-to-move act on the
   * whole group at once. Edges/sketches deliberately aren't part of
   * a multi selection in this first pass -- only nodes. A selection
   * that would shrink to exactly one member collapses back down to
   * the plain 'node' variant instead (App.tsx/FluxCanvas.tsx never
   * construct a 'multi' with fewer than 2 ids). */
  | { type: 'multi'; nodeIds: NodeId[] };
