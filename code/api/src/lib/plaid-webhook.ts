import { createHash } from 'node:crypto';
import * as jose from 'jose';
import type { PlaidProvider } from '@doughray/shared';

/**
 * Plaid webhook verification (ES256 JWS with Plaid verification keys).
 *
 * Flow per Plaid documentation:
 * 1. Read the `Plaid-Verification` header (compact JWS) BEFORE consuming the body.
 * 2. Decode the JWT header to read `kid` and confirm ES256.
 * 3. Fetch the verification key via /webhook_verification_key/get (cached by kid).
 * 4. Verify the signature and check the `request_body_sha256` claim against the
 *    hash of the exact raw request bytes.
 * 5. Reject stale `iat` values (replay protection together with the durable
 *    WebhookReceipt deduplication).
 */

const JWT_IAT_MAX_AGE_SECONDS = 5 * 60; // 5 minutes per Plaid's guidance
const JWT_IAT_SKEW_SECONDS = 60;
const KEY_CACHE_TTL_MS = 10 * 60 * 1000;

interface WebhookHeader {
  alg?: string;
  kid?: string;
}

interface WebhookClaims {
  request_body_sha256?: string;
  iat?: number;
}

interface CachedKey {
  jwk: jose.JWK;
  expiresAt: number;
}

const keyCache = new Map<string, CachedKey>();

export type WebhookVerificationFailure =
  | 'MISSING_HEADER'
  | 'MALFORMED_JWS'
  | 'UNSUPPORTED_ALG'
  | 'KEY_UNAVAILABLE'
  | 'INVALID_SIGNATURE'
  | 'BODY_HASH_MISMATCH'
  | 'STALE_TIMESTAMP';

export interface WebhookVerificationSuccess {
  ok: true;
  keyId: string;
  bodySha256: string;
  claims: WebhookClaims;
}

export interface WebhookVerificationFailureResult {
  ok: false;
  reason: WebhookVerificationFailure;
}

export type WebhookVerificationResult = WebhookVerificationSuccess | WebhookVerificationFailureResult;

export function bodySha256(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function clearExpiredKeys(): void {
  const now = Date.now();
  for (const [kid, entry] of keyCache) {
    if (entry.expiresAt <= now) keyCache.delete(kid);
  }
}

export async function getVerificationJwk(
  provider: Pick<PlaidProvider, 'getWebhookVerificationKey'>,
  kid: string,
): Promise<jose.JWK> {
  clearExpiredKeys();
  const cached = keyCache.get(kid);
  if (cached) return cached.jwk;
  const response = await provider.getWebhookVerificationKey(kid);
  if (response.key.expired_at != null && response.key.expired_at * 1000 <= Date.now()) {
    throw new Error('Webhook verification key has expired');
  }
  const jwk: jose.JWK = response.key as unknown as jose.JWK;
  const expiresAt = response.key.expired_at == null ? Date.now() + KEY_CACHE_TTL_MS
    : Math.min(Date.now() + KEY_CACHE_TTL_MS, response.key.expired_at * 1000);
  keyCache.set(kid, { jwk, expiresAt });
  return jwk;
}

/** Test hook: clear the in-memory key cache. */
export function clearVerificationKeyCache(): void {
  keyCache.clear();
}

export async function verifyPlaidWebhook(
  rawBody: Buffer,
  verificationHeader: string | undefined,
  provider: Pick<PlaidProvider, 'getWebhookVerificationKey'>,
): Promise<WebhookVerificationResult> {
  if (typeof verificationHeader !== 'string' || verificationHeader.trim() === '') {
    return { ok: false, reason: 'MISSING_HEADER' };
  }

  let protectedHeader: WebhookHeader;
  try {
    const decoded = jose.decodeProtectedHeader(verificationHeader) as WebhookHeader;
    protectedHeader = decoded;
  } catch {
    return { ok: false, reason: 'MALFORMED_JWS' };
  }
  if (protectedHeader.alg !== 'ES256') {
    return { ok: false, reason: 'UNSUPPORTED_ALG' };
  }
  const kid = protectedHeader.kid;
  if (typeof kid !== 'string' || kid === '') {
    return { ok: false, reason: 'MALFORMED_JWS' };
  }

  let jwk: jose.JWK;
  try {
    jwk = await getVerificationJwk(provider, kid);
  } catch {
    return { ok: false, reason: 'KEY_UNAVAILABLE' };
  }

  let publicKey: Awaited<ReturnType<typeof jose.importJWK>>;
  try {
    publicKey = await jose.importJWK(jwk, 'ES256');
  } catch {
    return { ok: false, reason: 'KEY_UNAVAILABLE' };
  }

  const computedHash = bodySha256(rawBody);
  let claims: WebhookClaims;
  try {
    const { payload } = await jose.jwtVerify(verificationHeader, publicKey, {
      algorithms: ['ES256'],
      clockTolerance: JWT_IAT_SKEW_SECONDS,
    });
    claims = payload as WebhookClaims;
  } catch {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }

  if (claims.request_body_sha256 !== computedHash) {
    return { ok: false, reason: 'BODY_HASH_MISMATCH' };
  }

  // Reject stale timestamps: the signature guard is complemented by the
  // durable WebhookReceipt deduplication for valid retries.
  if (typeof claims.iat !== 'number') {
    return { ok: false, reason: 'STALE_TIMESTAMP' };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - claims.iat;
  if (ageSeconds > JWT_IAT_MAX_AGE_SECONDS || ageSeconds < -JWT_IAT_SKEW_SECONDS) {
    return { ok: false, reason: 'STALE_TIMESTAMP' };
  }

  return { ok: true, keyId: kid, bodySha256: computedHash, claims };
}
