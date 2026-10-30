import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { BankProviderErrorKind, bankProviderError, PlaidProvider, encryptSecret, enqueueBankSync, type NormalizedTransactionChange, type ProviderSyncPage } from '@doughray/shared';
import prisma from '../lib/prisma';
import { processNextSyncJob } from './sync-queue';
import { commitMigrationReview, discardMigrationReview, getMigrationReview } from '../../../api/src/services/bank-reconciliation.service';
import { syncConnection } from './sync-connection';
import { prisma as apiPrisma } from '../../../api/src/lib/prisma';
import { applyAccountMappings, disconnectConnection } from '../../../api/src/services/plaid-link.service';
import express from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import plaidRoutes from '../../../api/src/routes/plaid';
import { clearVerificationKeyCache, bodySha256 } from '../../../api/src/lib/plaid-webhook';
import { errorHandler } from '../../../api/src/middleware/error-handler';

// Opt in only against a disposable, already migrated PostgreSQL database.
const databaseTests = process.env.RUN_PLAID_DB_TESTS === '1' ? describe : describe.skip;

databaseTests('Plaid sync with PostgreSQL', () => {
  const suffix = randomUUID();
  const key = randomBytes(32);
  let connectionId: string;
  let accountId: string;
  let categoryId: string;
  let legacyAccountId: string;
  let mappingAccountId: string;

  const change = (id: string, status: 'PENDING' | 'POSTED', pendingExternalId: string | null = null): NormalizedTransactionChange => ({
    changeType: 'ADDED', externalAccountId: `acct-${suffix}`, externalTransactionId: id,
    providerStatus: status, amount: '-12.34', currency: 'CAD', postedDate: '2026-10-29',
    authorizedDate: null, pendingExternalId, sourceRevision: null, observedFacts: {
      description: 'Test merchant', payee: 'Test', memo: null, providerAmount: '12.34', merchantName: 'Test',
      pendingTransactionId: pendingExternalId, categoryDetail: null, categoryConfidence: null,
      isoCurrencyCode: 'CAD', unofficialCurrencyCode: null,
    },
  });
  const page = (changes: NormalizedTransactionChange[], cursor: string): ProviderSyncPage => ({
    changes, nextCursor: cursor, hasMore: false, accountsSnapshot: null, transactionsUpdateStatus: 'HISTORICAL_UPDATE_COMPLETE',
  });
  async function runSync(changes: NormalizedTransactionChange[], cursor: string) {
    vi.spyOn(PlaidProvider.prototype, 'syncPage').mockResolvedValue(page(changes, cursor));
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    const job = await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    let processed = false;
    for (let retry = 0; retry < 20 && !processed; retry++) {
      processed = await processNextSyncJob();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(processed).toBe(true);
    let result = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.jobId } });
    if (result.status === 'QUEUED' && !result.errorMessage) {
      for (let retry = 0; retry < 20; retry++) {
        if (await processNextSyncJob()) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      result = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.jobId } });
    }
    // Avoid running the unrelated categorization job during this isolated test.
    await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
    vi.restoreAllMocks();
    return result;
  }

  beforeAll(async () => {
    process.env.PLAID_CLIENT_ID = 'fixture'; process.env.PLAID_CLIENT_SECRET = 'fixture'; process.env.PLAID_ENV = 'sandbox';
    process.env.BANK_TOKEN_ENCRYPTION_KEY = key.toString('base64'); process.env.BANK_TOKEN_ENCRYPTION_KEY_VERSION = '1';
    const secret = encryptSecret('fixture-access-token', key, 1, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: suffix });
    const connection = await prisma.bankConnection.create({ data: { provider: 'PLAID', environment: 'SANDBOX', externalItemId: suffix,
      tokenCiphertext: secret.ciphertext, tokenNonce: secret.nonce, tokenAuthTag: secret.authTag, tokenKeyVersion: 1 } });
    connectionId = connection.id;
    const account = await prisma.account.create({ data: { externalId: `test-${suffix}`, name: 'Test account', currency: 'CAD',
      type: 'CHECKING', balance: 100, balanceDate: new Date() } });
    accountId = account.id;
    await prisma.accountSource.create({ data: { connectionId, accountId, externalAccountId: `acct-${suffix}`, currency: 'CAD' } });
    categoryId = (await prisma.category.create({ data: { name: `test-${suffix}` } })).id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (connectionId) await prisma.bankConnection.delete({ where: { id: connectionId } });
    if (accountId) await prisma.account.delete({ where: { id: accountId } });
    if (legacyAccountId) await prisma.account.delete({ where: { id: legacyAccountId } });
    if (mappingAccountId) await prisma.account.delete({ where: { id: mappingAccountId } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    await apiPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it('coalesces simultaneous requests for the same connection', async () => {
    const jobs = await Promise.all(Array.from({ length: 10 }, () => enqueueBankSync(prisma, {
      jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId,
    })));
    expect(new Set(jobs.map((job) => job.jobId)).size).toBe(1);
    await prisma.syncJob.delete({ where: { id: jobs[0].jobId } });
  });

  it('accepts repeated verified webhooks without losing dispatch', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    vi.spyOn(PlaidProvider.prototype, 'getWebhookVerificationKey').mockResolvedValue({ key: { ...jwk, kid: 'fixture-key', alg: 'ES256' } } as never);
    const app = express();
    app.use('/api/plaid/webhook', express.raw({ type: 'application/json' }));
    app.use(express.json()); app.use('/api/plaid', plaidRoutes); app.use(errorHandler);
    const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: suffix });
    const signature = await new SignJWT({ request_body_sha256: bodySha256(Buffer.from(raw)) })
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture-key' }).setIssuedAt().sign(privateKey);
    await request(app).post('/api/plaid/webhook').set('Content-Type', 'application/json').send(raw).expect(400);
    for (let i = 0; i < 2; i++) {
      await request(app).post('/api/plaid/webhook').set('Content-Type', 'application/json')
        .set('Plaid-Verification', signature).send(raw).expect(200);
    }
    expect(await prisma.webhookReceipt.count({ where: { bodySha256: bodySha256(Buffer.from(raw)), status: 'DISPATCHED' } })).toBe(2);
    expect(await prisma.syncJob.count({ where: { connectionId, status: 'QUEUED', jobType: 'CONNECTION_SYNC' } })).toBe(1);
    await prisma.webhookReceipt.deleteMany({ where: { bodySha256: bodySha256(Buffer.from(raw)) } });
    await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
    clearVerificationKeyCache(); vi.restoreAllMocks();
  });

  it('preserves user decisions through pending, posting and removal', async () => {
    const pendingId = `pending-${suffix}`;
    const postedId = `posted-${suffix}`;
    expect((await runSync([change(pendingId, 'PENDING')], 'cursor-1')).status).toBe('SUCCEEDED');
    const pending = await prisma.transaction.findFirstOrThrow({ where: { accountId } });
    expect(pending.status).toBe('PENDING');
    await prisma.transaction.update({ where: { id: pending.id }, data: { categoryId, isReviewed: true, categoryOwnership: 'USER' } });
    const removed = { ...change(pendingId, 'PENDING'), changeType: 'REMOVED' as const, providerStatus: 'REMOVED' };
    expect((await runSync([change(postedId, 'POSTED', pendingId), removed], 'cursor-2')).status).toBe('SUCCEEDED');
    const posted = await prisma.transaction.findUniqueOrThrow({ where: { id: pending.id } });
    expect(posted).toMatchObject({ id: pending.id, status: 'POSTED', categoryId, isReviewed: true });
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
    expect((await runSync([{ ...removed, externalTransactionId: postedId }], 'cursor-3')).status).toBe('SUCCEEDED');
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('REMOVED');
  });

  it('rolls back cursor and earlier changes when an account is unmapped', async () => {
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const valid = change(`valid-${suffix}`, 'POSTED');
    const unmapped = { ...change(`unmapped-${suffix}`, 'POSTED'), externalAccountId: 'unknown-account' };
    const result = await runSync([valid, unmapped], 'must-not-commit');
    expect(result.status).toBe('QUEUED');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(before.transactionCursor);
    expect(await prisma.transactionSource.count({ where: { externalTransactionId: valid.externalTransactionId } })).toBe(0);
  });

  it('stages a legacy account and keeps its reviewed transaction through approved cutover', async () => {
    await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
    const legacy = await prisma.account.create({ data: { externalId: `simplefin-${suffix}`, name: 'Existing account',
      currency: 'CAD', type: 'CHECKING', balance: 100, balanceDate: new Date(), ingestionState: 'MIGRATING' } });
    legacyAccountId = legacy.id;
    const source = await prisma.accountSource.create({ data: { connectionId, accountId: legacy.id, externalAccountId: `legacy-${suffix}`, currency: 'CAD' } });
    await prisma.account.update({ where: { id: legacy.id }, data: { candidateSourceId: source.id } });
    const old = await prisma.transaction.create({ data: { externalId: `simplefin-transaction-${suffix}`, accountId: legacy.id,
      amount: '-12.34', posted: new Date('2026-10-29T00:00:00Z'), description: 'Existing merchant',
      categoryId, isReviewed: true, categoryOwnership: 'USER' } });
    const pendingLegacy = { ...change(`legacy-pending-${suffix}`, 'PENDING'), externalAccountId: `legacy-${suffix}` };
    const candidate = { ...change(`legacy-plaid-${suffix}`, 'POSTED', pendingLegacy.externalTransactionId), externalAccountId: `legacy-${suffix}` };
    const repeated = { ...change(`legacy-plaid-repeat-${suffix}`, 'POSTED'), externalAccountId: `legacy-${suffix}` };
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect((await runSync([pendingLegacy, candidate, repeated], 'legacy-cursor')).status).toBe('SUCCEEDED');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(before.transactionCursor);
    const review = await getMigrationReview(connectionId);
    expect(review?.cases[0].candidates[0].evidence.candidates.map((item) => item.id)).toContain(old.id);
    const reviewedCandidates = review!.cases[0].candidates;
    await expect(commitMigrationReview(connectionId, review!.batchId, reviewedCandidates.map((item) => ({ candidateId: item.id,
      action: 'SAME_TRANSACTION' as const, transactionId: old.id })))).rejects.toThrow('distinct suggested match');
    expect((await prisma.account.findUniqueOrThrow({ where: { id: legacy.id } })).ingestionState).toBe('MIGRATING');
    expect(await prisma.transactionSource.count({ where: { accountSourceId: source.id } })).toBe(0);
    await commitMigrationReview(connectionId, review!.batchId, [
      { candidateId: reviewedCandidates[0].id, action: 'SAME_TRANSACTION', transactionId: old.id },
      { candidateId: reviewedCandidates[1].id, action: 'NEW_TRANSACTION' },
    ]);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: legacy.id } })).ingestionState).toBe('ACTIVE');
    // Plaid may change while the owner reviews history. Publication must use
    // the approved snapshot before asking Plaid for subsequent changes.
    const fetch = vi.spyOn(PlaidProvider.prototype, 'syncPage').mockResolvedValue(page([], 'later-cursor'));
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    let published = false;
    for (let retry = 0; retry < 20 && !published; retry++) {
      published = await processNextSyncJob();
      if (!published) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(published).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.transaction.count({ where: { accountId: legacy.id } })).toBe(2);
    expect((await prisma.syncBatch.findUniqueOrThrow({ where: { id: review!.batchId } })).status).toBe('PUBLISHED');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe('legacy-cursor');
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ id: old.id, categoryId, isReviewed: true });
    expect(await prisma.transactionSource.findUniqueOrThrow({ where: { accountSourceId_externalTransactionId: {
      accountSourceId: source.id, externalTransactionId: pendingLegacy.externalTransactionId,
    } } })).toMatchObject({ transactionId: old.id, status: 'REMOVED' });
    let followedUp = false;
    for (let retry = 0; retry < 20 && !followedUp; retry++) {
      followedUp = await processNextSyncJob();
      if (!followedUp) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(followedUp).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'legacy-cursor' }));
    vi.restoreAllMocks();
  });

  it('validates account membership before atomically mapping an existing account', async () => {
    const account = await prisma.account.create({ data: { externalId: `map-${suffix}`, name: 'Mapping fixture', currency: 'CAD',
      type: 'CHECKING', balance: 5, balanceDate: new Date() } });
    mappingAccountId = account.id;
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([{ externalAccountId: `real-${suffix}`,
      name: 'Bank account', officialName: null, mask: '1234', rawType: 'depository', rawSubtype: 'checking',
      currency: 'CAD', currentBalance: '5.00', availableBalance: '5.00', balanceObservedAt: new Date(), unavailable: false }]);
    await expect(applyAccountMappings({ connectionId, sessionId: 'fixture', mappings: [
      { externalAccountId: `real-${suffix}`, action: 'MAP', accountId: account.id },
      { externalAccountId: 'not-in-inventory', action: 'CREATE' },
    ] })).rejects.toThrow('not in this connection');
    expect(await prisma.accountSource.count({ where: { accountId: account.id } })).toBe(0);
    await applyAccountMappings({ connectionId, sessionId: 'fixture', mappings: [
      { externalAccountId: `real-${suffix}`, action: 'MAP', accountId: account.id },
    ] });
    const mapped = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(mapped.ingestionState).toBe('MIGRATING');
    expect(mapped.candidateSourceId).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('fences approved snapshots by configured environment and token key version', async () => {
    await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
    const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const batch = await prisma.syncBatch.create({ data: { connectionId, cursorStart: connection.transactionCursor ?? '',
      cursorEnd: 'wrong-environment-cursor', status: 'STAGED' } });
    const review = await prisma.reconciliationCase.create({ data: { connectionId, kind: 'MIGRATION_PREVIEW', status: 'COMMITTED',
      manifest: { batchId: batch.id, connectionVersion: connection.version } } });
    const queued = await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: queued.jobId } });
    try {
      process.env.PLAID_ENV = 'production';
      await expect(syncConnection(job)).rejects.toThrow('Connection environment or encryption key');
      process.env.PLAID_ENV = 'sandbox';
      process.env.BANK_TOKEN_ENCRYPTION_KEY_VERSION = '2';
      await expect(syncConnection(job)).rejects.toThrow('Connection environment or encryption key');
      expect((await prisma.syncBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('STAGED');
      expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(connection.transactionCursor);
    } finally {
      process.env.PLAID_ENV = 'sandbox'; process.env.BANK_TOKEN_ENCRYPTION_KEY_VERSION = '1';
      await prisma.reconciliationCase.delete({ where: { id: review.id } });
      await prisma.syncBatch.delete({ where: { id: batch.id } });
      await prisma.syncJob.delete({ where: { id: job.id } });
    }
  });

  it('serializes concurrent review approval and refresh', async () => {
    await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
    const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const source = await prisma.accountSource.findFirstOrThrow({ where: { accountId: mappingAccountId, connectionId } });
    const batch = await prisma.syncBatch.create({ data: { connectionId, cursorStart: connection.transactionCursor ?? '',
      cursorEnd: 'race-review-cursor', status: 'STAGED' } });
    const review = await prisma.reconciliationCase.create({ data: { connectionId, accountSourceId: source.id,
      kind: 'MIGRATION_PREVIEW', manifest: { batchId: batch.id, connectionVersion: connection.version } } });
    try {
      const results = await Promise.allSettled([
        commitMigrationReview(connectionId, batch.id, []),
        discardMigrationReview(connectionId, batch.id),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const currentBatch = await prisma.syncBatch.findUniqueOrThrow({ where: { id: batch.id } });
      const currentReview = await prisma.reconciliationCase.findUniqueOrThrow({ where: { id: review.id } });
      const account = await prisma.account.findUniqueOrThrow({ where: { id: mappingAccountId } });
      if (currentReview.status === 'COMMITTED') {
        expect(currentBatch.status).toBe('STAGED');
        expect(account.ingestionState).toBe('ACTIVE');
      } else {
        expect(currentReview.status).toBe('DISCARDED');
        expect(currentBatch.status).toBe('DISCARDED');
        expect(account.ingestionState).toBe('MIGRATING');
      }
      expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(connection.transactionCursor);
    } finally {
      await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
      await prisma.reconciliationCase.delete({ where: { id: review.id } });
      await prisma.syncBatch.delete({ where: { id: batch.id } });
    }
  });

  it('restores unapproved migrations but pauses cutover accounts on disconnect', async () => {
    const itemId = `disconnect-${suffix}`;
    const secret = encryptSecret('fixture-token', key, 1, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId });
    const conn = await prisma.bankConnection.create({ data: { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId,
      tokenCiphertext: secret.ciphertext, tokenNonce: secret.nonce, tokenAuthTag: secret.authTag, tokenKeyVersion: 1 } });
    const first = await prisma.account.create({ data: { externalId: `disconnect-pending-${suffix}`, name: 'Pending', currency: 'CAD', balance: 1, balanceDate: new Date(), ingestionState: 'MIGRATING' } });
    const second = await prisma.account.create({ data: { externalId: `disconnect-active-${suffix}`, name: 'Active', currency: 'CAD', balance: 1, balanceDate: new Date() } });
    try {
      const source = await prisma.accountSource.create({ data: { connectionId: conn.id, accountId: first.id, externalAccountId: 'first', currency: 'CAD' } });
      await prisma.accountSource.create({ data: { connectionId: conn.id, accountId: second.id, externalAccountId: 'second', currency: 'CAD' } });
      await prisma.account.update({ where: { id: first.id }, data: { candidateSourceId: source.id } });
      vi.spyOn(PlaidProvider.prototype, 'removeItem').mockResolvedValue({ removed: true, requestId: 'fixture' });
      expect((await disconnectConnection(conn.id)).retriable).toBe(false);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ ingestionState: 'ACTIVE', candidateSourceId: null });
      expect(await prisma.account.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ ingestionState: 'PAUSED' });
    } finally {
      vi.restoreAllMocks();
      await prisma.bankConnection.delete({ where: { id: conn.id } });
      await prisma.account.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    }
  });

  it('keeps the encrypted token when Plaid removal is not confirmed', async () => {
    const itemId = `disconnect-failure-${suffix}`;
    const secret = encryptSecret('fixture-token', key, 1, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId });
    const conn = await prisma.bankConnection.create({ data: { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId,
      tokenCiphertext: secret.ciphertext, tokenNonce: secret.nonce, tokenAuthTag: secret.authTag, tokenKeyVersion: 1 } });
    try {
      vi.spyOn(PlaidProvider.prototype, 'removeItem').mockRejectedValue(bankProviderError(BankProviderErrorKind.AUTH_REQUIRED, 'ITEM_LOGIN_REQUIRED', 'Fixture error'));
      expect((await disconnectConnection(conn.id)).retriable).toBe(true);
      const remaining = await prisma.bankConnection.findUniqueOrThrow({ where: { id: conn.id } });
      expect(remaining.tokenCiphertext).toBe(secret.ciphertext);
      expect(remaining.pausedAt).not.toBeNull();
    } finally { vi.restoreAllMocks(); await prisma.bankConnection.delete({ where: { id: conn.id } }); }
  });
});
