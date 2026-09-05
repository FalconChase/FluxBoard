import { describe, it, expect } from 'vitest';
import { ObjectRegistry, DEFAULT_OBJECT_TYPE_ID } from '../ObjectRegistry';

/**
 * OBJECTS registry (FBP011, 2026-09-05) — first-pass CRUD + the
 * fallback/reset behavior everything else (persistence.ts,
 * ObjectRegistryManager.tsx) depends on. Interpreter-verified outside
 * vitest first (bridge can't run vitest — see build-log.md's bridge
 * caveats), then written here as the file's permanent local coverage.
 */
describe('ObjectRegistry', () => {
  it('seeds exactly the built-in default type, matching the old hardcoded item-token constants', () => {
    const reg = new ObjectRegistry();
    expect(reg.list()).toHaveLength(1);
    const def = reg.list()[0]!;
    expect(def.id).toBe(DEFAULT_OBJECT_TYPE_ID);
    expect(def).toMatchObject({ shape: 'circle', size: 7, color: '#2ecc71' });
  });

  it('resolve() falls back to the built-in default for an unregistered id', () => {
    const reg = new ObjectRegistry();
    expect(reg.resolve('nonexistent-type').id).toBe(DEFAULT_OBJECT_TYPE_ID);
  });

  it('create() honors an explicit id, and auto-generates a unique one otherwise', () => {
    const reg = new ObjectRegistry();
    const widget = reg.create({ name: 'Widget', shape: 'square', size: 9, color: '#3d7fff' }, 'widget');
    expect(widget.id).toBe('widget');
    expect(reg.resolve('widget').shape).toBe('square');

    const auto1 = reg.create({ name: 'Auto A', shape: 'triangle', size: 5, color: '#ff5d5d' });
    const auto2 = reg.create({ name: 'Auto B', shape: 'triangle', size: 5, color: '#ff5d5d' });
    expect(auto1.id).not.toBe(auto2.id);
    expect(reg.list()).toHaveLength(4);
  });

  it('update() patches only the given fields, no-ops for an unknown id', () => {
    const reg = new ObjectRegistry();
    reg.create({ name: 'Widget', shape: 'square', size: 9, color: '#3d7fff' }, 'widget');

    reg.update('widget', { color: '#00ff00', size: 12 });
    expect(reg.get('widget')).toMatchObject({ color: '#00ff00', size: 12, shape: 'square' });

    reg.update('does-not-exist', { size: 99 });
    expect(reg.get('does-not-exist')).toBeUndefined();
  });

  it('remove() refuses the built-in default type, succeeds for anything else', () => {
    const reg = new ObjectRegistry();
    reg.create({ name: 'Widget', shape: 'square', size: 9, color: '#3d7fff' }, 'widget');

    expect(reg.remove(DEFAULT_OBJECT_TYPE_ID)).toBe(false);
    expect(reg.get(DEFAULT_OBJECT_TYPE_ID)).toBeDefined();

    expect(reg.remove('widget')).toBe(true);
    expect(reg.get('widget')).toBeUndefined();
  });

  it('replaceAll([]) resets to just the built-in default (clearAllStores\'s use, persistence.ts)', () => {
    const reg = new ObjectRegistry();
    reg.create({ name: 'Widget', shape: 'square', size: 9, color: '#3d7fff' }, 'widget');

    reg.replaceAll([]);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0]!.id).toBe(DEFAULT_OBJECT_TYPE_ID);
  });

  it('replaceAll() re-seeds the default type if the given list omits it', () => {
    const reg = new ObjectRegistry();
    reg.replaceAll([{ id: 'only-custom', name: 'Only Custom', shape: 'triangle', size: 4, color: '#123456' }]);

    expect(reg.list()).toHaveLength(2);
    expect(reg.get(DEFAULT_OBJECT_TYPE_ID)).toBeDefined();
    expect(reg.get('only-custom')).toMatchObject({ shape: 'triangle' });
  });
});
