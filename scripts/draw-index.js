// scripts/draw-index.js
// Usage:
//  node scripts/draw-index.js <serverSeedHex> <clientSeed> <userId> <startNonce> [wheelSize]
// Example:
//  node scripts/draw-index.js f997...3118 clientseed-abc user:alice 0 17

const crypto = require('crypto');

if (process.argv.length < 6) {
  console.error(
    'Usage: node scripts/draw-index.js <serverSeedHex> <clientSeed> <userId> <startNonce> [wheelSize]',
  );
  process.exit(2);
}
const serverSeedHex = process.argv[2];
const clientSeed = process.argv[3];
const userId = process.argv[4];
let nonce = BigInt(process.argv[5] || '0');
const wheelSize = Number(process.argv[6] || 17);

function hexToBigInt(hex) {
  return BigInt('0x' + hex);
}

const N = BigInt(wheelSize);
const TWO_128 = BigInt(1) << BigInt(128);
const limit = (TWO_128 / N) * N;

while (true) {
  const hmac = crypto.createHmac('sha256', Buffer.from(serverSeedHex, 'hex'));
  hmac.update(clientSeed);
  hmac.update('|');
  hmac.update(userId);
  hmac.update('|');
  hmac.update(nonce.toString());
  const digest = hmac.digest(); // Buffer 32
  const first16 = digest.slice(0, 16).toString('hex');
  const x = hexToBigInt(first16);
  if (x >= limit) {
    nonce = nonce + BigInt(1);
    continue;
  }
  const idx = Number(x % N);

  // proofHmac (full)
  const proofHmac = crypto
    .createHmac('sha256', Buffer.from(serverSeedHex, 'hex'))
    .update(`${clientSeed}|${userId}|${nonce.toString()}`)
    .digest('hex');

  console.log(
    JSON.stringify(
      {
        idx,
        nonce: Number(nonce),
        proofHmac,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
