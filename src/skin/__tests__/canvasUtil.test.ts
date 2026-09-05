import { describe, it, expect } from 'vitest';
import { darkenHex } from '../canvasUtil';

/** darkenHex (FBP011, 2026-09-05) — derives an item token's stroke
 * color from its registry fill color (ObjectRegistry.ts). */
describe('darkenHex', () => {
  it('amount 0 leaves the color unchanged', () => {
    expect(darkenHex('#3d7fff', 0)).toBe('#3d7fff');
  });

  it('amount 1 always produces black', () => {
    expect(darkenHex('#3d7fff', 1)).toBe('#000000');
  });

  it('amount 0.5 halves each channel', () => {
    expect(darkenHex('#804020', 0.5)).toBe('#402010');
  });

  it('falls back to the input unchanged for a non-hex color', () => {
    expect(darkenHex('rgba(1,2,3,0.5)', 0.5)).toBe('rgba(1,2,3,0.5)');
  });
});
