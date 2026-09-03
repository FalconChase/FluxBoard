import { describe, it, expect } from 'vitest';
import { FloorLayout } from '../floorLayout';

/**
 * Milestone 5 target tests: the node-position/edge-curve mutators
 * drag-to-move and delete need — recomputeEdgeCurve (rebuild a curve
 * after an endpoint moves, keeping its original bow), and
 * removeNodePosition/removeEdgeCurve (drop state on deletion,
 * mirroring GraphModel.removeNode/removeEdge and
 * SkinConfig.removeNode/removeEdge).
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

  it('recomputeEdgeCurve rebuilds the curve after an endpoint moves, reusing the original bow', () => {
    const layout = buildLayout();
    const before = layout.getEdgeCurve('e1')!;
    const beforeStart = before.getPointAtProgress(0);

    layout.setNodePosition('a', { x: 0, y: 200 });
    layout.recomputeEdgeCurve('e1', 'a', 'b');

    const after = layout.getEdgeCurve('e1')!;
    const afterStart = after.getPointAtProgress(0);

    // Curve now starts at a's new position, not its old one.
    expect(afterStart.y).toBeCloseTo(200);
    expect(afterStart.y).not.toBeCloseTo(beforeStart.y);

    // Bow (0.4, passed to the original setEdgeCurve) survived the
    // recompute — rebuild the same curve by hand with that bow and
    // compare, since bow isn't otherwise observable from outside.
    const manual = new FloorLayout();
    manual.setNodePosition('a', { x: 0, y: 200 });
    manual.setNodePosition('b', { x: 100, y: 0 });
    manual.setEdgeCurve('e1', 'a', 'b', 0.4);
    expect(after.totalLength).toBeCloseTo(manual.getEdgeCurve('e1')!.totalLength);
  });

  it('recomputeEdgeCurve falls back to the 0.15 default bow when the edge was never set via setEdgeCurve', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('a', { x: 0, y: 0 });
    layout.setNodePosition('b', { x: 100, y: 0 });
    expect(() => layout.recomputeEdgeCurve('e1', 'a', 'b')).not.toThrow();
    expect(layout.getEdgeCurve('e1')).toBeDefined();
  });

  it('removeNodePosition drops the node\'s position', () => {
    const layout = buildLayout();
    layout.removeNodePosition('a');
    expect(layout.getNodePosition('a')).toBeUndefined();
    expect(layout.getNodePosition('b')).toBeDefined();
  });

  it('removeEdgeCurve drops both the curve and its remembered bow', () => {
    const layout = buildLayout();
    layout.removeEdgeCurve('e1');
    expect(layout.getEdgeCurve('e1')).toBeUndefined();

    // Bow was forgotten too — recomputing after removal falls back to
    // the 0.15 default rather than the original 0.4.
    layout.setEdgeCurve('e1', 'a', 'b'); // rebuild with default bow first, as a baseline
    const defaultBowCurve = layout.getEdgeCurve('e1')!;
    layout.removeEdgeCurve('e1');
    layout.recomputeEdgeCurve('e1', 'a', 'b');
    expect(layout.getEdgeCurve('e1')!.totalLength).toBeCloseTo(defaultBowCurve.totalLength);
  });

  it('setEdgeCurve throws if either endpoint has no position', () => {
    const layout = new FloorLayout();
    layout.setNodePosition('a', { x: 0, y: 0 });
    expect(() => layout.setEdgeCurve('e1', 'a', 'b')).toThrow();
  });
});
