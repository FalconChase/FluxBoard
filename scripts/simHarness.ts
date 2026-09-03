/**
 * Console test harness for Milestone 1 (design doc §9, step 1).
 * Builds one source -> one sink, runs the sim headless for a fixed
 * number of ticks, and prints a conservation report. Run with:
 *
 *   npx tsx scripts/simHarness.ts
 */
import { GraphModel } from '../src/core/GraphModel';
import { SimEngine } from '../src/core/SimEngine';

const graph = new GraphModel();
graph.addNode({ id: 'src', kind: 'source', config: { cooldown: 4, itemType: 'widget' } });
graph.addNode({ id: 'snk', kind: 'sink', config: {} });
graph.addEdge({
  id: 'e1',
  source: 'src',
  target: 'snk',
  sourcePort: 0,
  targetPort: 0,
  flowRate: 0.2,
  active: true,
});

const engine = new SimEngine(graph);

let spawned = 0;
let consumed = 0;
const TICKS = 200;

for (let i = 0; i < TICKS; i++) {
  engine.tick(1);
  for (const event of engine.drainEvents()) {
    if (event.kind === 'spawned') spawned += 1;
    if (event.kind === 'consumed') consumed += 1;
    console.log(`tick ${i}: ${event.kind} ${event.itemId}`);
  }
}

const inFlight = engine.getItemsInFlight().length;
const sinkState = engine.getNodeState('snk');

console.log('\n--- report ---');
console.log(`ticks run:        ${TICKS}`);
console.log(`items spawned:    ${spawned}`);
console.log(`items consumed:   ${consumed}`);
console.log(`items in flight:  ${inFlight}`);
console.log(`sink consumedCount matches events: ${sinkState?.consumedCount === consumed}`);
console.log(`conservation holds (spawned == consumed + inFlight): ${spawned === consumed + inFlight}`);

if (spawned !== consumed + inFlight) {
  console.error('CONSERVATION VIOLATION');
  process.exit(1);
}
