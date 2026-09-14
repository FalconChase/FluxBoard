import type { NodeBehavior, PerTickHook } from './contract';

/**
 * Time (2026-09-11, Command/Counter/Time trigger-system extension) —
 * a clock/timer node, zero physical ports (same "pure state" shape as
 * Sensor/Command — no onItemArrival at all, see portCapacity.ts). Runs
 * its own internal clock unconditionally every tick via this `onTick`
 * hook — reusing the same "runs regardless of arrivals, housekeeping
 * every tick" slot Counter's own reset-detection already uses (see
 * contract.ts's NodeBehavior.onTick doc comment).
 *
 * v1 config (node.config):
 *  - mode: 'countdown' (default) — counts DOWN from `duration` to 0
 *    and holds there once it hits 0, or 'countup' — counts UP from 0
 *    with no ceiling ("and more" mode from the original design chat).
 *  - duration: seconds the countdown starts from (default 10). Ignored
 *    in 'countup' mode.
 *
 * `state.value` is the live clock reading — what a Sensor watching
 * this node reads via the new 'timeValue' metric (sensor.ts's
 * readMetric), the exact same "read some other node's live runtime
 * state" shape a Sensor already uses for a Buffer's `queue.length` or
 * a Counter's `count`. Time never emits anything itself — it's watched,
 * not an emitter (design doc's own framing: "Sensor is the ONLY signal
 * emitter in the whole system").
 *
 * Reset is Command-only (confirmed via AskUserQuestion — leaning
 * "any" in the original design chat, but Falcon picked Command only
 * once asked directly): a Command node wired/docked to this Time's one
 * signal-only input slot (portCapacity.ts) relays its Sensor's level
 * straight into `state.open`, the exact same generic mechanism
 * Gate/Source/Counter already receive it through. This hook treats a
 * RISING edge of that value as "reset now" — mirroring counter.ts's
 * own `commandOpen && !lastCommandOpen` convention exactly, including
 * why it has to be edge-detected rather than read as a continuous
 * level: Command relays its Sensor's condition every tick, so reading
 * `open` directly would re-reset this clock on every tick for as long
 * as that condition holds, never letting it run.
 */
const onTick: PerTickHook = (node, state, _outputEdges, dt) => {
  const mode = node.config.mode === 'countup' ? 'countup' : 'countdown';
  const duration = typeof node.config.duration === 'number' && node.config.duration > 0 ? node.config.duration : 10;
  const startValue = mode === 'countdown' ? duration : 0;

  const commandOpen = state.open === true;
  const lastCommandOpen = state.lastCommandOpen === true;
  const commandReset = commandOpen && !lastCommandOpen;

  let value = typeof state.value === 'number' ? state.value : startValue;

  if (commandReset) {
    value = startValue;
  } else if (mode === 'countdown') {
    value = Math.max(0, value - dt);
  } else {
    value = value + dt;
  }

  return {
    newState: { ...state, value, lastCommandOpen: commandOpen },
    actions: [],
  };
};

export const timeBehavior: NodeBehavior = { onTick };
