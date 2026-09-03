import { describe, it, expect } from 'vitest';
import { getPortCapacity } from '../portCapacity';

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

  it('buffer: 2 outputs (main + optional overflow port), inputs uncapped', () => {
    expect(getPortCapacity('buffer')).toEqual({ maxOutputs: 2 });
  });

  it('distributor and sorter: no kind-specific cap on either side', () => {
    expect(getPortCapacity('distributor')).toEqual({});
    expect(getPortCapacity('sorter')).toEqual({});
  });
});
