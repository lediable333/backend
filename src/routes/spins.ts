// src/routes/spins.ts
import { Router } from 'express';
import { withTransaction, pool } from '../db';
import { decryptSeed } from '../security';
import { drawIndex, SupplyMap } from '../utils/drawIndex';
import { acquireLock, releaseLock } from '../redisClient'; // optional

const router = Router();

/**
 * POST /spins
 * Body:
 * {
 *   sessionId, userId, clientSpinId, clientSeed, nonce? (startNonce), setId?
 * }
 */
router.post('/', async (req: any, res) => {
  const body =
    (req.body && Object.keys(req.body).length
      ? req.body
      : req.rawBody
        ? JSON.parse(req.rawBody.toString('utf8'))
        : {}) || {};

  const { sessionId, userId, clientSpinId, clientSeed } = body;
  let startNonce = body.nonce ?? 0;
  const setId = body.setId ?? 'default';

  if (!sessionId || !userId || !clientSpinId || clientSeed == null) {
    return res.status(400).json({ ok: false, error: 'missing required fields' });
  }

  // optional per-user redis lock to reduce DB contention (non-blocking)
  const lockKey = `spin_lock:${userId}`;
  let lockToken: string | null = null;
  try {
    lockToken = await acquireLock(lockKey, 4); // 4s
  } catch (_) {
    /* ignore lock errors */
  }

  try {
    const result = await withTransaction(async (client) => {
      // 1) select session and prize_supply (FOR UPDATE)
      const sQ = await client.query(
        `SELECT id, wheel_size, server_seed_enc, server_seed_hash, published_at, ended_at
         FROM session WHERE id = $1 FOR UPDATE`,
        [sessionId],
      );
      if (sQ.rowCount === 0) throw new Error('session not found');
      const session = sQ.rows[0];
      if (!session.published_at) throw new Error('session not published');
      // optional: disallow spins after ended_at
      if (session.ended_at) throw new Error('session ended');

      if (!session.server_seed_enc) throw new Error('server seed not stored');

      // 2) Build allowedSet and supplyByIndex from prize_supply table
      const wheelSize = Number(session.wheel_size) || 17;
      const allowedSet: boolean[] = new Array(wheelSize).fill(true);
      const supplyByIndex: SupplyMap = {};
      const psQ = await client.query(
        'SELECT slot_index, supply FROM prize_supply WHERE session_id = $1 FOR UPDATE',
        [sessionId],
      );
      for (const row of psQ.rows) {
        const idx = Number(row.slot_index);
        if (idx >= 0 && idx < wheelSize) {
          const supplyVal = row.supply === null ? null : Number(row.supply);
          supplyByIndex[idx] = supplyVal;
          // if supply is exactly 0 then not allowed
          if (typeof supplyVal === 'number' && supplyVal <= 0) allowedSet[idx] = false;
        }
      }

      // 3) Decrypt server seed
      const serverSeedHex = decryptSeed(session.server_seed_enc); // should return hex string

      // 4) Use drawIndex to select index and proof
      const draw = await drawIndex({
        serverSeedHex,
        clientSeed,
        userId,
        startNonce: Number(startNonce),
        wheelSize,
        allowedSet,
        supplyByIndex,
      });

      // 5) Insert spin (idempotent)
      try {
        const ins = await client.query(
          `INSERT INTO spin (session_id, user_id, client_spin_id, nonce, chosen_index, set_id, proof_hmac, server_seed_hash, client_seed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, chosen_index, proof_hmac`,
          [
            sessionId,
            userId,
            clientSpinId,
            draw.nonce,
            draw.idx,
            setId,
            draw.proofHmac,
            session.server_seed_hash,
            clientSeed,
          ],
        );
        const spinRow = ins.rows[0];

        // 6) Atomic ticket accounting: require at least 1 ticket
        const balQ = await client.query(
          'SELECT balance FROM user_balance WHERE user_id = $1 FOR UPDATE',
          [userId],
        );
        if (balQ.rowCount === 0) {
          await client.query('INSERT INTO user_balance (user_id, balance) VALUES ($1, 0)', [
            userId,
          ]);
          throw new Error('insufficient balance');
        }
        const curBal = Number(balQ.rows[0].balance);
        const cost = 1;
        if (curBal < cost) throw new Error('insufficient balance');
        const newBal = curBal - cost;
        await client.query('UPDATE user_balance SET balance = $1 WHERE user_id = $2', [
          newBal,
          userId,
        ]);
        await client.query(
          `INSERT INTO ticket_ledger (user_id, delta, balance_after, ref_type, ref_id) VALUES ($1,$2,$3,'spin',$4)`,
          [userId, -cost, newBal, spinRow.id],
        );

        // 7) decrement prize supply if necessary (we already selected allowed/supply)
        if (typeof supplyByIndex[draw.idx] === 'number') {
          await client.query(
            'UPDATE prize_supply SET supply = supply - 1 WHERE session_id = $1 AND slot_index = $2',
            [sessionId, draw.idx],
          );
        }

        return {
          ok: true,
          id: spinRow.id,
          sessionId,
          userId,
          clientSpinId,
          index: spinRow.chosen_index,
          proofHmac: spinRow.proof_hmac,
          balance_after: newBal,
        };
      } catch (insErr: any) {
        // Unique violation => idempotent. Fetch existing spin
        if (insErr && insErr.code === '23505') {
          const existing = await client.query(
            'SELECT id, chosen_index, proof_hmac FROM spin WHERE user_id = $1 AND client_spin_id = $2',
            [userId, clientSpinId],
          );
          if (existing?.rowCount && existing.rowCount > 0) {
            const e = existing.rows[0];
            return {
              ok: true,
              id: e.id,
              sessionId,
              userId,
              clientSpinId,
              index: e.chosen_index,
              proofHmac: e.proof_hmac,
              idempotent: true,
            };
          }
        }
        throw insErr;
      }
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: err.message ?? String(err) });
  } finally {
    if (lockToken) {
      try {
        await releaseLock(lockKey, lockToken);
      } catch (_) {
        /* ignore */
      }
    }
  }
});

export default router;
