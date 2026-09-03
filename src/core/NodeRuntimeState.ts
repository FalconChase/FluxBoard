import type { NodeId } from './types';

/**
 * NodeRuntimeState — mutable per-node data, indexed by node id
 * (design doc §4.4): counters, queues, cooldowns, lastIndex for
 * round-robin distributors, etc.
 *
 * Kept separate from GraphModel so a running simulation can be reset
 * (wipe this map) without rebuilding topology, and so topology can be
 * saved/loaded without runtime noise.
 *
 * TODO (Milestone 1): shape this once the source/sink node contract
 * (design doc §4.3) is implemented — start minimal, grow per node kind.
 */
export type RuntimeState = Record<string, unknown>;

export class NodeRuntimeStateStore {
  private state = new Map<NodeId, RuntimeState>();

  get(_id: NodeId): RuntimeState | undefined {
    throw new Error('not implemented');
  }

  set(_id: NodeId, _state: RuntimeState): void {
    throw new Error('not implemented');
  }

  reset(): void {
    this.state.clear();
  }
}
