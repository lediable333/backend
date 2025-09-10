// src/index.ts
import 'dotenv/config';
import express from 'express';
import healthRoute from './health';
import adminRoute from './routes/admin';
import spinsRoute from './routes/spins';

const app = express();

/**
 * Use express.json with a verify hook so we capture the raw bytes
 * in req.rawBody while still allowing express to populate req.body.
 * Some clients (PowerShell variations, etc.) send JSON in ways that
 * can cause the body parser to not populate req.body; rawBody lets
 * our routes attempt a fallback parse.
 */
app.use(
  express.json({
    verify: (req: any, _res, buf: Buffer) => {
      if (buf && buf.length) (req as any).rawBody = buf;
    },
    limit: '1mb',
  }),
);

// also accept urlencoded bodies (some clients)
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRoute);
app.use('/admin', adminRoute);
app.use('/spins', spinsRoute);

// Minimal fallback root health
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
