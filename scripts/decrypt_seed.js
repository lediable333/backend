// scripts/decrypt_seed.js
// Usage:
//   node scripts/decrypt_seed.js <serverSeedEncBase64> <encryptionKeyBase64>
// Example:
//   node scripts/decrypt_seed.js "Uk/..." "2lfM2SmV..."

// Note: do NOT commit secrets. Run locally in your shell only.

const crypto = require('crypto');

if (process.argv.length < 4) {
  console.error('Usage: node scripts/decrypt_seed.js <encBase64> <keyBase64>');
  process.exit(2);
}

const encBase64 = process.argv[2];
const keyBase64 = process.argv[3];

try {
  const blob = Buffer.from(encBase64, 'base64');
  const key = Buffer.from(keyBase64, 'base64');

  console.log('Decoded blob bytes:', blob.length);
  console.log('Key length bytes:', key.length);

  // Try AES-GCM with 12-byte IV and 16-byte tag (the expected layout)
  if (blob.length < 12 + 16 + 1) throw new Error('blob too small for iv+cipher+tag');

  const iv = blob.slice(0, 12);
  const tag = blob.slice(blob.length - 16);
  const ciphertext = blob.slice(12, blob.length - 16);

  try {
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const plain = Buffer.concat([dec.update(ciphertext), dec.final()]);
    const asUtf8 = plain.toString('utf8');
    console.log('Decrypted (utf8):', asUtf8);
    console.log('Decrypted (hex):', Buffer.from(asUtf8, 'utf8').toString('hex'));
    process.exit(0);
  } catch (e) {
    // fallthrough to other attempts
    console.error('AES-256-GCM (iv=12) attempt failed:', e.message);
  }

  // Fallback attempts (try iv=16, tag=16)
  if (blob.length >= 16 + 16 + 1) {
    const iv16 = blob.slice(0, 16);
    const tag16 = blob.slice(blob.length - 16);
    const ciphertext16 = blob.slice(16, blob.length - 16);
    try {
      const dec = crypto.createDecipheriv('aes-256-gcm', key, iv16);
      dec.setAuthTag(tag16);
      const plain = Buffer.concat([dec.update(ciphertext16), dec.final()]);
      const asUtf8 = plain.toString('utf8');
      console.log('Decrypted (utf8) with iv=16:', asUtf8);
      process.exit(0);
    } catch (e) {
      console.error('AES-256-GCM (iv=16) attempt failed:', e.message);
    }
  }

  // Try AES-256-CBC with iv 16 and treat last 16 bytes as HMAC (or maybe no tag)
  try {
    const ivC = blob.slice(0, 16);
    const ciphertextC = blob.slice(16);
    const dec = crypto.createDecipheriv('aes-256-cbc', key, ivC);
    const plain = Buffer.concat([dec.update(ciphertextC), dec.final()]);
    console.log('Decrypted (AES-CBC) (utf8):', plain.toString('utf8'));
    process.exit(0);
  } catch (e) {
    console.error('AES-CBC fallback failed:', e.message);
  }

  console.error('All decryption attempts failed.');
  process.exit(1);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
