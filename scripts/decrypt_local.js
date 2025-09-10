// scripts/decrypt_local.js
// Usage:
//   node scripts/decrypt_local.js <base64-encrypted-blob>
// It will load .env (dotenv) if present and use ENCRYPTION_KEY or ENCRYPTION_KEY_BASE64.

const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

function getKeyFromEnv() {
  const KEY_ENV = process.env.ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY_BASE64;
  if (!KEY_ENV) {
    console.error('ERROR: ENCRYPTION_KEY or ENCRYPTION_KEY_BASE64 not set in environment (.env).');
    process.exit(2);
  }
  // hex 64 chars -> 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(KEY_ENV)) return Buffer.from(KEY_ENV, 'hex');
  // base64 -> must be 32 bytes
  const buf = Buffer.from(KEY_ENV, 'base64');
  if (buf.length !== 32) {
    console.error(
      'ERROR: ENCRYPTION_KEY (base64) does not decode to 32 bytes. length=',
      buf.length,
    );
    process.exit(3);
  }
  return buf;
}

function decryptSeed(encBase64) {
  const key = getKeyFromEnv();
  const buf = Buffer.from(encBase64, 'base64');
  if (buf.length < 12 + 16) throw new Error('Invalid encrypted data length');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  const res = Buffer.concat([dec.update(ct), dec.final()]);
  return res.toString('utf8');
}

async function main() {
  const enc = process.argv[2];
  if (!enc) {
    console.error('Usage: node scripts/decrypt_local.js <base64-encrypted-blob>');
    process.exit(1);
  }
  try {
    const plain = decryptSeed(enc);
    console.log('DECRYPTED (hex):', Buffer.from(plain, 'utf8').toString('hex'));
    console.log('DECRYPTED (utf8):', plain);
  } catch (err) {
    console.error('Decryption failed:', err.message);
    // extra hints
    if (
      err.message.includes('Unsupported state') ||
      err.message.includes('unable to authenticate')
    ) {
      console.error(
        ' -> Authentication failed: the encryption key is likely incorrect for this blob.',
      );
    }
    process.exit(4);
  }
}

main();
