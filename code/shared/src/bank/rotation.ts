import { Prisma, type PrismaClient } from '@prisma/client';
import { decryptRecoverySecret, decryptSecret, encryptRecoverySecret, encryptSecret, type EncryptedSecret } from './crypto';

/**
 * Rotate every persisted bank and Link recovery secret in one transaction.
 * Call only in maintenance mode with all API and worker processes stopped;
 * otherwise a restarted writer with the old key could create old ciphertext.
 */
export async function rotateBankTokenKeys(db: PrismaClient, oldKey: Buffer, oldVersion: number, newKey: Buffer, newVersion: number) {
  if (oldKey.length !== 32 || newKey.length !== 32 || !Number.isInteger(oldVersion) || !Number.isInteger(newVersion) ||
      oldVersion < 1 || newVersion <= oldVersion || oldKey.equals(newKey)) {
    throw new Error('Provide different 32-byte keys and a newer positive key version.');
  }
  return db.$transaction(async (tx) => {
    // Prevent concurrent writers while inspecting and updating ciphertexts.
    await tx.$executeRaw(Prisma.sql`LOCK TABLE "BankConnection", "LinkAttempt" IN SHARE ROW EXCLUSIVE MODE`);
    const connections = await tx.bankConnection.findMany({ where: { OR: [
      { tokenCiphertext: { not: null } }, { tokenNonce: { not: null } }, { tokenAuthTag: { not: null } },
    ] } });
    for (const connection of connections) {
      if (!connection.tokenCiphertext || !connection.tokenNonce || !connection.tokenAuthTag || connection.tokenKeyVersion !== oldVersion) {
        throw new Error('A stored bank token is incomplete or has an unexpected key version; rotation was rolled back.');
      }
      const context = { provider: connection.provider, environment: connection.environment, externalItemId: connection.externalItemId };
      const clear = decryptSecret({ ciphertext: connection.tokenCiphertext, nonce: connection.tokenNonce,
        authTag: connection.tokenAuthTag, keyVersion: oldVersion }, oldKey, context);
      const encrypted = encryptSecret(clear, newKey, newVersion, context);
      await tx.bankConnection.update({ where: { id: connection.id }, data: {
        tokenCiphertext: encrypted.ciphertext, tokenNonce: encrypted.nonce, tokenAuthTag: encrypted.authTag,
        tokenKeyVersion: encrypted.keyVersion, version: { increment: 1 },
      } });
    }
    const attempts = await tx.linkAttempt.findMany({ where: { OR: [
      { linkToken: { not: null } }, { recoveryPublicTokenCiphertext: { not: null } },
    ] } });
    for (const attempt of attempts) {
      const rotate = (serialized: string | null, purpose: string): string | null => {
        if (serialized === null) return null;
        let secret: EncryptedSecret;
        try { secret = JSON.parse(serialized) as EncryptedSecret; } catch { throw new Error('A Link recovery secret is malformed; rotation was rolled back.'); }
        if (!secret || secret.keyVersion !== oldVersion) throw new Error('A Link recovery secret has an unexpected key version; rotation was rolled back.');
        const clear = decryptRecoverySecret(secret, oldKey, purpose);
        if (clear === null) throw new Error('A Link recovery secret could not be decrypted; rotation was rolled back.');
        return JSON.stringify(encryptRecoverySecret(clear, newKey, newVersion, purpose));
      };
      await tx.linkAttempt.update({ where: { id: attempt.id }, data: {
        linkToken: rotate(attempt.linkToken, `link-token:${attempt.id}`),
        recoveryPublicTokenCiphertext: rotate(attempt.recoveryPublicTokenCiphertext, `access-token:${attempt.id}`),
      } });
    }
    return { connections: connections.length, attempts: attempts.length };
  }, { timeout: 120000 });
}
