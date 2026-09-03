import type { NodeId } from './types';

/**
 * NodeRuntimeState — mutable per-node data, indexed by node id
 * (design doc §4.4): counters, queues, cooldowns, lastIndex for
 * round-robin distributors, etc.
 *
 * Kept separate from GraphModel so a running simulation can be reset
 * (wipe this map) without rebuilding topology, and so topology can be
 * saved/loaded without runtime noise.
 */
export type RuntimeState = Record<string, unknown>;

export class NodeRuntimeStateStore {
  private state = new Map<NodeId, RuntimeState>();

  get(id: NodeId): RuntimeState | undefined {
    return this.state.get(id);
  }

  set(id: NodeId, state: RuntimeState): void {
    this.state.set(id, state);
  }

  reset(): void {
    this.state.clear();
  }
}
