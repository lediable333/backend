// src/utils/drawIndex.ts
import crypto from 'crypto';

function hexToBigInt(hex: string) {
  return BigInt('0x' + hex);
}

export type SupplyMap = Record<number, number | null>;

export async function drawIndex({
  serverSeedHex, // hex string
  clientSeed, // string
  userId,
  startNonce = 0,
  wheelSize = 17,
  allowedSet, // boolean[] length wheelSize
  supplyByIndex, // Record<number, number|null> (null => infinite)
}: {
  serverSeedHex: string;
  clientSeed: string;
  userId: string;
  startNonce?: number;
  wheelSize?: number;
  allowedSet: boolean[];
  supplyByIndex: SupplyMap;
}) {
  if (!serverSeedHex) throw new Error('serverSeedHex required');
  if (!clientSeed) throw new Error('clientSeed required');
  if (!userId) throw new Error('userId required');

  const N = BigInt(wheelSize);
  const TWO_128 = BigInt(1) << BigInt(128);
  const limit = (TWO_128 / N) * N; // floor(2^128 / N) * N

  let nonce = BigInt(startNonce);

  while (true) {
    const hmac = crypto.createHmac('sha256', Buffer.from(serverSeedHex, 'hex'));
    hmac.update(clientSeed);
    hmac.update('|');
    hmac.update(userId);
    hmac.update('|');
    hmac.update(nonce.toString());
    const digest = hmac.digest(); // 32 bytes

    // take first 16 bytes => 128 bits
    const first16 = digest.slice(0, 16).toString('hex');
    const x = hexToBigInt(first16);

    if (x >= limit) {
      nonce = nonce + BigInt(1);
      continue;
    }

    const idx = Number(x % N);

    const allowed = Array.isArray(allowedSet) ? !!allowedSet[idx] : true;
    const supply = supplyByIndex?.[idx];

    if (!allowed || (typeof supply === 'number' && supply <= 0)) {
      nonce = nonce + BigInt(1);
      continue;
    }

    // proof hmac (full digest) for inclusion in spin record
    const proofHmac = crypto
      .createHmac('sha256', Buffer.from(serverSeedHex, 'hex'))
      .update(clientSeed + '|' + userId + '|' + nonce.toString())
      .digest('hex');

    return { idx, nonce: Number(nonce), proofHmac };
  }
}
