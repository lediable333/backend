// src/utils/verifySpin.ts
import crypto from 'crypto';

export function recomputeProofHmac(
  serverSeedHex: string,
  clientSeed: string,
  userId: string,
  nonce: number,
) {
  return crypto
    .createHmac('sha256', Buffer.from(serverSeedHex, 'hex'))
    .update(clientSeed + '|' + userId + '|' + nonce.toString())
    .digest('hex');
}
