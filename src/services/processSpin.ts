// src/services/processSpin.ts
import { pool } from '../db';
import { drawIndex } from '../utils/drawIndex';
import { v4 as uuidv4 } from 'uuid';

/**
 * processSpin: handle a user's spin in a single DB transaction.
 *
 * Inputs:
 *  - sessionId, userId, clientSpinId, clientSeed, startNonce
 *
 * Returns the inserted spin row + balance_after or throws.
 */
export async function processSpin({
  sessionId,
  userId,
  clientSpinId,
  clientSeed,
  startNonce = 0,
}: {
  sessionId: string;
  userId: string;
  clientSpinId: string;
  clientSeed: string;
  startNonce?: number;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Fetch session row (ensure session active and has server_seed_enc or hash)
    const sRes = await client.query(
      `SELECT id, wheel_size, server_seed_hash, server_seed_enc, server_seed_revealed, published_at, ended_at, config_json
       FROM session WHERE id = $1 FOR SHARE`,
      [sessionId]
    );
    if (sRes.rowCount === 0) throw new Error('session not found');
    const session = sRes.rows[0];
    if (!session.published_at || session.ended_at)
      throw new Error('session ended or not published');
    if (!session.server_seed_revealed && !session.server_seed_enc && !session.server_seed_hash) {
      // For spins we need either seed or seedHash (seed is secret, revealed later)
    }

    // NOTE: here you must obtain the serverSeedHex.
    // For local dev your code may decrypt server_seed_enc; for prod fetch from secret manager.
    // This function assumes you have a helper `decryptSeedForSession(client, sessionId)` that returns hex seed.
    const serverSeedHex = await decryptSeedForSession(client, sessionId); // implement elsewhere

    // 2) Load allowedSet and supply snapshot from prize_supply (snapshot in session.config_json would be ideal)
    // We'll lock prize_supply rows that might be chosen:
    const wheelSize = session.wheel_size ?? 17;
    const psRes = await client.query(
      `SELECT slot_index, prize_id, supply FROM prize_supply WHERE session_id = $1 FOR UPDATE`,
      [sessionId]
    );
    // Build supplyByIndex record and allowedSet (all true if prize present)
    const supplyByIndex: Record<number, number | null> = {};
    const allowedSet: boolean[] = Array(wheelSize).fill(true);
    psRes.rows.forEach((r: any) => {
      supplyByIndex[r.slot_index] = r.supply === null ? null : Number(r.supply);
    });

    // 3) Check user_balance exists (lock)
    const ubRes = await client.query(
      `SELECT user_id, balance FROM user_balance WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (ubRes.rowCount === 0) throw new Error('user balance not found');

    // 4) Call drawIndex (your unbiased RNG), it returns idx, nonce, proofHmac
    const draw = await drawIndex({
      serverSeedHex,
      clientSeed,
      userId,
      startNonce,
      wheelSize,
      allowedSet,
      supplyByIndex,
    });
    const chosenIndex = draw.idx;
    const nonce = draw.nonce;
    const proofHmac = draw.proofHmac;

    // 5) Idempotency: insert spin row, handle duplicate clientSpinId
    const spinId = uuidv4();
    let spinRow;
    try {
      const insertSpinQ = `
        INSERT INTO spin (id, session_id, user_id, client_spin_id, nonce, chosen_index, set_id, proof_hmac, server_seed_hash, client_seed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id, chosen_index, nonce, proof_hmac, created_at
      `;
      const setId = `${sessionId}:${session.snapshot_hash ?? ''}`; // adjust as needed
      const ins = await client.query(insertSpinQ, [
        spinId,
        sessionId,
        userId,
        clientSpinId,
        nonce,
        chosenIndex,
        setId,
        proofHmac,
        session.server_seed_hash ?? null,
        clientSeed,
      ]);
      spinRow = ins.rows[0];
    } catch (err: any) {
      // Unique constraint violation -> fetch existing spin and return
      if (err.code === '23505') {
        const existing = await client.query(
          `SELECT id, chosen_index, nonce, proof_hmac, created_at FROM spin WHERE user_id=$1 AND client_spin_id=$2`,
          [userId, clientSpinId]
        );
        if (existing.rowCount) {
          await client.query('COMMIT');
          return { already: true, spin: existing.rows[0] };
        }
      }
      throw err;
    }

    // 6) Prize supply decrement (if finite) — update the specific slot row (we did FOR UPDATE above)
    const supplyVal = supplyByIndex[chosenIndex];
    if (typeof supplyVal === 'number') {
      if (supplyVal <= 0) {
        throw new Error('supply exhausted (unexpected)');
      }
      await client.query(
        `UPDATE prize_supply SET supply = supply - 1 WHERE session_id = $1 AND slot_index = $2`,
        [sessionId, chosenIndex]
      );
    }

    // 7) Update user_balance and insert ticket_ledger (example: charge 1 ticket to spin)
    const cost = 1; // example cost
    const currentBal = ubRes.rows[0].balance;
    const newBal = currentBal - cost;
    if (newBal < 0) throw new Error('insufficient balance');

    await client.query(`UPDATE user_balance SET balance = $1 WHERE user_id = $2`, [newBal, userId]);
    await client.query(
      `INSERT INTO ticket_ledger (user_id, delta, balance_after, ref_type, ref_id)
         VALUES ($1, $2, $3, $4, $5)`,
      [userId, -cost, newBal, 'spin', spinRow.id]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      spin: spinRow,
      balance_after: newBal,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * decryptSeedForSession(client, sessionId)
 * - local dev: decrypt server_seed_enc using ENCRYPTION_KEY_BASE64
 * - prod: call secret manager if you prefer
 *
 * Implement this helper to match how you encrypted seed in admin publish.
 */
async function decryptSeedForSession(client: any, sessionId: string): Promise<string> {
  // simple example: SELECT server_seed_enc then decrypt with your repo's decryptSeed
  const r = await client.query(`SELECT server_seed_enc FROM session WHERE id = $1`, [sessionId]);
  if (!r.rowCount) throw new Error('no session seed found');
  const enc = r.rows[0].server_seed_enc;
  // call your existing decryptSeed(enc) from src/security.ts
  const { decryptSeed } = require('../security'); // or import
  const seedHex = await decryptSeed(enc); // should return hex string
  return seedHex;
}
