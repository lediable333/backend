// scripts/verify_session_spins.js
// usage: node scripts/verify_session_spins.js <sessionId> <serverSeedHex>
const { Client } = require('pg');
const crypto = require('crypto');
const { execSync } = require('child_process');

if (process.argv.length < 4) {
  console.error('Usage: node scripts/verify_session_spins.js <sessionId> <serverSeedHex>');
  process.exit(2);
}
const sessionId = process.argv[2];
const serverSeedHex = process.argv[3];

function recomputeProof(serverSeedHex, clientSeed, userId, nonce) {
  return crypto
    .createHmac('sha256', Buffer.from(serverSeedHex, 'hex'))
    .update(`${clientSeed}|${userId}|${nonce}`)
    .digest('hex');
}

// import draw logic from your repo if you prefer; copy minimal implementation here:
function hexToBigInt(hex) {
  return BigInt('0x' + hex);
}
function drawIndexSimple(serverSeedHex, clientSeed, userId, startNonce = 0, wheelSize = 17) {
  const N = BigInt(wheelSize);
  const TWO_128 = BigInt(1) << BigInt(128);
  const limit = (TWO_128 / N) * N;
  let nonce = BigInt(startNonce);
  while (true) {
    const hmac = crypto.createHmac('sha256', Buffer.from(serverSeedHex, 'hex'));
    hmac.update(clientSeed);
    hmac.update('|');
    hmac.update(userId);
    hmac.update('|');
    hmac.update(nonce.toString());
    const digest = hmac.digest();
    const first16 = digest.slice(0, 16).toString('hex');
    const x = hexToBigInt(first16);
    if (x >= limit) {
      nonce = nonce + BigInt(1);
      continue;
    }
    const idx = Number(x % N);
    const proof = crypto
      .createHmac('sha256', Buffer.from(serverSeedHex, 'hex'))
      .update(clientSeed + '|' + userId + '|' + nonce.toString())
      .digest('hex');
    return { idx, nonce: Number(nonce), proof };
  }
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const spins = await client.query(
    'SELECT id, client_seed, user_id, nonce, chosen_index, proof_hmac FROM spin WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId],
  );
  console.log('spins found:', spins.rowCount);
  let ok = 0,
    mismatch = 0;
  for (const row of spins.rows) {
    const r = drawIndexSimple(serverSeedHex, row.client_seed, row.user_id, Number(row.nonce), 17);
    const recomputed = r.proof;
    if (recomputed === row.proof_hmac && r.idx === Number(row.chosen_index)) {
      ok++;
    } else {
      mismatch++;
      console.log(
        'MISMATCH',
        row.id,
        'db idx',
        row.chosen_index,
        'calc idx',
        r.idx,
        'db proof',
        row.proof_hmac,
        'calc proof',
        recomputed,
      );
    }
  }
  console.log({ ok, mismatch });
  await client.end();
})();
