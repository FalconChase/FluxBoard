import { describe, it, expect } from 'vitest';
import { octagonVertices, isPointInOctagon, octagonPortAnchor, OCTAGON_PORT_COUNT } from '../octagon';

/**
 * Milestone 5 target test: isPointInOctagon, the click hit-test the
 * canvas's selection/placement logic relies on.
 */
describe('octagon geometry', () => {
  const center = { x: 100, y: 50 };
  const radius = 20;
  const verts = octagonVertices(center, radius);

  it('produces 8 vertices', () => {
    expect(verts).toHaveLength(8);
  });

  it('the center point is inside', () => {
    expect(isPointInOctagon(center, verts)).toBe(true);
  });

  it('a point well outside the bounding radius is outside', () => {
    expect(isPointInOctagon({ x: center.x + radius * 3, y: center.y }, verts)).toBe(false);
  });

  it('a point just past a vertex (corner) is outside even though it is within the bounding circle', () => {
    // Octagon vertices sit at radius; a point at the same radius along
    // a compass direction (a port anchor's angle) lands OUTSIDE the
    // octagon's edge (edges cut inside the circumscribing circle at
    // non-vertex angles) — this is what makes the shape an octagon
    // and not a circle.
    const anchor = octagonPortAnchor(center, radius, 0); // apothem radius, ON the edge
    const justOutside = { x: anchor.x + 1, y: anchor.y };
    expect(isPointInOctagon(justOutside, verts)).toBe(false);
  });

  it('a point just inside a port anchor is inside', () => {
    const anchor = octagonPortAnchor(center, radius, 0);
    const justInside = { x: anchor.x - 1, y: anchor.y };
    expect(isPointInOctagon(justInside, verts)).toBe(true);
  });

  it('has one port anchor per compass direction', () => {
    expect(OCTAGON_PORT_COUNT).toBe(8);
  });
});
