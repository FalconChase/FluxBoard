import { describe, it, expect } from 'vitest';
import { SkinConfig } from '../SkinConfig';
import { defaultEdgeSkin } from '../pathSkin';

/**
 * Milestone 5 move/delete/snap target tests: the lock flag drag-to-
 * move reads (getNodeLocked/setNodeLocked) and the cleanup methods
 * deletion relies on (removeNode/removeEdge), plus the pre-existing
 * z-order/edge-skin getters/setters this file never had coverage for.
 */
describe('SkinConfig', () => {
  it('getNodeZIndex defaults to 0 for a node with no override', () => {
    const skin = new SkinConfig();
    expect(skin.getNodeZIndex('n1')).toBe(0);
  });

  it('setNodeZIndex/getNodeZIndex round-trip', () => {
    const skin = new SkinConfig();
    skin.setNodeZIndex('n1', 7);
    expect(skin.getNodeZIndex('n1')).toBe(7);
  });

  it('getNodeLocked defaults to false for a node with no override', () => {
    const skin = new SkinConfig();
    expect(skin.getNodeLocked('n1')).toBe(false);
  });

  it('setNodeLocked/getNodeLocked round-trip', () => {
    const skin = new SkinConfig();
    skin.setNodeLocked('n1', true);
    expect(skin.getNodeLocked('n1')).toBe(true);
    skin.setNodeLocked('n1', false);
    expect(skin.getNodeLocked('n1')).toBe(false);
  });

  it('getEdgeSkin falls back to defaultEdgeSkin for an edge with no override', () => {
    const skin = new SkinConfig();
    expect(skin.getEdgeSkin('e1')).toEqual(defaultEdgeSkin);
  });

  it('setEdgeSkin merges partial fields onto the current (or default) skin', () => {
    const skin = new SkinConfig();
    skin.setEdgeSkin('e1', { color: '#ff0000' });
    expect(skin.getEdgeSkin('e1')).toEqual({ ...defaultEdgeSkin, color: '#ff0000' });
    skin.setEdgeSkin('e1', { strokeWidth: 20 });
    expect(skin.getEdgeSkin('e1')).toEqual({ ...defaultEdgeSkin, color: '#ff0000', strokeWidth: 20 });
  });

  it('removeNode drops both zIndex and locked overrides, reverting to defaults', () => {
    const skin = new SkinConfig();
    skin.setNodeZIndex('n1', 3);
    skin.setNodeLocked('n1', true);
    skin.removeNode('n1');
    expect(skin.getNodeZIndex('n1')).toBe(0);
    expect(skin.getNodeLocked('n1')).toBe(false);
  });

  it('removeNode on a node with no overrides is a harmless no-op', () => {
    const skin = new SkinConfig();
    expect(() => skin.removeNode('never-touched')).not.toThrow();
  });

  it('removeEdge drops the edge skin override, reverting to the default', () => {
    const skin = new SkinConfig();
    skin.setEdgeSkin('e1', { style: 'glassTube' });
    skin.removeEdge('e1');
    expect(skin.getEdgeSkin('e1')).toEqual(defaultEdgeSkin);
  });
});
