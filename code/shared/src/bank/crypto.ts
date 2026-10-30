import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Authenticated encryption for bank access tokens.
 *
 * AES-256-GCM with a unique 12-byte nonce per ciphertext and associated data
 * that binds the ciphertext to its provider identity: a token encrypted for one
 * connection/environment cannot be decrypted under another context.
 *
 * Key versions support rotation: rows carry the version used so older
 * ciphertexts remain readable after a key change, and re-encrypt tooling can
 * upgrade them.
 */

export interface BankTokenContext {
  provider: string;
  environment: string;
  externalItemId: string;
}

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
}

export function buildTokenContextAad(context: BankTokenContext): string {
  return `doughray:bank-token:v1:${context.provider}:${context.environment}:${context.externalItemId}`;
}

function aadBuffer(context: BankTokenContext): Buffer {
  return Buffer.from(buildTokenContextAad(context), 'utf8');
}

export function encodeAad(context: BankTokenContext): string {
  return buildTokenContextAad(context);
}

/** Encrypt for a token context; returns base64 strings safe for storage. */
export function encryptSecret(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
  context: BankTokenContext,
): EncryptedSecret {
  if (key.length !== 32) {
    throw new Error('Bank token encryption key must be exactly 32 bytes.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadBuffer(context));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

/** Decrypt a stored secret; throws when the context, key or tag does not match. */
export function decryptSecret(
  secret: EncryptedSecret,
  key: Buffer | null,
  context: BankTokenContext,
): string {
  if (key === null || key.length !== 32) {
    throw new Error('Bank token encryption key is not available.');
  }
  const iv = Buffer.from(secret.nonce, 'base64');
  const tag = Buffer.from(secret.authTag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aadBuffer(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Encrypt a short-lived recovery blob (Link public tokens awaiting persistence). */
export function encryptRecoverySecret(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
  purpose: string,
): EncryptedSecret {
  const iv = randomBytes(12);
  const aad = Buffer.from(`doughray:link-recovery:v1:${purpose}`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

export function decryptRecoverySecret(
  secret: EncryptedSecret | null | undefined,
  key: Buffer | null,
  purpose: string,
): string | null {
  if (!secret || key === null || key.length !== 32) return null;
  try {
    const iv = Buffer.from(secret.nonce, 'base64');
    const tag = Buffer.from(secret.authTag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`doughray:link-recovery:v1:${purpose}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Opaque, log-safe digest of a token for equality checks without exposure. */
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}
