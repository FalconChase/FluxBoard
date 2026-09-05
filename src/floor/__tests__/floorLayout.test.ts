import { describe, it, expect } from 'vitest';
import { FloorLayout, NODE_RADIUS } from '../floorLayout';

/**
 * Milestone 5 target tests: the node-position/edge-curve mutators
 * drag-to-move and delete need — recomputeEdgeCurve (rebuild a curve
 * after an endpoint moves, keeping its original bow AND its original
 * anchor side), removeNodePosition/removeEdgeCurve (drop state on
 * deletion, mirroring GraphModel.removeNode/removeEdge and
 * SkinConfig.removeNode/removeEdge), and per-socket wiring (Falcon,
 * 2026-09-03): each node has 8 octagon-side anchors, a path attaches
 * to the nearest free one at each end, max 8 paths per node.
 */
function buildLayout(): FloorLayout {
  const layout = new FloorLayout();
  layout.setNodePosition('a', { x: 0, y: 0 });
  layout.setNodePosition('b', { x: 100, y: 0 });
  layout.setEdgeCurve('e1', 'a', 'b', 0.4);
  return layout;
}

describe('FloorLayout', () => {
  it('setEdgeCurve builds a curve from the endpoints\' current positions', () => {
    const layout = buildLayout();
    const curve = layout.getEdgeCurve('e1');
    expect(curve).toBeDefined();
    expect(curve!.totalLength).toBeGreaterThan(0);
  });

  it('setEdgeCurve attaches each end at the anchor facing the other node (east on a, west on b, for a due-east neighbor)', () => {
    const layout = buildLayout(); // a=(0,0), b=(100,0) — due east of a
    const curve = layout.getEdgeCurve('e1')!;
    const start = curve.getPointAtProgress(0);
    const end = curve.getPointAtProgress(1);
    const apothem = NODE_RADIUS * Math.cos(Math.PI / 8); // octagon edge-midpoint radius
    expect(start.x).toBeCloseTo(apothem); // a's east anchor
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(100 - apothem); // b's west anchor
    expect(end.y).toBeCloseTo(0);
  });

  it('setEdgeCurve returns false and books nothing once a node already has 8 connections', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('center', { x: 0, y: 0 });
    for (let i = 0; i < 8; i++) {
      layout.setNodePosition(`n${i}`, { x: 500 * Math.cos((i * Math.PI) / 4), y: 500 * Math.sin((i * Math.PI) / 4) });
      expect(layout.setEdgeCurve(`e${i}`, 'center', `n${i}`, 0.15)).toBe(true);
    }
    expect(layout.hasFreeAnchorSlot('center')).toBe(false);

    layout.setNodePosition('overflow', { x: 0, y: -900 });
    const ok = layout.setEdgeCurve('e-overflow', 'center', 'overflow', 0.15);
    expect(ok).toBe(false);
    expect(layout.getEdgeCurve('e-overflow')).toBeUndefined();
  });

  it('removeEdgeCurve frees the anchor slot it held, letting a new edge take it', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('center', { x: 0, y: 0 });
    for (let i = 0; i < 8; i++) {
      layout.setNodePosition(`n${i}`, { x: 500 * Math.cos((i * Math.PI) / 4), y: 500 * Math.sin((i * Math.PI) / 4) });
      layout.setEdgeCurve(`e${i}`, 'center', `n${i}`, 0.15);
    }
    expect(layout.hasFreeAnchorSlot('center')).toBe(false);

    layout.removeEdgeCurve('e0');
    expect(layout.hasFreeAnchorSlot('center')).toBe(true);

    layout.setNodePosition('overflow', { x: 0, y: -900 });
    expect(layout.setEdgeCurve('e-overflow', 'center', 'overflow', 0.15)).toBe(true);
  });

  it('recomputeEdgeCurve rebuilds the curve after an endpoint moves, reusing the original bow AND the original anchor side', () => {
    const layout = buildLayout();
    const before = layout.getEdgeCurve('e1')!;
    const beforeStart = before.getPointAtProgress(0);

    layout.setNodePosition('a', { x: 0, y: 200 });
    layout.recomputeEdgeCurve('e1', 'a', 'b');

    const after = layout.getEdgeCurve('e1')!;
    const afterStart = after.getPointAtProgress(0);

    // Curve now starts near a's new position, not its old one — but
    // still on the SAME side of a (east) it was originally wired to,
    // not re-picked toward b's new relative direction.
    const apothem = NODE_RADIUS * Math.cos(Math.PI / 8);
    expect(afterStart.y).toBeCloseTo(200);
    expect(afterStart.x).toBeCloseTo(apothem); // still a's east anchor
    expect(afterStart.y).not.toBeCloseTo(beforeStart.y);
  });

  it('recomputeEdgeCurve falls back to node centers (and the 0.15 default bow) when the edge was never set via setEdgeCurve', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('a', { x: 0, y: 0 });
    layout.setNodePosition('b', { x: 100, y: 0 });
    expect(() => layout.recomputeEdgeCurve('e1', 'a', 'b')).not.toThrow();
    const curve = layout.getEdgeCurve('e1');
    expect(curve).toBeDefined();
    // No anchors were ever booked for e1, so this falls back to the
    // raw node centers rather than any octagon anchor.
    expect(curve!.getPointAtProgress(0)).toEqual({ x: 0, y: 0 });
    expect(curve!.getPointAtProgress(1)).toEqual({ x: 100, y: 0 });
  });

  it('removeNodePosition drops the node\'s position', () => {
    const layout = buildLayout();
    layout.removeNodePosition('a');
    expect(layout.getNodePosition('a')).toBeUndefined();
    expect(layout.getNodePosition('b')).toBeDefined();
  });

  it('removeEdgeCurve drops the curve, its remembered bow, and its anchor booking', () => {
    const layout = buildLayout();
    layout.removeEdgeCurve('e1');
    expect(layout.getEdgeCurve('e1')).toBeUndefined();
    expect(layout.hasFreeAnchorSlot('a')).toBe(true);
    expect(layout.hasFreeAnchorSlot('b')).toBe(true);

    // Bow was forgotten too — recreating fresh (setEdgeCurve, no bow
    // argument) picks the same anchors as before (only two nodes, so
    // "nearest free" is deterministic) and falls back to the 0.15
    // default bow rather than the original 0.4.
    layout.setEdgeCurve('e1', 'a', 'b');
    const defaultBowCurve = layout.getEdgeCurve('e1')!;

    const manual = new FloorLayout();
    manual.setNodePosition('a', { x: 0, y: 0 });
    manual.setNodePosition('b', { x: 100, y: 0 });
    manual.setEdgeCurve('e1', 'a', 'b', 0.15);
    expect(defaultBowCurve.totalLength).toBeCloseTo(manual.getEdgeCurve('e1')!.totalLength);
  });

  it('setEdgeCurve throws if either endpoint has no position', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('a', { x: 0, y: 0 });
    expect(() => layout.setEdgeCurve('e1', 'a', 'b')).toThrow();
  });

  it('reassignAnchor moves one end of an existing edge to a different side and rebuilds the curve there', () => {
    const layout = buildLayout(); // a=(0,0), b=(100,0) -> a's anchor auto-picked as 0 (east)
    expect(layout.getEdgeAnchors('e1')).toEqual({ sourceAnchor: 0, targetAnchor: 4 });

    expect(layout.reassignAnchor('e1', 'source', 6)).toBe(true); // 6 = north
    expect(layout.getEdgeAnchors('e1')).toEqual({ sourceAnchor: 6, targetAnchor: 4 });

    const apothem = NODE_RADIUS * Math.cos(Math.PI / 8);
    const start = layout.getEdgeCurve('e1')!.getPointAtProgress(0);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(-apothem); // north is -y in screen space
  });

  it('reassignAnchor frees the old side, so a new edge can take it', () => {
    const layout = buildLayout();
    layout.reassignAnchor('e1', 'source', 6); // a's east side (0) is now free

    layout.setNodePosition('c', { x: 300, y: 0 });
    expect(layout.setEdgeCurve('e2', 'a', 'c', 0.15)).toBe(true);
    expect(layout.getEdgeAnchors('e2')!.sourceAnchor).toBe(0); // took the freed east slot
  });

  it('reassignAnchor refuses a side already occupied by a different edge, leaving the original untouched', () => {
    const layout = buildLayout();
    layout.setNodePosition('c', { x: 0, y: -500 }); // due north of a
    layout.setEdgeCurve('e2', 'a', 'c', 0.15); // takes a's north anchor (6)

    expect(layout.reassignAnchor('e1', 'source', 6)).toBe(false);
    expect(layout.getEdgeAnchors('e1')).toEqual({ sourceAnchor: 0, targetAnchor: 4 }); // unchanged
  });

  it('reassignAnchor on an edge with no recorded anchors returns false', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('a', { x: 0, y: 0 });
    layout.setNodePosition('b', { x: 100, y: 0 });
    layout.recomputeEdgeCurve('e1', 'a', 'b'); // never went through setEdgeCurve -> no anchors
    expect(layout.reassignAnchor('e1', 'source', 6)).toBe(false);
  });

  // Path type (Falcon, 2026-09-03): "linear" is bow=0 (a straight
  // line), "curve" is any other bow.
  it('setEdgeBow(0) straightens an existing curve to a flat line at its midpoint', () => {
    const layout = buildLayout(); // built with bow 0.4 — a real curve
    const before = layout.getEdgeCurve('e1')!.getPointAtProgress(0.5);
    expect(before.y).not.toBeCloseTo(0, 5);

    layout.setEdgeBow('e1', 0);
    expect(layout.getEdgeBow('e1')).toBe(0);
    const after = layout.getEdgeCurve('e1')!.getPointAtProgress(0.5);
    expect(after.y).toBeCloseTo(0, 5); // straight line from (0,0) to (100,0)
  });

  it('setEdgeBow restores a curve after being set to linear', () => {
    const layout = buildLayout();
    layout.setEdgeBow('e1', 0);
    layout.setEdgeBow('e1', 0.4);
    expect(layout.getEdgeBow('e1')).toBe(0.4);
    const point = layout.getEdgeCurve('e1')!.getPointAtProgress(0.5);
    expect(point.y).not.toBeCloseTo(0, 5);
  });

  it('getEdgeBow defaults to 0.15 (curveBetween\'s own cosmetic default) for an edge with no bow recorded yet', () => {
    const layout = new FloorLayout();
    expect(layout.getEdgeBow('nonexistent')).toBe(0.15);
  });

  // restoreEdgeCurve (Falcon, 2026-09-03: persistence/save-load) — a
  // reload needs an edge to land back on the EXACT anchors it was
  // saved with, not just the nearest free ones setEdgeCurve would
  // auto-pick.
  describe('restoreEdgeCurve', () => {
    it('rebuilds a curve at the exact requested anchors and bow', () => {
      const layout = new FloorLayout();
      layout.setNodePosition('a', { x: 0, y: 0 });
      layout.setNodePosition('b', { x: 100, y: 0 });
      // Anchor 2 and 6 are NOT what setEdgeCurve would auto-pick for a
      // due-east neighbor (that'd be 0/4) — proves this is exact, not nearest-free.
      const ok = layout.restoreEdgeCurve('e1', 'a', 2, 'b', 6, 0.3);
      expect(ok).toBe(true);
      expect(layout.getEdgeAnchors('e1')).toEqual({ sourceAnchor: 2, targetAnchor: 6 });
      expect(layout.getEdgeBow('e1')).toBe(0.3);
      expect(layout.getEdgeCurve('e1')).toBeDefined();
    });

    it('returns false and books nothing when the requested anchor is already taken by a different edge', () => {
      const layout = new FloorLayout();
      layout.setNodePosition('a', { x: 0, y: 0 });
      layout.setNodePosition('b', { x: 100, y: 0 });
      layout.setNodePosition('c', { x: 0, y: 100 });
      layout.restoreEdgeCurve('e1', 'a', 2, 'b', 6, 0.3);
      const ok = layout.restoreEdgeCurve('e2', 'a', 2, 'c', 5, 0.15); // a's anchor 2 already taken
      expect(ok).toBe(false);
      expect(layout.getEdgeAnchors('e2')).toBeUndefined();
      // The original booking is untouched.
      expect(layout.getEdgeAnchors('e1')).toEqual({ sourceAnchor: 2, targetAnchor: 6 });
    });

    it('is idempotent for the same edge id: re-restoring at the same anchors succeeds', () => {
      const layout = new FloorLayout();
      layout.setNodePosition('a', { x: 0, y: 0 });
      layout.setNodePosition('b', { x: 100, y: 0 });
      layout.restoreEdgeCurve('e1', 'a', 2, 'b', 6, 0.3);
      const ok = layout.restoreEdgeCurve('e1', 'a', 2, 'b', 6, 0.3);
      expect(ok).toBe(true);
      expect(layout.getEdgeAnchors('e1')).toEqual({ sourceAnchor: 2, targetAnchor: 6 });
    });

    it('throws if either node has no recorded position yet', () => {
      const layout = new FloorLayout();
      layout.setNodePosition('a', { x: 0, y: 0 });
      expect(() => layout.restoreEdgeCurve('e1', 'a', 0, 'missing', 4, 0.15)).toThrow();
    });
  });

  // FBP014 (2026-09-05): wouldOverlap's exclude argument now takes a
  // single id (unchanged) OR an array of ids -- the multi-select
  // group move/duplicate hard-block needs to exclude every member of
  // the moving/duplicating group at once, not just one at a time.
  describe('wouldOverlap', () => {
    function buildThree(): FloorLayout {
      const layout = new FloorLayout();
      layout.setNodePosition('a', { x: 0, y: 0 });
      layout.setNodePosition('b', { x: 100, y: 0 });
      layout.setNodePosition('c', { x: 200, y: 0 });
      return layout;
    }

    it('with no exclude, flags a candidate too close to ANY existing node', () => {
      const layout = buildThree();
      expect(layout.wouldOverlap({ x: 5, y: 0 })).toBe(true); // near a
      expect(layout.wouldOverlap({ x: 500, y: 500 })).toBe(false); // far from all three
    });

    it('a single excluded id (backward-compatible) ignores just that node', () => {
      const layout = buildThree();
      expect(layout.wouldOverlap({ x: 0, y: 0 }, 'a')).toBe(false); // a excluded, nothing else nearby
      expect(layout.wouldOverlap({ x: 0, y: 0 }, 'b')).toBe(true); // a still counts
    });

    it('an array of excluded ids ignores every node in the group, but still catches an outside one', () => {
      const layout = buildThree();
      // a candidate sitting on top of BOTH a and b is clear once both
      // are excluded together (as a group move/duplicate would)...
      expect(layout.wouldOverlap({ x: 0, y: 0 }, ['a', 'b'])).toBe(false);
      // ...but the same exclude set still flags an overlap with c,
      // which is outside the group.
      expect(layout.wouldOverlap({ x: 200, y: 0 }, ['a', 'b'])).toBe(true);
    });
  });
});
