// scripts/decrypt_seed_try_many.js
// Usage:
//   node scripts/decrypt_seed_try_many.js <encBase64> <candidateKeyString>
// Example:
//   node scripts/decrypt_seed_try_many.js "Uk/..." "2lfM2SmV..."
// This script will try multiple reasonable key interpretations and iv/tag layouts.

const crypto = require('crypto');

function log(...a) {
  console.error(...a);
}

if (process.argv.length < 4) {
  log('Usage: node scripts/decrypt_seed_try_many.js <encBase64> <candidateKeyString>');
  process.exit(2);
}

const encBase64 = process.argv[2];
const candidate = process.argv[3];

let blob;
try {
  blob = Buffer.from(encBase64, 'base64');
} catch (e) {
  log('Error: invalid base64 for enc blob.');
  process.exit(1);
}

const candidates = [];

// candidate interpreted as base64 (common)
try {
  const b = Buffer.from(candidate, 'base64');
  candidates.push({ name: 'key_base64_decoded', key: b });
} catch (e) {
  // ignore
}

// candidate interpreted as raw utf8 bytes
candidates.push({ name: 'key_utf8', key: Buffer.from(candidate, 'utf8') });

// candidate = sha256(base64-decoded) if base64 decodes
try {
  const dec = Buffer.from(candidate, 'base64');
  const h = crypto.createHash('sha256').update(dec).digest();
  candidates.push({ name: 'sha256(base64_decoded)', key: h });
} catch (e) {
  /* ignore */
}

// candidate = sha256(utf8)
candidates.push({
  name: 'sha256(utf8)',
  key: crypto.createHash('sha256').update(candidate, 'utf8').digest(),
});

// candidate = pbkdf2(candidate utf8, salt 'seed', 10000, 32) (just in case)
try {
  const keypb = crypto.pbkdf2Sync(candidate, 'seed', 10000, 32, 'sha256');
  candidates.push({ name: 'pbkdf2(seed,10000)', key: keypb });
} catch (e) {
  /* ignore */
}

// Try more: base64-of-utf8 (some folks base64-encode the key string)
try {
  const b64utf = Buffer.from(candidate, 'utf8').toString('base64');
  candidates.push({ name: 'base64(utf8) bytes', key: Buffer.from(b64utf, 'utf8') });
} catch (e) {}

log('Decoded blob length:', blob.length);
log('Will try', candidates.length, 'key interpretations and multiple iv/tag layouts.\n');

function tryAesGcm(key, ivLen) {
  if (blob.length < ivLen + 16 + 1) return null;
  const iv = blob.slice(0, ivLen);
  const tag = blob.slice(blob.length - 16);
  const ciphertext = blob.slice(ivLen, blob.length - 16);
  try {
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const pt = Buffer.concat([dec.update(ciphertext), dec.final()]);
    return pt.toString('utf8');
  } catch (e) {
    return null;
  }
}

function tryAesCbc(key) {
  if (blob.length < 16 + 1) return null;
  const iv = blob.slice(0, 16);
  const ciphertext = blob.slice(16);
  try {
    const dec = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const pt = Buffer.concat([dec.update(ciphertext), dec.final()]);
    return pt.toString('utf8');
  } catch (e) {
    return null;
  }
}

// Try all candidate keys, try GCM with iv=12 and iv=16, try CBC fallback
for (const c of candidates) {
  const key = c.key;
  log('=== Trying key interpretation:', c.name, ' keylen=', key.length);
  // If key length not 32, try derive/adjust:
  let key32 = key;
  if (key.length !== 32) {
    // if shorter, pad with zeros; if longer, hash to 32
    if (key.length < 32) {
      const tmp = Buffer.alloc(32, 0);
      key.copy(tmp, 0, 0, Math.min(key.length, 32));
      key32 = tmp;
    } else {
      key32 = crypto.createHash('sha256').update(key).digest();
    }
    log(' adjusted keylen ->', key32.length, '(hashed/padded)');
  }

  // GCM iv 12
  const out12 = tryAesGcm(key32, 12);
  if (out12 !== null) {
    log('SUCCESS: AES-256-GCM iv=12 with key=', c.name);
    log('Plaintext utf8:\n', out12);
    process.exit(0);
  } else {
    log(' AES-256-GCM iv=12 failed');
  }

  // GCM iv 16
  const out16 = tryAesGcm(key32, 16);
  if (out16 !== null) {
    log('SUCCESS: AES-256-GCM iv=16 with key=', c.name);
    log('Plaintext utf8:\n', out16);
    process.exit(0);
  } else {
    log(' AES-256-GCM iv=16 failed');
  }

  // AES-CBC fallback
  const cbc = tryAesCbc(key32);
  if (cbc !== null) {
    log('SUCCESS: AES-256-CBC (iv=16) with key=', c.name);
    log('Plaintext utf8:\n', cbc);
    process.exit(0);
  } else {
    log(' AES-256-CBC failed');
  }
}

log('\nAll attempts failed. Next steps:');
log(
  '- Check for a custom KDF (HKDF/PBKDF2) used by your code (search repo for encrypt/decrypt functions).',
);
log(
  '- Search for files mentioning server_seed_enc, encryptSeed, decryptSeed, ENCRYPTION_KEY_BASE64.',
);
log(
  '- If you paste (privately) the file src/security.ts (or similar) I can read the exact encryption implementation and adapt exactly.\n',
);

process.exit(1);
