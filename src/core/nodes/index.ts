import type { NodeDef } from '../types';
import type { NodeBehavior } from './contract';
import { sourceBehavior } from './source';
import { sinkBehavior } from './sink';
import { distributorBehavior } from './distributor';
import { mergerBehavior } from './merger';
import { sorterBehavior } from './sorter';
import { mixerBehavior } from './mixer';
import { bufferBehavior } from './buffer';
import { gateBehavior } from './gate';
import { sensorBehavior } from './sensor';
import { counterBehavior } from './counter';
import { commandBehavior } from './command';
import { transformBehavior } from './transform';
import { timeBehavior } from './time';

export * from './contract';
export { hasSignalInput } from './gate';
export { watchedNodeIds } from './sensor';
export { defaultVerbForTargetKind } from './command';

/**
 * Node-kind behavior registry — SimEngine dispatches to this by
 * NodeDef.kind. Each kind's logic lives in its own file; this module
 * just assembles them (design doc §4.2, §4.3, §9 step 3).
 */
export const nodeHandlers: Partial<Record<NodeDef['kind'], NodeBehavior>> = {
  source: sourceBehavior,
  sink: sinkBehavior,
  distributor: distributorBehavior,
  merger: mergerBehavior,
  sorter: sorterBehavior,
  mixer: mixerBehavior,
  buffer: bufferBehavior,
  gate: gateBehavior,
  sensor: sensorBehavior,
  counter: counterBehavior,
  command: commandBehavior,
  transform: transformBehavior,
  time: timeBehavior,
};
