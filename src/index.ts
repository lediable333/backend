// src/index.ts — load dotenv early
require('dotenv').config({ path: '.env', override: true });

import express from 'express';
import cors from 'cors';
import healthRoute from './health';
import adminRoute from './routes/admin';
import { authMiddleware } from './middleware/auth';
import { register } from './metrics'; // <-- metrics register

// Use robust require pattern for routes (handles default vs named export shapes)
const spinsRoute: any = (require('./routes/spins') as any).default ?? require('./routes/spins');
const playIntegrityRoute: any =
  (require('./routes/playIntegrity') as any).default ?? require('./routes/playIntegrity');

// optional extra router example (if you have it)
const piRouter: any = (require('./routes/pi') as any).default ?? require('./routes/pi');

const app = express();

/**
 * Use express.json with a verify hook so we capture the raw bytes
 * in req.rawBody while still allowing express to populate req.body.
 */
app.use(
  express.json({
    limit: '2mb',
    verify: (req: any, _res, buf) => {
      try {
        req.rawBody = buf;
      } catch (e) {
        // ignore
      }
    },
  }),
);

// optional CORS
app.use(cors());

// health / admin routes
app.use('/_health', healthRoute);
app.use('/admin', adminRoute);

// mount pi router (if present)
if (piRouter) {
  app.use('/pi', piRouter);
  console.log(`[routes] mounted /pi -> ${piRouter && piRouter.name ? piRouter.name : 'piRouter'}`);
} else {
  console.warn('[routes] WARNING: /pi router not found (piRouter is falsy)');
}

// Mount play-integrity and spins routes protected by auth middleware
app.use('/play-integrity', authMiddleware, playIntegrityRoute as any);
app.use('/spins', authMiddleware, spinsRoute as any);

// TEMP: debug what was mounted
console.log(
  '[mount] playIntegrityRoute type:',
  typeof playIntegrityRoute,
  'keys:',
  Object.keys(playIntegrityRoute || {}),
);
console.log('[mount] spinsRoute type:', typeof spinsRoute, 'keys:', Object.keys(spinsRoute || {}));

// metrics endpoint (secured with optional METRICS_AUTH_TOKEN)
app.get('/metrics', async (req, res) => {
  const requiredToken = process.env.METRICS_AUTH_TOKEN?.trim();
  if (requiredToken) {
    // Expect header: Authorization: Bearer <token>
    const auth = (req.headers['authorization'] ?? '') as string;
    const got = auth.replace(/^Bearer\s+/i, '').trim();
    if (!got || got !== requiredToken) {
      return res.status(401).send('unauthorized');
    }
  }

  try {
    res.setHeader('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.status(200).send(metrics);
  } catch (err) {
    console.error('metrics endpoint error', err);
    res.status(500).send('error collecting metrics');
  }
});

// root
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV ?? 'development',
    db: process.env.DATABASE_URL ? 'configured' : 'missing',
    redis: process.env.REDIS_URL ? 'configured' : 'missing',
  });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

export default app;
