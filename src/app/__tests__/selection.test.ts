import { describe, it, expect } from 'vitest';
import { normalizeMultiParts, collapseSelection } from '../selection';

/**
 * Quick-select (2026-09-05, Falcon: "when i hover over to multiselect
 * i want it to have a secondary popup selection such as all, paths
 * only, nodes only, sketches only") extended `Selection`'s 'multi'
 * variant from nodes-only to a mixed bag of nodes/edges/sketches.
 * `normalizeMultiParts`/`collapseSelection` are the only place a
 * 'multi' should ever be built or read apart — these tests lock in
 * both directions plus the round-trip and collapse-to-singular rules.
 */
describe('normalizeMultiParts', () => {
  it('a null selection normalizes to all-empty parts', () => {
    expect(normalizeMultiParts(null)).toEqual({ nodeIds: [], edgeIds: [], sketchIds: [] });
  });

  it('a single node/edge/sketch selection normalizes to a one-item array in the matching field', () => {
    expect(normalizeMultiParts({ type: 'node', id: 'n1' })).toEqual({ nodeIds: ['n1'], edgeIds: [], sketchIds: [] });
    expect(normalizeMultiParts({ type: 'edge', id: 'e1' })).toEqual({ nodeIds: [], edgeIds: ['e1'], sketchIds: [] });
    expect(normalizeMultiParts({ type: 'sketch', id: 's1' })).toEqual({ nodeIds: [], edgeIds: [], sketchIds: ['s1'] });
  });

  it('a multi selection passes through unchanged', () => {
    const multi = { type: 'multi' as const, nodeIds: ['a', 'b'], edgeIds: ['e1'], sketchIds: [] };
    expect(normalizeMultiParts(multi)).toEqual({ nodeIds: ['a', 'b'], edgeIds: ['e1'], sketchIds: [] });
  });
});

describe('collapseSelection', () => {
  it('all-empty parts collapse to null', () => {
    expect(collapseSelection({ nodeIds: [], edgeIds: [], sketchIds: [] })).toBeNull();
  });

  it('exactly one id total collapses to the matching singular variant, regardless of which field it is in', () => {
    expect(collapseSelection({ nodeIds: ['n1'], edgeIds: [], sketchIds: [] })).toEqual({ type: 'node', id: 'n1' });
    expect(collapseSelection({ nodeIds: [], edgeIds: ['e1'], sketchIds: [] })).toEqual({ type: 'edge', id: 'e1' });
    expect(collapseSelection({ nodeIds: [], edgeIds: [], sketchIds: ['s1'] })).toEqual({ type: 'sketch', id: 's1' });
  });

  it('two or more ids total collapse to a real multi, even split across different fields (1 node + 1 edge)', () => {
    expect(collapseSelection({ nodeIds: ['a', 'b'], edgeIds: [], sketchIds: [] })).toEqual({
      type: 'multi',
      nodeIds: ['a', 'b'],
      edgeIds: [],
      sketchIds: [],
    });
    expect(collapseSelection({ nodeIds: ['a'], edgeIds: ['e1'], sketchIds: [] })).toEqual({
      type: 'multi',
      nodeIds: ['a'],
      edgeIds: ['e1'],
      sketchIds: [],
    });
  });

  it('round-trips through normalizeMultiParts for an existing mixed multi selection', () => {
    const original = { type: 'multi' as const, nodeIds: ['n1', 'n2'], edgeIds: ['e1'], sketchIds: ['s1', 's2'] };
    expect(collapseSelection(normalizeMultiParts(original))).toEqual(original);
  });
});
