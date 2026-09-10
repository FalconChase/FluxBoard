import { describe, it, expect } from 'vitest';
import { getPortCapacity, isDockCompatible } from '../portCapacity';
import type { NodeKind } from '../../types';

/**
 * These caps are read directly off each kind's own onItemArrival/
 * trySpawn handler (see portCapacity.ts's header comment for the
 * reasoning per kind) — this test just locks the resulting table in
 * place so a future edit to it is a deliberate, visible change.
 */
describe('getPortCapacity', () => {
  it('source: 0 inputs (no onItemArrival handler at all), 1 output (only ever sends to one edge)', () => {
    expect(getPortCapacity('source')).toEqual({ maxInputs: 0, maxOutputs: 1 });
  });

  it('sink: 0 outputs (no send/forward action exists), inputs uncapped', () => {
    expect(getPortCapacity('sink')).toEqual({ maxOutputs: 0 });
  });

  it('mixer: 1 output (single outputPort lookup), inputs uncapped (multi-port recipes)', () => {
    expect(getPortCapacity('mixer')).toEqual({ maxOutputs: 1 });
  });

  it('buffer: 3 outputs (main + optional overflow port + an optional copper watch-out to a Sensor), inputs uncapped', () => {
    expect(getPortCapacity('buffer')).toEqual({ maxOutputs: 3 });
  });

  it('distributor and sorter: no kind-specific cap on either side', () => {
    expect(getPortCapacity('distributor')).toEqual({});
    expect(getPortCapacity('sorter')).toEqual({});
  });

  it('merger: 1 output (single active-output-edge lookup, the mirror of distributor), inputs uncapped', () => {
    expect(getPortCapacity('merger')).toEqual({ maxOutputs: 1 });
  });

  it('gate: 2 inputs (1 physical item + 1 mandatory signal from its Sensor), 2 outputs (1 physical + 1 optional copper-out)', () => {
    expect(getPortCapacity('gate')).toEqual({ maxInputs: 2, maxOutputs: 2 });
  });

  it('sensor: fully uncapped here — its ports are copper-path-only, but that restriction is enforced by the node-kind compatibility check at wire-creation time (App.tsx), not by this numeric cap', () => {
    expect(getPortCapacity('sensor')).toEqual({});
  });
});

/**
 * Docking (design doc §5.6, 2026-09-09; extended §5.7, 2026-09-09
 * follow-up — "the dockable/compatible node pairs for dock should be
 * silo-silo, silo-gates, silo-sensor"): three pairs total, order-
 * agnostic (a Gate can be either a Silo's in-gate or its out-gate; a
 * Silo-Silo pair and a Silo-Sensor pair have no inherent order
 * either) — every other kind pair is explicitly deferred, same
 * "closed, easy-to-extend list" spirit as isCopperCompatible in
 * App.tsx. Buffer is the one kind allowed to dock with its OWN kind
 * (silo-silo), so "never docks with its own kind" is no longer true
 * for every kind — that's why buffer gets its own assertion below
 * instead of joining the blanket same-kind check.
 */
describe('isDockCompatible', () => {
  const ALL_KINDS: NodeKind[] = ['source', 'distributor', 'merger', 'sorter', 'mixer', 'buffer', 'sink', 'gate', 'sensor'];
  const NON_BUFFER_KINDS = ALL_KINDS.filter((k) => k !== 'buffer');

  it('gate and buffer dock, in either order', () => {
    expect(isDockCompatible('gate', 'buffer')).toBe(true);
    expect(isDockCompatible('buffer', 'gate')).toBe(true);
  });

  it('buffer docks with another buffer (silo-silo)', () => {
    expect(isDockCompatible('buffer', 'buffer')).toBe(true);
  });

  it('buffer and sensor dock, in either order (silo-sensor)', () => {
    expect(isDockCompatible('buffer', 'sensor')).toBe(true);
    expect(isDockCompatible('sensor', 'buffer')).toBe(true);
  });

  it('every other kind never docks with its own kind', () => {
    for (const kind of NON_BUFFER_KINDS) {
      expect(isDockCompatible(kind, kind)).toBe(false);
    }
  });

  it('every other pairing is rejected — deferred, not yet built', () => {
    for (const a of ALL_KINDS) {
      for (const b of ALL_KINDS) {
        const isOneOfTheThreeAllowedPairs =
          (a === 'gate' && b === 'buffer') ||
          (a === 'buffer' && b === 'gate') ||
          (a === 'buffer' && b === 'buffer') ||
          (a === 'buffer' && b === 'sensor') ||
          (a === 'sensor' && b === 'buffer');
        expect(isDockCompatible(a, b)).toBe(isOneOfTheThreeAllowedPairs);
      }
    }
  });
});
