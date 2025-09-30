import { Router } from 'express';
import { testDB } from './db';
import { testRedis } from './redisClient';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const db = await testDB(); // { ok: 1 }
    const r = await testRedis(); // "PONG"
    res.json({
      ok: true,
      env: process.env.NODE_ENV || 'development',
      db: db ? 'connected' : 'missing',
      redis: r === 'PONG' ? 'connected' : 'missing',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: (err as Error).message,
    });
  }
});

export default router;
