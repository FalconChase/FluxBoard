import { GraphModel } from './GraphModel';
import { NodeRuntimeStateStore } from './NodeRuntimeState';
import { nodeHandlers, type Action } from './nodes/index';
import type { EdgeId, Item } from './types';

/**
 * SimEngine — runs ticks over a GraphModel, owns trigger logic, emits
 * state deltas/events (design doc §6). Runs fully headless — no
 * rendering knowledge, ever — so it can run in a Web Worker later.
 *
 * Structurally a Petri net (design doc §6): source -> router ->
 * transform -> sink. Milestone 1 proved the core loop with exactly one
 * source and one sink. Milestone 3 generalizes delivery/dispatch to
 * the full node registry (distributor, sorter, mixer, buffer) via the
 * shared onItemArrival/trySpawn/tryDrain contract (design doc §4.3,
 * §9 step 3) — item `progress` (design doc §5.1) stays a plain number
 * per item per edge, no geometry, no curves.
 */

interface InFlightItem {
  item: Item;
  edgeId: EdgeId;
  progress: number;
}

export interface SimEvent {
  kind: 'spawned' | 'forwarded' | 'delivered' | 'consumed';
  itemId: string;
  nodeId?: string;
  edgeId?: string;
}

export class SimEngine {
  private items = new Map<string, InFlightItem>();
  private tickCount = 0;
  private itemIdSeq = 0;
  private events: SimEvent[] = [];

  constructor(
    private graph: GraphModel,
    private runtime: NodeRuntimeStateStore = new NodeRuntimeStateStore(),
  ) {}

  getTick(): number {
    return this.tickCount;
  }

  getItemsInFlight(): InFlightItem[] {
    return [...this.items.values()];
  }

  getNodeState(nodeId: string): Record<string, unknown> | undefined {
    return this.runtime.get(nodeId);
  }

  /** Returns and clears events recorded since the last call. */
  drainEvents(): SimEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  private nextItemId(): string {
    this.itemIdSeq += 1;
    return `item-${this.itemIdSeq}`;
  }

  /**
   * Advances the simulation by `dt`: move items, deliver arrivals, then
   * run per-tick node hooks (source spawn, buffer drain, ...). Order
   * matters — arrivals are processed before per-tick hooks so item
   * conservation is easy to reason about tick by tick.
   */
  tick(dt: number): void {
    this.advanceItems(dt);
    this.deliverArrivals();
    this.runPerTickHooks(dt);
    this.tickCount += 1;
  }

  private advanceItems(dt: number): void {
    for (const inFlight of this.items.values()) {
      const edge = this.graph.getEdge(inFlight.edgeId);
      if (!edge || !edge.active) continue; // gated off: holds position, doesn't lose progress
      inFlight.progress = Math.min(1, inFlight.progress + edge.flowRate * dt);
    }
  }

  private deliverArrivals(): void {
    const arrived = [...this.items.entries()].filter(([, inFlight]) => inFlight.progress >= 1);

    for (const [itemId, inFlight] of arrived) {
      const edge = this.graph.getEdge(inFlight.edgeId);
      if (!edge) continue;
      const targetNode = this.graph.getNode(edge.target);
      if (!targetNode) continue;

      const handler = nodeHandlers[targetNode.kind]?.onItemArrival;
      if (!handler) {
        // Node kind has no arrival handler — leave the item parked at
        // progress 1 rather than destroying it.
        continue;
      }

      const state = this.runtime.get(targetNode.id) ?? {};
      const outputEdges = this.graph.outputEdges(targetNode.id);
      const result = handler(inFlight.item, targetNode, state, outputEdges, edge, () => this.nextItemId());

      if (result.accepted === false) {
        // Node refused the item this tick (backpressure) — it stays
        // parked at progress 1 on its current edge, retried next tick.
        continue;
      }

      this.runtime.set(targetNode.id, result.newState);
      this.items.delete(itemId);
      this.events.push({ kind: 'delivered', itemId, nodeId: targetNode.id, edgeId: edge.id });

      this.applyActions(result.actions, targetNode.id);
    }
  }

  private runPerTickHooks(dt: number): void {
    for (const node of this.graph.getAllNodes()) {
      const behavior = nodeHandlers[node.kind];
      if (!behavior) continue;

      const outputEdges = this.graph.outputEdges(node.id);

      if (behavior.trySpawn) {
        const state = this.runtime.get(node.id) ?? {};
        const result = behavior.trySpawn(node, state, outputEdges, dt, () => this.nextItemId());
        this.runtime.set(node.id, result.newState);
        this.applyActions(result.actions, node.id);
      }

      if (behavior.tryDrain) {
        const state = this.runtime.get(node.id) ?? {};
        const result = behavior.tryDrain(node, state, outputEdges, dt, () => this.nextItemId());
        this.runtime.set(node.id, result.newState);
        this.applyActions(result.actions, node.id);
      }
    }
  }

  private applyActions(actions: Action[], originNodeId?: string): void {
    for (const action of actions) {
      if (action.type === 'send') {
        this.items.set(action.item.id, { item: action.item, edgeId: action.edgeId, progress: 0 });
        this.events.push({ kind: 'spawned', itemId: action.item.id, nodeId: originNodeId, edgeId: action.edgeId });
      } else if (action.type === 'forward') {
        this.items.set(action.item.id, { item: action.item, edgeId: action.edgeId, progress: 0 });
        this.events.push({ kind: 'forwarded', itemId: action.item.id, nodeId: originNodeId, edgeId: action.edgeId });
      } else if (action.type === 'consume') {
        this.events.push({ kind: 'consumed', itemId: action.item.id });
      }
    }
  }
}
