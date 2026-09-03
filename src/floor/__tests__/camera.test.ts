import { describe, expect, it } from 'vitest';
import { Camera } from '../camera';

const viewport = { width: 800, height: 600 };

describe('Camera', () => {
  it('round-trips world <-> screen at default zoom/offset', () => {
    const camera = new Camera();
    const world = { x: 123, y: -45 };
    const screen = camera.worldToScreen(world, viewport);
    const back = camera.screenToWorld(screen, viewport);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });

  it('round-trips after pan and zoom', () => {
    const camera = new Camera();
    camera.pan(150, -60);
    camera.zoom = 2.4;
    const world = { x: -300, y: 80 };
    const screen = camera.worldToScreen(world, viewport);
    const back = camera.screenToWorld(screen, viewport);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });

  it('pan moves the camera opposite the drag direction, scaled by zoom', () => {
    const camera = new Camera();
    camera.zoom = 2;
    camera.pan(100, 0); // dragging content right by 100px screen
    expect(camera.x).toBeCloseTo(-50); // camera moves left in world space
  });

  it('zoomAt keeps the world point under the cursor fixed on screen', () => {
    const camera = new Camera();
    camera.x = 40;
    camera.y = -10;
    camera.zoom = 1.5;
    const screenPoint = { x: 300, y: 200 };
    const worldBefore = camera.screenToWorld(screenPoint, viewport);

    camera.zoomAt(screenPoint, viewport, 1.8);

    const worldAfter = camera.screenToWorld(screenPoint, viewport);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('clamps zoom to the given min/max', () => {
    const camera = new Camera();
    camera.zoomAt({ x: 400, y: 300 }, viewport, 0.0001, 0.5, 4);
    expect(camera.zoom).toBeCloseTo(0.5);
    camera.zoomAt({ x: 400, y: 300 }, viewport, 100, 0.5, 4);
    expect(camera.zoom).toBeCloseTo(4);
  });

  it('computes visible world bounds that grow as zoom decreases', () => {
    const camera = new Camera();
    camera.zoom = 1;
    const wide = camera.getVisibleWorldBounds(viewport);
    camera.zoom = 2;
    const narrow = camera.getVisibleWorldBounds(viewport);
    expect(wide.maxX - wide.minX).toBeGreaterThan(narrow.maxX - narrow.minX);
  });
});
