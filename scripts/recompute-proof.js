// scripts/recompute-proof.js
// Usage:
//  node scripts/recompute-proof.js <serverSeedHex> <clientSeed> <userId> <nonce>
// Example:
//  node scripts/recompute-proof.js f997...3118 clientseed-abc user:alice 0

const crypto = require('crypto');

if (process.argv.length < 6) {
  console.error(
    'Usage: node scripts/recompute-proof.js <serverSeedHex> <clientSeed> <userId> <nonce>',
  );
  process.exit(2);
}

const serverSeedHex = process.argv[2];
const clientSeed = process.argv[3];
const userId = process.argv[4];
const nonce = process.argv[5];

function recompute(serverSeedHex, clientSeed, userId, nonce) {
  const key = Buffer.from(serverSeedHex, 'hex');
  const h = crypto
    .createHmac('sha256', key)
    .update(`${clientSeed}|${userId}|${nonce}`)
    .digest('hex');
  return h;
}

const h = recompute(serverSeedHex, clientSeed, userId, nonce);
console.log(h);
