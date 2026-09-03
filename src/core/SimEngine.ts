import { GraphModel } from './GraphModel';
import { NodeRuntimeStateStore } from './NodeRuntimeState';

/**
 * SimEngine — runs ticks over a GraphModel, owns trigger logic, emits
 * state deltas/events (design doc §6). Can run headless (e.g. a Web
 * Worker later) — no rendering knowledge, ever.
 *
 * Structurally a Petri net (design doc §6): source -> router ->
 * transform -> sink. Milestone 1 proves the core loop with exactly one
 * source and one sink, tracking item `progress` (design doc §5.1) as a
 * plain number per item per edge — no geometry, no curves.
 *
 * TODO (Milestone 1):
 *  - tick(dt): advance spawn timers, advance item progress, dispatch
 *    onItemArrival at progress >= 1, apply resulting actions.
 *  - Verify item conservation and absence of deadlock in a console
 *    test harness before any graphics work.
 */
export class SimEngine {
  constructor(
    private graph: GraphModel,
    private runtime: NodeRuntimeStateStore = new NodeRuntimeStateStore(),
  ) {}

  tick(_dt: number): void {
    throw new Error('not implemented');
  }
}
