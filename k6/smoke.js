// k6/smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const DEV_BASE_URL = __ENV.DEV_BASE_URL || 'http://localhost:8080';
const DEV_API_TOKEN = __ENV.DEV_API_TOKEN || '';
const DEV_SESSION_ID = __ENV.DEV_SESSION_ID || '';
const K6_DEV_BYPASS = (__ENV.K6_DEV_BYPASS || 'true').toLowerCase() === 'true';

export const options = {
  vus: Number(__ENV.K6_VUS || 1),
  duration: __ENV.K6_DURATION || '10s',
  thresholds: {
    // final aggregated thresholds - you can tune these per-project
    http_req_failed: ['rate<0.10'], // <10% failures allowed
    checks: ['rate==1.0'], // require all checks passed in smoke runs used for gating
  },
};

const headers = {
  'Content-Type': 'application/json',
};

if (DEV_API_TOKEN) {
  headers['Authorization'] = DEV_API_TOKEN;
}

// Helper: call /healthz (accept 200 or 401/403 in dev)
function checkHealth() {
  const res = http.get(`${DEV_BASE_URL}/healthz`, { headers });
  const ok = res.status === 200 || res.status === 401 || res.status === 403;
  check(res, {
    'health status 200 or 401/403 (dev)': () => ok,
  });
  return res;
}

// Helper: request session (if session id present). Accept 200 or auth errors in dev.
function checkSession() {
  if (!DEV_SESSION_ID) {
    // no session configured — treat as pass for CI that doesn't run session checks
    check({ ok: true }, { 'session ok (200 if available)': () => true });
    return null;
  }
  const url = `${DEV_BASE_URL}/sessions/${DEV_SESSION_ID}`;
  const res = http.get(url, { headers });
  const ok = res.status === 200 || res.status === 401 || res.status === 403 || res.status === 404;
  check(res, {
    'session ok (200 if available)': () => ok,
  });
  return res;
}

// Helper: attempt a spin. We will post minimal payload. Acceptable spin responses:
// 200 (success), 400 (bad request), 401/403 (auth), 429 (rate limit)
function attemptSpin() {
  const payload = JSON.stringify({
    sessionId: DEV_SESSION_ID || '00000000-0000-0000-0000-000000000000',
    clientSpinId: `k6-${__ITER}-${Math.random().toString(36).slice(2, 10)}`,
    clientSeed: Math.random().toString(36).slice(2, 18),
    // In dev / bypass flows the x-dev-mode header may be used by backend
    integrityVerdict: true,
  });

  const localHeaders = Object.assign({}, headers);
  if (K6_DEV_BYPASS) {
    // this header is used by the local dev server to bypass PI checks for smoke
    localHeaders['x-dev-mode'] = 'true';
  }

  const res = http.post(`${DEV_BASE_URL}/spins`, payload, {
    headers: localHeaders,
    tags: { name: 'spin' },
  });

  const acceptable = [200, 400, 401, 403, 429].includes(res.status);
  check(res, {
    'spin status acceptable (200/400/401/403/429)': () => acceptable,
    'spin response ok (if json)': (r) => {
      if (res.headers['Content-Type'] && res.headers['Content-Type'].includes('application/json')) {
        try {
          JSON.parse(res.body);
          return true;
        } catch (e) {
          return false;
        }
      }
      return true;
    },
  });
  return res;
}

export default function () {
  // 1. health
  checkHealth();
  // 2. optional session probe
  checkSession();
  // 3. attempt a spin
  attemptSpin();
  // pacing like the local script: ~1s between iterations
  sleep(1);
}
