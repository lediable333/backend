// src/security.ts
import crypto from 'crypto';

const KEY_ENV = process.env.ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY_BASE64;

/**
 * Expect ENCRYPTION_KEY as base64 (preferred) OR hex (64 hex chars).
 * It must decode to 32 bytes (AES-256).
 */
function getKey(): Buffer {
  if (!KEY_ENV) {
    throw new Error('ENCRYPTION_KEY or ENCRYPTION_KEY_BASE64 not set in environment');
  }
  // try hex
  if (/^[0-9a-fA-F]{64}$/.test(KEY_ENV)) {
    return Buffer.from(KEY_ENV, 'hex');
  }
  // base64 decode
  const buf = Buffer.from(KEY_ENV, 'base64');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes (base64 or 64-hex chars)');
  }
  return buf;
}

/**
 * Encrypt serverSeed (utf8 string) -> base64(iv|tag|ciphertext)
 */
export function encryptSeed(secret: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 12 bytes recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store iv (12) + tag (16) + ciphertext
  const out = Buffer.concat([iv, tag, ct]).toString('base64');
  return out;
}

/**
 * Decrypt base64(iv|tag|ciphertext) -> secret string
 */
export function decryptSeed(enc: string): string {
  const key = getKey();
  const buf = Buffer.from(enc, 'base64');
  if (buf.length < 12 + 16) throw new Error('Invalid encrypted data length');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const res = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return res;
}

/** helpers */
export function generateServerSeedHex(): string {
  return crypto.randomBytes(32).toString('hex');
}
export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
