import type { Item } from '../types';
import type { NodeBehavior, OnItemArrival } from './contract';
import { targetBufferIsFull } from './backpressure';

/**
 * Transform (2026-09-10 — originally explored as a "Mixer used with a
 * single input/output port, converting item type A to B" during the
 * §4.8 node-design session and explicitly dropped there by Falcon;
 * revisited and built the same day: "now i want to introduce the
 * transform node"). Scoped over three quick confirmations:
 *  - Port shape: 1 real item input, 1 real item output (not Mixer's
 *    real multi-input recipe shape).
 *  - Timing: instant passthrough — an arriving item is relabeled and
 *    forwarded the SAME tick, no processing delay and no rate cap
 *    (unlike a Buffer-style hold or Mixer's recipe-buffering).
 *  - Recipe scope: one FIXED A -> B rule per node (`config.inputType`
 *    -> `config.outputType`), not a Sorter-style rule list — several
 *    conversions on one graph means several Transform nodes, same
 *    "one job per node" shape Gate/Counter/Command already keep.
 *
 * Deliberately does NOT gatekeep on `inputType` — every arriving item
 * is relabeled to `outputType` regardless of what it arrived as.
 * `inputType` is kept in config purely as the node's own label of what
 * it expects to receive (shown in PropertiesPanel, reads clearly on
 * the node itself as "A -> B"), not as a filter — that's a Sorter or
 * Gate's job, not this one's. If a stricter "only my configured
 * inputType may pass, anything else refused" mode turns out to be
 * wanted later, that's a one-line change here (return `accepted:
 * false` on a mismatch instead of forwarding it through relabeled).
 *
 * Reuses the same downstream-capacity check every other pure-forward
 * kind already shares (Distributor/Counter/Buffer's own tryDrain — see
 * backpressure.ts) rather than inventing a Transform-specific one.
 */
const onItemArrival: OnItemArrival = (item, node, state, outputEdges, _arrivalEdge, _makeItemId, ctx) => {
  const target = outputEdges.find((e) => e.active && e.edgeKind !== 'signal');
  if (!target) {
    return { newState: state, actions: [], accepted: false };
  }
  if (targetBufferIsFull(target, ctx)) {
    return { newState: state, actions: [], accepted: false };
  }

  const outputType = typeof node.config.outputType === 'string' ? node.config.outputType : item.type;
  const outgoing: Item = outputType === item.type ? item : { ...item, type: outputType };

  const convertedCount = typeof state.convertedCount === 'number' ? state.convertedCount : 0;
  return {
    newState: { ...state, convertedCount: convertedCount + 1 },
    actions: [{ type: 'forward', edgeId: target.id, item: outgoing }],
  };
};

export const transformBehavior: NodeBehavior = { onItemArrival };
