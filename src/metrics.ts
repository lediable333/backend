// src/metrics.ts
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

// Single registry used by the app (exported so Prometheus / tests can use it)
export const register = new Registry();

// Collect default Node/JS runtime metrics into our registry
collectDefaultMetrics({ register });

// --------------------
// Counters
// --------------------
export const spinsTotal = new Counter({
  name: 'spins_total',
  help: 'Total spins attempted',
  registers: [register],
});

export const spinsSuccessTotal = new Counter({
  name: 'spins_success_total',
  help: 'Total successful spins',
  registers: [register],
});

export const spinsFailureTotal = new Counter({
  name: 'spins_failure_total',
  help: 'Total failed spins',
  registers: [register],
});

// Supply depletion counter
export const supplyDepletedTotal = new Counter({
  name: 'supply_depleted_total',
  help: 'Counts times a finite prize supply hit zero',
  registers: [register],
});

// HTTP requests counter (optional, useful for Alert rules)
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests total, labeled by method,job,status',
  labelNames: ['method', 'job', 'status'],
  registers: [register],
});

// --------------------
// Histograms
// --------------------
export const spinDrawDurationSeconds = new Histogram({
  name: 'spin_draw_duration_seconds',
  help: 'Time spent inside drawIndex (seconds)',
  // buckets tuned for sub-second operation
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

// --------------------
// Gauges
// --------------------
export const userBalanceGauge = new Gauge({
  name: 'user_balance',
  help: 'Current ticket balance for a user (label=userId). Use with caution (high cardinality).',
  labelNames: ['userId'],
  registers: [register],
});

export const prizeSupplyGauge = new Gauge({
  name: 'prize_supply_remaining',
  help: 'Remaining supply for a session slot (labels: sessionId, slotIndex).',
  labelNames: ['sessionId', 'slotIndex'],
  registers: [register],
});

// --------------------
// Play-Integrity counters (routes import these names)
export const piNonceIssuedTotal = new Counter({
  name: 'pi_nonce_issued_total',
  help: 'Play-Integrity nonces issued',
  registers: [register],
});
export const piVerifyTotal = new Counter({
  name: 'pi_verify_total',
  help: 'Play-Integrity verify attempts',
  registers: [register],
});
export const piVerifySuccessTotal = new Counter({
  name: 'pi_verify_success_total',
  help: 'Successful Play-Integrity verifications',
  registers: [register],
});
export const piVerifyFailureTotal = new Counter({
  name: 'pi_verify_failure_total',
  help: 'Failed Play-Integrity verifications',
  registers: [register],
});

// --------------------
// Helpers (backwards compatible names used in codebase)
// --------------------
export function startSpinDrawTimer() {
  return spinDrawDurationSeconds.startTimer();
}

export function setUserBalance(userId: string, balance: number) {
  try {
    // guard against bad label values causing exceptions
    userBalanceGauge.labels(String(userId)).set(Number(balance));
  } catch (e) {
    // never throw from metrics
    // console.debug('setUserBalance metric error', e);
  }
}

export function setPrizeSupply(
  sessionId: string,
  slotIndex: number | string,
  supply: number | null,
) {
  try {
    const slot = String(slotIndex);
    if (supply === null || supply === undefined) {
      // remove label if infinite/unknown
      prizeSupplyGauge.remove(sessionId, slot);
    } else {
      prizeSupplyGauge.labels(sessionId, slot).set(Number(supply));
      if (Number(supply) === 0) {
        supplyDepletedTotal.inc();
      }
    }
  } catch (e) {
    // swallow metric errors
  }
}

// Export default register already above; also export for easy import-by-other code
export default register;
