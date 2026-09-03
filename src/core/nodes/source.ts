import type { Item } from '../types';
import type { NodeBehavior, PerTickHook } from './contract';

/**
 * Source — 0 inputs, so it never receives onItemArrival; SimEngine
 * calls trySpawn once per tick instead (design doc §4.2, §4.3).
 */
const trySpawn: PerTickHook = (node, state, outputEdges, dt, makeItemId) => {
  const cooldown = typeof node.config.cooldown === 'number' ? node.config.cooldown : 1;
  const itemType = typeof node.config.itemType === 'string' ? node.config.itemType : 'item';
  const cooldownRemaining = typeof state.cooldownRemaining === 'number' ? state.cooldownRemaining : cooldown;

  if (cooldownRemaining > 0) {
    return { newState: { ...state, cooldownRemaining: cooldownRemaining - dt }, actions: [] };
  }

  // v1: single-output source. Picks the first active edge; if none is
  // active/available, the item simply isn't spawned this tick (backs up
  // naturally rather than being lost or force-created).
  const target = outputEdges.find((e) => e.active);
  if (!target) {
    return { newState: state, actions: [] };
  }

  const item: Item = { id: makeItemId(), type: itemType };
  const spawnedCount = typeof state.spawnedCount === 'number' ? state.spawnedCount : 0;
  return {
    newState: { ...state, cooldownRemaining: cooldown, spawnedCount: spawnedCount + 1 },
    actions: [{ type: 'send', edgeId: target.id, item }],
  };
};

export const sourceBehavior: NodeBehavior = { trySpawn };
