// src/routes/admin.ts
import { Router } from 'express';
import { pool, withTransaction } from '../db';
import { generateServerSeedHex, sha256Hex, encryptSeed, decryptSeed } from '../security';

const router = Router();

/**
 * Very small dev/admin check. In production replace this with proper auth.
 */
function requireAdmin(req: any) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return true; // dev convenience if unset
  const header = req.header && req.header('x-admin-key');
  return header === adminKey;
}

/**
 * Robust body reader:
 *  - prefer req.body (parsed by express.json)
 *  - else try req.rawBody (Buffer captured by verify)
 *  - else try to parse string body if present
 */
function getBody(req: any): any {
  // prefer already-parsed json (object with keys)
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return req.body;

  // if raw buffer was captured by express.json verify hook
  if (req.rawBody && req.rawBody.length) {
    try {
      return JSON.parse(req.rawBody.toString('utf8'));
    } catch (e) {
      // ignore parse errors; fallthrough
    }
  }

  // sometimes req.body is a string (depending on client)
  if (typeof req.body === 'string' && req.body.length) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      // ignore
    }
  }

  // nothing parsable found
  return {};
}

/**
 * POST /admin/sessions
 * Body: { title?: string, wheelSize?: number, configJson?: object, publish?: boolean }
 */
router.post('/sessions', async (req: any, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ ok: false, message: 'unauthorized' });

  // debug helpers you can uncomment while testing:
  // console.log('DEBUG req.headers:', req.headers);
  // console.log('DEBUG req.body (raw):', typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  // console.log('DEBUG req.rawBody:', req.rawBody ? req.rawBody.toString('utf8') : null);

  const body = getBody(req) || {};
  // ALWAYS destructure from a safe object (body) — avoids "cannot destructure undefined"
  const {
    title,
    wheelSize = 17,
    configJson = {},
    publish = false,
  } = body as {
    title?: string;
    wheelSize?: number;
    configJson?: any;
    publish?: boolean;
  };

  // basic validation:
  if (typeof wheelSize !== 'number' || wheelSize <= 0) {
    return res.status(400).json({ ok: false, error: 'invalid wheelSize' });
  }

  try {
    const result = await withTransaction(async (client) => {
      // insert session
      const insert = await client.query(
        `INSERT INTO session (title, wheel_size, config_json)
         VALUES ($1,$2,$3) RETURNING id`,
        [title ?? null, wheelSize, configJson],
      );
      const sessionId = insert.rows[0].id;

      if (publish) {
        // generate server seed, store hash in DB and encrypted seed in secret storage
        const serverSeed = generateServerSeedHex();
        const serverSeedHash = sha256Hex(serverSeed);
        const snapshotHash = sha256Hex(JSON.stringify(configJson));
        const serverSeedEnc = encryptSeed(serverSeed);

        await client.query(
          `UPDATE session
           SET server_seed_hash = $1, server_seed_enc = $2, config_json = $3, snapshot_hash = $4, published_at = now()
           WHERE id = $5`,
          [serverSeedHash, serverSeedEnc, configJson, snapshotHash, sessionId],
        );

        return { sessionId, serverSeedHash, published: true };
      }

      return { sessionId, published: false };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * POST /admin/sessions/:id/end
 */
router.post('/sessions/:id/end', async (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ ok: false, message: 'unauthorized' });
  const sessionId = req.params.id;
  try {
    await pool.query('UPDATE session SET ended_at = now() WHERE id = $1', [sessionId]);
    return res.json({ ok: true, sessionId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * POST /admin/sessions/:id/reveal
 */
router.post('/sessions/:id/reveal', async (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ ok: false, message: 'unauthorized' });
  const sessionId = req.params.id;
  try {
    const s = await pool.query(
      'SELECT server_seed_enc, server_seed_hash, ended_at, server_seed_revealed FROM session WHERE id = $1',
      [sessionId],
    );
    if (s.rowCount === 0) return res.status(404).json({ ok: false, message: 'session not found' });
    const row = s.rows[0];
    if (!row.ended_at) return res.status(400).json({ ok: false, message: 'session not ended yet' });
    if (row.server_seed_revealed)
      return res.status(400).json({ ok: false, message: 'server seed already revealed' });
    if (!row.server_seed_enc)
      return res.status(500).json({ ok: false, message: 'no server seed stored' });

    const serverSeed = decryptSeed(row.server_seed_enc);

    await pool.query('UPDATE session SET server_seed_revealed = true WHERE id = $1', [sessionId]);

    return res.json({ ok: true, sessionId, serverSeed, serverSeedHash: row.server_seed_hash });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
