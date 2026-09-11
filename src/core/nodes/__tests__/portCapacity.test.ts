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
  it('source: 1 input (2026-09-10 — signal-only, a Sensor commanding it; still no onItemArrival, so a real item wired in here would vanish), 1 output (only ever sends to one edge)', () => {
    expect(getPortCapacity('source')).toEqual({ maxInputs: 1, maxOutputs: 1 });
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

  it('counter: 2 inputs (2026-09-10 — 1 real item in, matching a single real output, plus 1 signal-only slot for a Command\'s reset), 2 outputs (1 real item out + 1 optional copper watch-out to a Sensor)', () => {
    expect(getPortCapacity('counter')).toEqual({ maxInputs: 2, maxOutputs: 2 });
  });

  it('command: 1 input (a signal from its one Sensor), 1 output (a signal to its one Source) — zero physical ports, no onItemArrival', () => {
    expect(getPortCapacity('command')).toEqual({ maxInputs: 1, maxOutputs: 1 });
  });

  it('transform: 1 input, 1 output (single relabel-then-forward, no recipe buffering, no signal/copper ports)', () => {
    expect(getPortCapacity('transform')).toEqual({ maxInputs: 1, maxOutputs: 1 });
  });
});

/**
 * Docking (design doc §5.6, 2026-09-09; extended §5.7, 2026-09-09
 * follow-up — "the dockable/compatible node pairs for dock should be
 * silo-silo, silo-gates, silo-sensor"; extended again 2026-09-10,
 * Falcon confirming Counter's pairs via AskUserQuestion: "Source,
 * Sensor, and Buffer/Silo too"): six pairs total, order-agnostic (a
 * Gate can be either a Silo's in-gate or its out-gate; every pair here
 * has no inherent order either) — every other kind pair is explicitly
 * deferred, same "closed, easy-to-extend list" spirit as
 * isCopperCompatible in App.tsx. Buffer is the one kind allowed to
 * dock with its OWN kind (silo-silo), so "never docks with its own
 * kind" is no longer true for every kind — that's why buffer gets its
 * own assertion below instead of joining the blanket same-kind check.
 */
describe('isDockCompatible', () => {
  const ALL_KINDS: NodeKind[] = ['source', 'distributor', 'merger', 'sorter', 'mixer', 'buffer', 'sink', 'gate', 'sensor', 'counter', 'command', 'transform'];
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

  it('counter and source dock, in either order (2026-09-10)', () => {
    expect(isDockCompatible('counter', 'source')).toBe(true);
    expect(isDockCompatible('source', 'counter')).toBe(true);
  });

  it('counter and buffer dock, in either order (2026-09-10)', () => {
    expect(isDockCompatible('counter', 'buffer')).toBe(true);
    expect(isDockCompatible('buffer', 'counter')).toBe(true);
  });

  it('counter and sensor dock, in either order (2026-09-10)', () => {
    expect(isDockCompatible('counter', 'sensor')).toBe(true);
    expect(isDockCompatible('sensor', 'counter')).toBe(true);
  });

  it('command and sensor dock, in either order (2026-09-10 Command follow-up)', () => {
    expect(isDockCompatible('command', 'sensor')).toBe(true);
    expect(isDockCompatible('sensor', 'command')).toBe(true);
  });

  it('command and source dock, in either order (2026-09-10 Command follow-up)', () => {
    expect(isDockCompatible('command', 'source')).toBe(true);
    expect(isDockCompatible('source', 'command')).toBe(true);
  });

  it('command and counter dock, in either order (2026-09-10 — Command-driven reset)', () => {
    expect(isDockCompatible('command', 'counter')).toBe(true);
    expect(isDockCompatible('counter', 'command')).toBe(true);
  });

  it('every other kind never docks with its own kind', () => {
    for (const kind of NON_BUFFER_KINDS) {
      expect(isDockCompatible(kind, kind)).toBe(false);
    }
  });

  it('every other pairing is rejected — deferred, not yet built', () => {
    for (const a of ALL_KINDS) {
      for (const b of ALL_KINDS) {
        const isOneOfTheAllowedPairs =
          (a === 'gate' && b === 'buffer') ||
          (a === 'buffer' && b === 'gate') ||
          (a === 'buffer' && b === 'buffer') ||
          (a === 'buffer' && b === 'sensor') ||
          (a === 'sensor' && b === 'buffer') ||
          (a === 'counter' && b === 'source') ||
          (a === 'source' && b === 'counter') ||
          (a === 'counter' && b === 'buffer') ||
          (a === 'buffer' && b === 'counter') ||
          (a === 'counter' && b === 'sensor') ||
          (a === 'sensor' && b === 'counter') ||
          (a === 'command' && b === 'sensor') ||
          (a === 'sensor' && b === 'command') ||
          (a === 'command' && b === 'source') ||
          (a === 'source' && b === 'command') ||
          (a === 'command' && b === 'counter') ||
          (a === 'counter' && b === 'command');
        expect(isDockCompatible(a, b)).toBe(isOneOfTheAllowedPairs);
      }
    }
  });
});
