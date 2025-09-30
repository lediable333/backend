// src/metrics.ts
import client from 'prom-client';

const register = client.register;

// collect node/go default metrics (process, heap, etc)
// `timeout` option is no longer supported in new prom-client
client.collectDefaultMetrics({ register });

// COUNTERS
export const spinsTotal = new client.Counter({
  name: 'spins_total',
  help: 'Total number of spin attempts (incremented for every request)',
});

export const spinsSuccessTotal = new client.Counter({
  name: 'spins_success_total',
  help: 'Number of spins that completed successfully',
});

export const spinsFailureTotal = new client.Counter({
  name: 'spins_failure_total',
  help: 'Number of spins that failed (validation, rate-limit, internal errors, etc)',
});

// Play Integrity (PI) counters
export const piNonceIssuedTotal = new client.Counter({
  name: 'pi_nonce_issued_total',
  help: 'Number of play-integrity nonces issued',
});

export const piVerifyTotal = new client.Counter({
  name: 'pi_verify_total',
  help: 'Number of play-integrity verifications attempted',
});

export const piVerifySuccessTotal = new client.Counter({
  name: 'pi_verify_success_total',
  help: 'Number of play-integrity verification successes',
});

export const piVerifyFailureTotal = new client.Counter({
  name: 'pi_verify_failure_total',
  help: 'Number of play-integrity verification failures',
});

// HISTOGRAM (timing)
export const spinDrawSeconds = new client.Histogram({
  name: 'spin_draw_seconds',
  help: 'Time taken to compute/draw the spin index (seconds)',
  buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2],
});

// GAUGES
export const userBalanceGauge = new client.Gauge({
  name: 'user_balance',
  help: 'Last known user balance (labelled by user_id)',
  labelNames: ['user_id'],
});

export const prizeSupplyGauge = new client.Gauge({
  name: 'prize_supply',
  help: 'Current prize supply per session and slot index',
  labelNames: ['session_id', 'slot_index'],
});

// helpers
export function startSpinDrawTimer(): () => void {
  return spinDrawSeconds.startTimer();
}

export function setUserBalance(userId: string | number, balance: number) {
  userBalanceGauge.set({ user_id: String(userId) }, Number(balance));
}

export function setPrizeSupply(
  sessionId: string,
  slotIndex: number | string,
  supply: number | null,
) {
  if (supply === null) {
    prizeSupplyGauge.set({ session_id: sessionId, slot_index: String(slotIndex) }, NaN);
  } else {
    prizeSupplyGauge.set({ session_id: sessionId, slot_index: String(slotIndex) }, Number(supply));
  }
}

// explicitly export register so index.ts can use it
export { register };
export { client as promClient };
export default {
  spinsTotal,
  spinsSuccessTotal,
  spinsFailureTotal,
  startSpinDrawTimer,
  setUserBalance,
  setPrizeSupply,
  piNonceIssuedTotal,
  piVerifyTotal,
  piVerifySuccessTotal,
  piVerifyFailureTotal,
  spinDrawSeconds,
  userBalanceGauge,
  prizeSupplyGauge,
  register,
};
