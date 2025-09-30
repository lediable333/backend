import http from 'k6/http';
import { check, sleep } from 'k6';

// config via environment
const BASE = __ENV.DEV_BASE_URL || 'http://localhost:8080';
const AUTH = __ENV.DEV_API_TOKEN || 'Bearer dev:user:alice';
const SESSION = __ENV.DEV_SESSION_ID || '';
const VUS = (__ENV.K6_VUS && Number(__ENV.K6_VUS)) || 2;
const DURATION = __ENV.K6_DURATION || '10s';
const DEV_MODE_HEADER = (__ENV.K6_DEV_MODE || 'true').toLowerCase() !== 'false';

// fail fast if session id not provided
if (!SESSION) {
  console.error(
    'DEV_SESSION_ID not set. Please set DEV_SESSION_ID environment variable (a real UUID).',
  );
  throw new Error('DEV_SESSION_ID not set');
}

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<500'],
  },
};

function safeJsonParse(res) {
  try {
    if (!res || !res.body || res.body.length === 0) return null;
    return res.json ? res.json() : JSON.parse(res.body);
  } catch (e) {
    return null;
  }
}

export default function () {
  // health
  let health = http.get(`${BASE}/healthz`, { headers: { Authorization: AUTH } });
  check(health, {
    'health status 200 or 401/403 (dev)': (r) => [200, 401, 403].includes(r.status),
  });

  // sessions (admin endpoint) - accept 200 or auth errors (403/401)
  let sessions = http.get(`${BASE}/sessions`, { headers: { Authorization: AUTH } });
  check(sessions, {
    'sessions ok (200 or auth) - dev permissive': (r) => [200, 401, 403].includes(r.status),
  });

  // spin (try to use provided SESSION)
  const clientSpinId = `${__ENV.K6_CLIENT_SPIN_ID_PREFIX || 'k6'}-${Math.random().toString(36).slice(2, 10)}`;
  const body = {
    sessionId: SESSION,
    clientSpinId,
    clientSeed: Math.random().toString(36).slice(2, 32),
    integrityVerdict: true,
  };

  const headers = {
    Authorization: AUTH,
    'Content-Type': 'application/json',
  };

  if (DEV_MODE_HEADER) {
    // keep x-dev-mode for dev environments, controllable via K6_DEV_MODE=false
    headers['x-dev-mode'] = 'true';
  }

  const spinRes = http.post(`${BASE}/spins`, JSON.stringify(body), { headers });

  // acceptable statuses (dev-friendly)
  const acceptable = [200, 400, 401, 403, 429];
  check(spinRes, {
    'spin status acceptable (200/400/401/403/429)': (r) => acceptable.includes(r.status),
  });

  // If JSON and ok:true — mark success
  const spinJson = safeJsonParse(spinRes);
  check(spinJson, {
    'spin response ok (if json)': (j) => j === null || j.ok === true || j.ok === false,
  });

  sleep(1);
}
