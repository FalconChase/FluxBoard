import { GraphModel } from './GraphModel';
import { NodeRuntimeStateStore } from './NodeRuntimeState';
import { nodeHandlers, type Action, type NodeTickContext } from './nodes/index';
import type { EdgeDef, EdgeId, Item, NodeDef } from './types';

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
  kind: 'spawned' | 'forwarded' | 'delivered' | 'consumed' | 'signaled';
  /** Empty for 'signaled' -- a signal pulse carries no item (design
   * doc §5.5). */
  itemId: string;
  nodeId?: string;
  edgeId?: string;
  /** 'signaled' only -- the value written into the target Gate's
   * `open` runtime state. */
  value?: boolean;
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
   *
   * `itemSizeOf` (Falcon, 2026-09-09 — no-overlap spacing): an optional
   * plain resolver from an item's `type` tag to its Skin-layer
   * ObjectRegistry world-space size, handed in fresh every call by
   * whoever drives the sim (InterpolatedSimDriver, ultimately FluxCanvas,
   * which owns the ObjectRegistry instance) — SimEngine itself never
   * imports or caches anything from the Skin layer, same "never a
   * second source of truth" reasoning NodeTickContext's own callbacks
   * follow for Logic-layer data. Omitting it (every pre-existing
   * caller, including every test) disables spacing entirely regardless
   * of any edge's `respectItemSize` flag — fully backward compatible.
   *
   * Spacing is enforced LAST, once per tick, after arrivals are
   * delivered and every per-tick hook (including a source's own
   * spawn) has run — not folded into advanceItems' own per-item loop.
   * Caught empirically (see SimEngine.test.ts/verify.js): a source
   * spawning every tick places its new item at progress 0 via
   * runPerTickHooks, which runs AFTER advanceItems — a clamp living
   * inside advanceItems would miss that brand new item for the rest
   * of the current tick, leaving it unclamped right on top of
   * whatever trailing item was already held near 0 from the tick
   * before. Running the pass once more, over whatever is ACTUALLY in
   * flight by the time the tick is done, catches every item every
   * tick regardless of whether it got there by advancing, arriving,
   * or freshly spawning.
   */
  tick(dt: number, itemSizeOf?: (itemType: string) => number): void {
    this.advanceItems(dt);
    this.deliverArrivals();
    this.runPerTickHooks(dt, itemSizeOf);
    if (itemSizeOf) this.enforceItemSpacing(itemSizeOf);
    this.tickCount += 1;
  }

  private advanceItems(dt: number): void {
    for (const inFlight of this.items.values()) {
      const edge = this.graph.getEdge(inFlight.edgeId);
      if (!edge || !edge.active) continue; // gated off: holds position, doesn't lose progress
      inFlight.progress = Math.min(1, inFlight.progress + edge.flowRate * dt);
    }
  }

  /**
   * No-overlap spacing (Falcon, 2026-09-09 — "is it possible to never
   * overlap the items ... i want them to behave like objects like it
   * respects the size of the object along a path"): for every edge
   * with two or more in-flight items opted in (`respectItemSize`),
   * walk from the item CLOSEST to arrival (largest progress — "ahead")
   * back toward the newest ("behind"), and hold each trailing item
   * back so it never closes to less than the combined world-space
   * size of the two items apart (his choice: each item's own size vs.
   * the one ahead), converted into progress units via this edge's own
   * bridged `pathLength`.
   *
   * Deliberately NOT floored at 0 (an earlier version was, and it was
   * wrong — caught empirically): a source spawning faster than a
   * congested edge can absorb piles up several items wanting to sit
   * "at the very start" in the same tick; flooring every one of them
   * at exactly progress 0 just moves the overlap from mid-path to the
   * entry point instead of removing it. Letting a fully-blocked
   * trailing item's progress go negative instead gives it its own
   * place in a virtual queue that extends backward past the path's
   * own start — same shape as a real line of objects backed up behind
   * a doorway, each still its own size apart even though none of them
   * have gone through it yet. A negative-progress item is simply not
   * drawn (FluxCanvas skips it, same idea as culling anything else
   * off-bounds) until its own turn arrives and its progress climbs
   * back past 0.
   */
  private enforceItemSpacing(itemSizeOf: (itemType: string) => number): void {
    const byEdge = new Map<EdgeId, InFlightItem[]>();
    for (const inFlight of this.items.values()) {
      const edge = this.graph.getEdge(inFlight.edgeId);
      if (!edge || !this.spacingEnabled(edge)) continue;
      let list = byEdge.get(inFlight.edgeId);
      if (!list) {
        list = [];
        byEdge.set(inFlight.edgeId, list);
      }
      list.push(inFlight);
    }

    for (const [edgeId, list] of byEdge) {
      const edge = this.graph.getEdge(edgeId);
      if (!edge || !edge.pathLength) continue;
      list.sort((a, b) => b.progress - a.progress);
      for (let i = 1; i < list.length; i++) {
        const ahead = list[i - 1]!;
        const behind = list[i]!;
        const gapWorld = itemSizeOf(ahead.item.type) + itemSizeOf(behind.item.type);
        const gapProgress = gapWorld / edge.pathLength;
        const maxAllowed = ahead.progress - gapProgress;
        if (behind.progress > maxAllowed) {
          behind.progress = maxAllowed;
        }
      }
    }
  }

  /** Falcon, 2026-09-09 ("i want it to be by default to respect item
   * sizes"): whether size-based spacing actually applies to `edge` —
   * true unless a specific edge explicitly opted out
   * (`respectItemSize === false`), or the edge hasn't had its
   * `pathLength` bridged in yet, or it's a `dock` edge (a dock's huge
   * flowRate and near-zero seam length make size-based spacing
   * meaningless there, and enforcing it risked reintroducing the exact
   * docked-chain stall design doc §5.8 fixed). Shared by both
   * enforceItemSpacing and sourceHasRoomToSpawn so the two features
   * agree on exactly which edges are "spacing edges." */
  private spacingEnabled(edge: EdgeDef): boolean {
    return edge.edgeKind !== 'dock' && edge.respectItemSize !== false && !!edge.pathLength && edge.pathLength > 0;
  }

  /** Falcon, 2026-09-09 ("i want to implement an auto deactivate on
   * the source node once the path is filled"): true unless spawning
   * one more item of `node`'s configured itemType, right now, onto its
   * first active output edge, would immediately violate that edge's
   * own item-spacing rule (see enforceItemSpacing) — i.e. there's
   * genuinely nowhere left to put it without it landing behind the
   * path's own start. Mirrors source.ts's own port selection
   * (`outputEdges.find(e => e.active)`) and itemType fallback exactly,
   * so this always asks the question about the SAME edge/item trySpawn
   * would actually use. An edge that isn't a spacing edge at all (see
   * spacingEnabled) always reports room — this feature only exists
   * because spacing exists; a source feeding an edge with no size
   * enforcement keeps its old always-spawn behavior untouched. */
  private sourceHasRoomToSpawn(node: NodeDef, outputEdges: EdgeDef[], itemSizeOf: (itemType: string) => number): boolean {
    const edge = outputEdges.find((e) => e.active);
    if (!edge || !this.spacingEnabled(edge)) return true;

    let nearest: InFlightItem | undefined;
    for (const inFlight of this.items.values()) {
      if (inFlight.edgeId !== edge.id) continue;
      if (!nearest || inFlight.progress < nearest.progress) nearest = inFlight;
    }
    if (!nearest) return true;

    const itemType = typeof node.config.itemType === 'string' ? node.config.itemType : 'item';
    const gapWorld = itemSizeOf(itemType) + itemSizeOf(nearest.item.type);
    const gapProgress = gapWorld / edge.pathLength!;
    return nearest.progress >= gapProgress;
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

  /** Read-only accessors for the current runtime state, handed to
   * PerTickHooks that need to see beyond their own node (today: only
   * sensor's `evaluateSignals`, design doc §4.8) -- see NodeTickContext's
   * own doc comment in contract.ts. */
  private makeTickContext(): NodeTickContext {
    return {
      getNode: (id) => this.graph.getNode(id),
      getNodeState: (id) => this.runtime.get(id),
      getInputEdges: (id) => this.graph.inputEdges(id),
    };
  }

  /**
   * Falcon, 2026-09-09 ("on source node's properties i want it off by
   * default meaning its not spawning any item unless toggled on ...
   * i want to implement an auto deactivate on the source node once
   * the path is filled ... [resuming] auto ... once theres room"):
   * a source's `active`/`autoDeactivated` flags live in its own
   * `node.config` (persisted, the same place cooldown/itemType
   * already live) rather than runtime state — a Properties panel
   * checkbox needs to read/write it directly via
   * GraphModel.updateNodeConfig, the one write path every other
   * per-node field already goes through, and SimEngine has no other
   * bridge to a live per-tick runtime store from outside itself.
   *
   * `active !== false` is "should this source be trying to spawn
   * right now" (his choice: new sources default OFF via
   * defaultConfigFor in App.tsx; sources from before this feature, or
   * loaded from an old save, have no `active` field at all and keep
   * spawning exactly as they always did — undefined here still means
   * the OLD default, unlike respectItemSize). `autoDeactivated` marks
   * WHY it's off: true only when SimEngine itself flipped it off for
   * running out of room, as opposed to a person turning it off on
   * purpose — only an auto-deactivated source is ever auto-resumed;
   * a manual off stays off until a person flips it back themselves.
   */
  private sourceActivationGate(node: NodeDef, outputEdges: EdgeDef[], itemSizeOf?: (itemType: string) => number): boolean {
    if (node.kind !== 'source') return true;

    const manuallyActive = node.config.active !== false;
    const autoDeactivated = node.config.autoDeactivated === true;

    if (!manuallyActive) {
      if (!itemSizeOf || !autoDeactivated || !this.sourceHasRoomToSpawn(node, outputEdges, itemSizeOf)) {
        return false;
      }
      // Room opened back up on the exact edge that filled it -- this
      // was the system's own doing, not a person's choice, so it's the
      // system's to undo.
      this.graph.updateNodeConfig(node.id, { active: true, autoDeactivated: false });
    }

    if (itemSizeOf && !this.sourceHasRoomToSpawn(node, outputEdges, itemSizeOf)) {
      this.graph.updateNodeConfig(node.id, { active: false, autoDeactivated: true });
      return false;
    }

    return true;
  }

  private runPerTickHooks(dt: number, itemSizeOf?: (itemType: string) => number): void {
    const ctx = this.makeTickContext();
    for (const node of this.graph.getAllNodes()) {
      const behavior = nodeHandlers[node.kind];
      if (!behavior) continue;

      const outputEdges = this.graph.outputEdges(node.id);

      if (behavior.trySpawn && this.sourceActivationGate(node, outputEdges, itemSizeOf)) {
        const state = this.runtime.get(node.id) ?? {};
        const result = behavior.trySpawn(node, state, outputEdges, dt, () => this.nextItemId(), ctx);
        this.runtime.set(node.id, result.newState);
        this.applyActions(result.actions, node.id);
      }

      if (behavior.tryDrain) {
        const state = this.runtime.get(node.id) ?? {};
        const result = behavior.tryDrain(node, state, outputEdges, dt, () => this.nextItemId(), ctx);
        this.runtime.set(node.id, result.newState);
        this.applyActions(result.actions, node.id);
      }

      if (behavior.evaluateSignals) {
        const state = this.runtime.get(node.id) ?? {};
        const result = behavior.evaluateSignals(node, state, outputEdges, dt, () => this.nextItemId(), ctx);
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
      } else if (action.type === 'signal') {
        // Design doc §5.5 -- a signal never becomes an in-flight item;
        // it's written straight into the TARGET node's runtime state
        // (not the emitting Sensor's), bypassing progress/arrival
        // entirely.
        const edge = this.graph.getEdge(action.edgeId);
        if (!edge) continue;
        const targetState = this.runtime.get(edge.target) ?? {};
        this.runtime.set(edge.target, { ...targetState, open: action.value });
        this.events.push({
          kind: 'signaled',
          itemId: '',
          nodeId: edge.target,
          edgeId: action.edgeId,
          value: action.value,
        });
      }
    }
  }
}
