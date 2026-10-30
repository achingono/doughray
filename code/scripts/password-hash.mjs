#!/usr/bin/env node
/**
 * Provision the single-owner password hash for Doughray access control.
 *
 * Usage:
 *   node scripts/password-hash.mjs            (reads password from stdin)
 *   node scripts/password-hash.mjs '<password>'
 *
 * Output is a `scrypt:<salt-hex>:<derived-key-hex>` string suitable for the
 * OWNER_PASSWORD_HASH environment variable.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, SCRYPT_OPTIONS);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isDirectRun) {
  const argPassword = process.argv[2];
  const password = argPassword || (process.stdin.isTTY ? null : await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    process.stdin.on('error', reject);
  }));

  if (!password) {
    console.error('Usage: node scripts/password-hash.mjs <password>   (or pipe the password on stdin)');
    process.exit(1);
  }

  try {
    console.log(hashPassword(password));
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}
