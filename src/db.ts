// src/db.ts
import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://spin:spinpass@localhost:5432/spinandwin';

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

/**
 * Convenience helper to run a function inside a DB transaction.
 */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Simple DB health check
 */
export async function testDB() {
  const r = await pool.query('SELECT 1 AS ok');
  return r.rows?.[0] ?? null;
}
