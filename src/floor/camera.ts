import type { Point } from './bezier';

export interface Viewport {
  width: number;
  height: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * World space -> screen space mapping (design doc §3). Pan mutates only
 * x/y, zoom mutates only zoom — this never touches node or edge data,
 * only the view of it.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  worldToScreen(world: Point, viewport: Viewport): Point {
    return {
      x: (world.x - this.x) * this.zoom + viewport.width / 2,
      y: (world.y - this.y) * this.zoom + viewport.height / 2,
    };
  }

  screenToWorld(screen: Point, viewport: Viewport): Point {
    return {
      x: (screen.x - viewport.width / 2) / this.zoom + this.x,
      y: (screen.y - viewport.height / 2) / this.zoom + this.y,
    };
  }

  /** Pan by a screen-space delta (e.g. pointer drag movement). */
  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /** Zooms by `factor`, keeping the world point under `screenPoint` fixed
   * on screen (so the point under the cursor doesn't jump when scrolling). */
  zoomAt(screenPoint: Point, viewport: Viewport, factor: number, minZoom = 0.1, maxZoom = 8): void {
    const worldBefore = this.screenToWorld(screenPoint, viewport);
    this.zoom = Math.max(minZoom, Math.min(maxZoom, this.zoom * factor));
    const worldAfter = this.screenToWorld(screenPoint, viewport);
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
  }

  /** World-space rect currently visible — the basis for culling
   * (design doc §3: virtualization). `margin` is in screen pixels,
   * letting callers cull with a little slack past the edges. */
  getVisibleWorldBounds(viewport: Viewport, margin = 0): WorldBounds {
    const topLeft = this.screenToWorld({ x: -margin, y: -margin }, viewport);
    const bottomRight = this.screenToWorld(
      { x: viewport.width + margin, y: viewport.height + margin },
      viewport,
    );
    return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y };
  }
}
