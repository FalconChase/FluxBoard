import type { NodeBehavior, OnItemArrival } from './contract';

const onItemArrival: OnItemArrival = (item, _node, state) => {
  const consumedCount = typeof state.consumedCount === 'number' ? state.consumedCount : 0;
  return {
    newState: { ...state, consumedCount: consumedCount + 1 },
    actions: [{ type: 'consume', item }],
  };
};

export const sinkBehavior: NodeBehavior = { onItemArrival };
