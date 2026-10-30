import { scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Owner password verification.
 *
 * The stored value comes from the OWNER_PASSWORD_HASH environment variable,
 * provisioned with `code/scripts/password-hash.mjs`:
 *
 *   scrypt:<salt-hex>:<derived-key-hex>
 *
 * The derivation parameters (N=16384, r=8, p=1, key length = stored key length)
 * are fixed by the provisioning script; verification must match them exactly.
 */

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function isOwnerPasswordHashConfigured(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith('scrypt:') && stored.split(':').length === 3;
}

export function verifyOwnerPassword(password: string, stored: string): boolean {
  if (!isOwnerPasswordHashConfigured(stored)) return false;
  const parts = stored.split(':');
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, SCRYPT_OPTIONS);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
