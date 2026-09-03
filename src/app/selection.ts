import type { NodeId, EdgeId } from '../core/types';

/** What's currently selected on the canvas — at most one thing at a
 * time: a node, an edge, or a planning sketch (sketchLayer.ts — pure
 * UI scratch data, not a real GraphModel edge). Lives in src/app since
 * it's UI/interaction state, not part of any of the three layers
 * proper. */
export type Selection =
  | { type: 'node'; id: NodeId }
  | { type: 'edge'; id: EdgeId }
  | { type: 'sketch'; id: string };
