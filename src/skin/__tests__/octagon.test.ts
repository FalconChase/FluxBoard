import { describe, it, expect } from 'vitest';
import { octagonVertices, isPointInOctagon, octagonPortAnchor, OCTAGON_PORT_COUNT, compassLabel } from '../octagon';

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

/** 2026-09-10 (Falcon: "the ports are named according to compass like
 * the N,NE,SE,S,SW,W,NW") — compassLabel is now what every port-based
 * field in PropertiesPanel labels its options with, so its mapping
 * needs to exactly match octagonPortAnchor's own doc comment
 * (0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE), clockwise, and wrap for any
 * out-of-range index rather than throwing. */
describe('compassLabel', () => {
  it('matches octagonPortAnchor\'s own 0=E..7=NE clockwise convention', () => {
    expect(compassLabel(0)).toBe('E');
    expect(compassLabel(1)).toBe('SE');
    expect(compassLabel(2)).toBe('S');
    expect(compassLabel(3)).toBe('SW');
    expect(compassLabel(4)).toBe('W');
    expect(compassLabel(5)).toBe('NW');
    expect(compassLabel(6)).toBe('N');
    expect(compassLabel(7)).toBe('NE');
  });

  it('wraps out-of-range indices instead of throwing', () => {
    expect(compassLabel(8)).toBe('E');
    expect(compassLabel(-1)).toBe('NE');
  });
});
