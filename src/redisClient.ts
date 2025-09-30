// src/redisClient.ts
import * as IORedisNS from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const RedisCtor = (IORedisNS as any).default ?? (IORedisNS as any);

// now construct
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const redis = new RedisCtor(redisUrl);

/** simple ping-based health check */
export async function testRedis() {
  try {
    return await redis.ping(); // should return 'PONG'
  } catch (err) {
    throw err;
  }
}

/**
 * Acquire a simple lock using SET NX with TTL. Returns token string if acquired, null otherwise.
 */
export async function acquireLock(key: string, ttlSeconds = 5): Promise<string | null> {
  const token = uuidv4();
  const ok = await redis.set(key, token, 'NX', 'EX', ttlSeconds);
  return ok ? token : null;
}

/**
 * Release a lock only if the token matches (safe release).
 */
export async function releaseLock(key: string, token: string) {
  const lua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(lua, 1, key, token);
  } catch (err) {
    // ignore release errors
  }
}
