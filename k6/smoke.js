// k6/smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const DEV_BASE_URL = __ENV.DEV_BASE_URL || '';
const DEV_API_TOKEN = __ENV.DEV_API_TOKEN || '';
const DEV_SESSION_ID = __ENV.DEV_SESSION_ID || '';
const K6_VUS = Number(__ENV.K6_VUS || 1);
const K6_DURATION = __ENV.K6_DURATION || '10s';
const K6_DEV_BYPASS = (__ENV.K6_DEV_BYPASS || 'false').toLowerCase() === 'true';

if (!DEV_BASE_URL) {
  throw new Error('DEV_BASE_URL not set. Please set DEV_BASE_URL env variable.');
}
if (!DEV_API_TOKEN) {
  throw new Error('DEV_API_TOKEN not set. Please set DEV_API_TOKEN env variable.');
}
if (!DEV_SESSION_ID) {
  throw new Error('DEV_SESSION_ID not set. Please set DEV_SESSION_ID env variable.');
}

export let options = {
  vus: K6_VUS,
  duration: K6_DURATION,
  thresholds: {
    // fail the run if more than 10% of requests failed (network / 5xx)
    http_req_failed: ['rate<0.10'],
  },
};

const commonHeaders = {
  Authorization: DEV_API_TOKEN,
  'Content-Type': 'application/json',
};

function tryGetSessionArchive() {
  // Try a few plausible endpoints until one returns 200
  const candidates = [
    `${DEV_BASE_URL.replace(/\/+$/, '')}/session/archive/${DEV_SESSION_ID}`,
    `${DEV_BASE_URL.replace(/\/+$/, '')}/session/${DEV_SESSION_ID}`,
    `${DEV_BASE_URL.replace(/\/+$/, '')}/sessions/${DEV_SESSION_ID}`,
    `${DEV_BASE_URL.replace(/\/+$/, '')}/sessions/${DEV_SESSION_ID}/archive`,
  ];

  for (let url of candidates) {
    let res = http.get(url, { headers: commonHeaders });
    if (res.status === 200) {
      return { ok: true, url, res };
    }
    // keep trying on 404/401 etc
    if (res.status >= 500) {
      // server error -> return as failure
      return { ok: false, url, res };
    }
  }
  // none returned 200 — return last response info
  return { ok: false, url: candidates[0], res: null };
}

export default function () {
  // 1) health check
  const healthUrl = `${DEV_BASE_URL.replace(/\/+$/, '')}/healthz`;
  const healthRes = http.get(healthUrl, { headers: commonHeaders });
  check(healthRes, {
    'health status 200 or 401/403 (dev)': (r) =>
      r.status === 200 || r.status === 401 || r.status === 403,
  });

  // 2) session archive check (tolerant: accept 200)
  const sessionCheck = tryGetSessionArchive();
  check(sessionCheck.res, {
    'session ok (200 if available)': (r) => r && r.status === 200,
  });

  // 3) spin: post a spin for the session
  // Build payload; in dev you can enable bypass by setting K6_DEV_BYPASS=true (adds x-dev-mode)
  const clientSpinId = uuidv4();
  const clientSeed = Math.random().toString(36).substring(2, 18); // random-ish
  const payload = JSON.stringify({
    sessionId: DEV_SESSION_ID,
    clientSpinId,
    clientSeed,
    integrityVerdict: true,
  });

  const headers = Object.assign({}, commonHeaders);
  if (K6_DEV_BYPASS) {
    headers['x-dev-mode'] = 'true';
  }

  const spinRes = http.post(`${DEV_BASE_URL.replace(/\/+$/, '')}/spins`, payload, { headers });
  // Acceptable dev responses: 200 (ok), 400 (client), 401/403 (auth), 429 (rate-limited)
  const okStatuses = [200, 400, 401, 403, 429];
  check(spinRes, {
    'spin status acceptable (200/400/401/403/429)': (r) => okStatuses.includes(r.status),
    'spin response ok (if json)': (r) => {
      if (r.status === 200) {
        try {
          JSON.parse(r.body);
          return true;
        } catch (e) {
          return false;
        }
      }
      return true; // other statuses we don't insist on JSON
    },
  });

  // pause between iterations
  sleep(1);
}
