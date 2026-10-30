import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { bodySha256, clearVerificationKeyCache, verifyPlaidWebhook } from './plaid-webhook';

afterEach(() => { clearVerificationKeyCache(); vi.restoreAllMocks(); });

describe('Plaid webhook verification', () => {
  it('accepts a signed exact body and rejects tampering and stale signatures', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const provider = { getWebhookVerificationKey: vi.fn().mockResolvedValue({ key: { ...jwk, kid: 'fixture', alg: 'ES256', expired_at: null } }) };
    const body = Buffer.from('{"webhook_type":"TRANSACTIONS"}');
    const token = await new SignJWT({ request_body_sha256: bodySha256(body) }).setProtectedHeader({ alg: 'ES256', kid: 'fixture' }).setIssuedAt().sign(privateKey);
    expect(await verifyPlaidWebhook(body, token, provider)).toMatchObject({ ok: true });
    expect(await verifyPlaidWebhook(Buffer.from('{}'), token, provider)).toMatchObject({ ok: false, reason: 'BODY_HASH_MISMATCH' });
    const stale = await new SignJWT({ request_body_sha256: bodySha256(body) }).setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 301).sign(privateKey);
    expect(await verifyPlaidWebhook(body, stale, provider)).toMatchObject({ ok: false, reason: 'STALE_TIMESTAMP' });
  });

  it('rejects provider keys that have expired', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const provider = { getWebhookVerificationKey: vi.fn().mockResolvedValue({ key: { ...jwk, kid: 'expired', alg: 'ES256', expired_at: 1 } }) };
    const body = Buffer.from('{}');
    const token = await new SignJWT({ request_body_sha256: bodySha256(body) }).setProtectedHeader({ alg: 'ES256', kid: 'expired' }).setIssuedAt().sign(privateKey);
    expect(await verifyPlaidWebhook(body, token, provider)).toMatchObject({ ok: false, reason: 'KEY_UNAVAILABLE' });
  });
});
