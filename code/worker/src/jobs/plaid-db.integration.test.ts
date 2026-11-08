import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { BankProviderErrorKind, bankProviderError, PlaidProvider, encryptSecret, decryptSecret, encryptRecoverySecret, decryptRecoverySecret, rotateBankTokenKeys, enqueueBankSync, type NormalizedTransactionChange, type ProviderSyncPage } from '@doughray/shared';
import prisma from '../lib/prisma';
import { claimNextSyncJob, processNextSyncJob } from './sync-queue';
import { commitMigrationReview, discardMigrationReview, getMigrationReview, saveMigrationDraft, getUndoableMigration, undoMigrationReview, searchMigrationMatches, includeMigrationMatch } from '../../../api/src/services/bank-reconciliation.service';
import { syncConnection } from './sync-connection';
import { getReportById, getReports } from '../../../api/src/services/report.service';
import { updateTransactionCategory } from '../../../api/src/services/transaction.service';
import { runTrackingForAccount } from '../../../api/src/services/loan-transaction.service';
import { prisma as apiPrisma } from '../../../api/src/lib/prisma';
import { applyAccountMappings, disconnectConnection, inventorySuggestions } from '../../../api/src/services/plaid-link.service';
import express from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import plaidRoutes from '../../../api/src/routes/plaid';
import bankRoutes from '../../../api/src/routes/bank-connections';
import { PlaidApi } from 'plaid';
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
  async function processAvailableJob(targetConnectionId = connectionId) {
    const target = await prisma.syncJob.findFirst({ where: {
      connectionId: targetConnectionId, jobType: 'CONNECTION_SYNC', status: 'QUEUED',
    } });
    if (!target) return false;
    for (let attempt = 0; attempt < 50; attempt++) {
      // These fixtures exercise provider work, not the independently queued AI job.
      await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
      const processed = await processNextSyncJob();
      const current = await prisma.syncJob.findUniqueOrThrow({ where: { id: target.id } });
      if (current.status !== 'QUEUED' || current.attempts > target.attempts ||
          current.startedAt?.getTime() !== target.startedAt?.getTime()) return true;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  }
  async function claimAvailableJob() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const job = await claimNextSyncJob();
      if (job) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  }
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

  it('deduplicates concurrent signed deliveries but dispatches distinct signatures with identical bodies', async () => {
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
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).post('/api/plaid/webhook').set('Content-Type', 'application/json')
        .set('Plaid-Verification', signature).send(raw).expect(200)));
    expect(responses.filter((response) => !response.body.duplicate)).toHaveLength(1);
    expect(new Set(responses.map((response) => response.body.receiptId)).size).toBe(1);
    expect(await prisma.webhookReceipt.count({ where: { bodySha256: bodySha256(Buffer.from(raw)), status: 'DISPATCHED' } })).toBe(1);
    expect(await prisma.syncJob.count({ where: { connectionId, status: 'QUEUED', jobType: 'CONNECTION_SYNC' } })).toBe(1);
    await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
    const secondSignature = await new SignJWT({ request_body_sha256: bodySha256(Buffer.from(raw)) })
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture-key' }).setIssuedAt().sign(privateKey);
    expect(secondSignature).not.toBe(signature);
    const second = await request(app).post('/api/plaid/webhook').set('Content-Type', 'application/json')
      .set('Plaid-Verification', secondSignature).send(raw).expect(200);
    expect(second.body.duplicate).toBe(false);
    expect(await prisma.webhookReceipt.count({ where: { bodySha256: bodySha256(Buffer.from(raw)), status: 'DISPATCHED' } })).toBe(2);
    expect(await prisma.syncJob.count({ where: { connectionId, status: 'QUEUED', jobType: 'CONNECTION_SYNC' } })).toBe(1);
    await prisma.webhookReceipt.deleteMany({ where: { bodySha256: bodySha256(Buffer.from(raw)) } });
    await prisma.syncJob.deleteMany({ where: { connectionId, status: 'QUEUED' } });
    clearVerificationKeyCache(); vi.restoreAllMocks();
  });

  it('fences an in-flight sync when consent is revoked', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    vi.spyOn(PlaidProvider.prototype, 'getWebhookVerificationKey').mockResolvedValue({ key: { ...jwk, kid: 'revocation-key', alg: 'ES256' } } as never);
    let signalStarted!: () => void;
    let releaseSync!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseSync = resolve; });
    const transactionId = `revoked-${suffix}`;
    vi.spyOn(PlaidProvider.prototype, 'syncPage').mockImplementation(async () => {
      signalStarted();
      await release;
      return page([change(transactionId, 'POSTED')], 'must-not-commit');
    });
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const job = await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    const claimed = await claimAvailableJob();
    expect(claimed?.id).toBe(job.jobId);
    const processing = syncConnection(claimed!);
    await started;
    const raw = JSON.stringify({ webhook_type: 'ITEM', webhook_code: 'USER_PERMISSION_REVOKED', item_id: suffix });
    const signature = await new SignJWT({ request_body_sha256: bodySha256(Buffer.from(raw)) })
      .setProtectedHeader({ alg: 'ES256', kid: 'revocation-key' }).setIssuedAt().sign(privateKey);
    const app = express();
    app.use('/api/plaid/webhook', express.raw({ type: 'application/json' }));
    app.use(express.json()); app.use('/api/plaid', plaidRoutes); app.use(errorHandler);
    try {
      await request(app).post('/api/plaid/webhook').set('Content-Type', 'application/json')
        .set('Plaid-Verification', signature).send(raw).expect(200);
    } finally {
      releaseSync();
    }
    await expect(processing).rejects.toThrow('Connection changed before publication.');
    const after = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(after.status).toBe('AUTH_REQUIRED');
    expect(after.version).toBe(before.version + 1);
    expect(after.transactionCursor).toBe(before.transactionCursor);
    expect(await prisma.transactionSource.count({ where: { externalTransactionId: transactionId } })).toBe(0);
    await prisma.syncJob.delete({ where: { id: job.jobId } });
    await prisma.webhookReceipt.deleteMany({ where: { bodySha256: bodySha256(Buffer.from(raw)) } });
    await prisma.bankConnection.update({ where: { id: connectionId }, data: { status: 'HEALTHY', healthDetail: null } });
    clearVerificationKeyCache(); vi.restoreAllMocks();
  });

  it('commits categorization work with the ledger, even if the worker stops before completing the job', async () => {
    const transactionId = `publication-${suffix}`;
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    vi.spyOn(PlaidProvider.prototype, 'syncPage').mockResolvedValue(page([change(transactionId, 'POSTED')], 'publication-cursor'));
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    const queued = await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    const job = await claimAvailableJob();
    expect(job?.id).toBe(queued.jobId);
    await syncConnection(job!);
    expect((await prisma.syncJob.findUniqueOrThrow({ where: { id: queued.jobId } })).status).toBe('RUNNING');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe('publication-cursor');
    expect(await prisma.transactionSource.count({ where: { externalTransactionId: transactionId } })).toBe(1);
    expect(await prisma.syncJob.count({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } })).toBe(1);
    await prisma.syncJob.deleteMany({ where: { OR: [{ id: queued.jobId }, { jobType: 'CATEGORIZE', status: 'QUEUED' }] } });
    const source = await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: transactionId } });
    await prisma.transaction.delete({ where: { id: source.transactionId } });
    await prisma.bankConnection.update({ where: { id: connectionId }, data: { transactionCursor: before.transactionCursor } });
    vi.restoreAllMocks();
  });

  it('does not enqueue categorization when ledger publication rolls back', async () => {
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    vi.spyOn(PlaidProvider.prototype, 'syncPage').mockResolvedValue(page([
      { ...change(`unmapped-${suffix}`, 'POSTED'), externalAccountId: `unmapped-${suffix}` },
    ], 'must-roll-back'));
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    const queued = await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    const job = await claimAvailableJob();
    expect(job?.id).toBe(queued.jobId);
    await expect(syncConnection(job!)).rejects.toThrow('Map all bank accounts');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(before.transactionCursor);
    expect(await prisma.syncJob.count({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } })).toBe(0);
    await prisma.syncJob.delete({ where: { id: queued.jobId } });
    vi.restoreAllMocks();
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

  it('preserves pending identity and edits when removal and posting arrive in separate batches', async () => {
    const pendingId = `separate-pending-${suffix}`;
    const postedId = `separate-posted-${suffix}`;
    expect((await runSync([change(pendingId, 'PENDING')], 'separate-pending')).status).toBe('SUCCEEDED');
    const pendingSource = await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: pendingId } });
    await prisma.transaction.update({ where: { id: pendingSource.transactionId }, data: {
      categoryId, isReviewed: true, categoryOwnership: 'USER',
    } });
    const removed = { ...change(pendingId, 'PENDING'), changeType: 'REMOVED' as const, providerStatus: 'REMOVED' };
    expect((await runSync([removed], 'separate-removed')).status).toBe('SUCCEEDED');
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: pendingSource.transactionId } })).status).toBe('REMOVED');
    expect((await runSync([change(postedId, 'POSTED', pendingId)], 'separate-posted')).status).toBe('SUCCEEDED');
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: pendingSource.transactionId } })).toMatchObject({
      status: 'POSTED', categoryId, isReviewed: true, categoryOwnership: 'USER',
    });
    expect((await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: postedId } })).transactionId)
      .toBe(pendingSource.transactionId);
  });

  it('removes a transaction from totals when Plaid removes it despite an active historical alias', async () => {
    const externalId = `authoritative-${suffix}`;
    expect((await runSync([change(externalId, 'POSTED')], 'alias-created')).status).toBe('SUCCEEDED');
    const plaidSource = await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: externalId } });
    const legacyConnection = await prisma.bankConnection.create({ data: {
      provider: 'SIMPLEFIN', environment: 'PRODUCTION', externalItemId: `legacy-alias-${suffix}`,
    } });
    try {
      const legacySource = await prisma.accountSource.create({ data: {
        connectionId: legacyConnection.id, accountId, externalAccountId: `legacy-account-${suffix}`, currency: 'CAD', status: 'PAUSED',
      } });
      const alias = await prisma.transactionSource.create({ data: {
        accountSourceId: legacySource.id, transactionId: plaidSource.transactionId,
        externalTransactionId: `legacy-transaction-${suffix}`, observedFacts: {}, status: 'ACTIVE',
      } });
      const removed = { ...change(externalId, 'POSTED'), changeType: 'REMOVED' as const, providerStatus: 'REMOVED' };
      expect((await runSync([removed], 'alias-removed')).status).toBe('SUCCEEDED');
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id: plaidSource.transactionId } })).status).toBe('REMOVED');
      expect((await prisma.transactionSource.findUniqueOrThrow({ where: { id: alias.id } })).status).toBe('ACTIVE');
    } finally {
      await prisma.bankConnection.delete({ where: { id: legacyConnection.id } });
    }
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
    const differentAmount = await prisma.transaction.create({ data: { externalId: `different-amount-${suffix}`, accountId: legacy.id,
      amount: '-88.00', posted: new Date('2026-10-29T00:00:00Z'), description: 'Existing merchant' } });
    const differentCurrency = await prisma.transaction.create({ data: { externalId: `different-currency-${suffix}`, accountId: legacy.id,
      amount: '-12.34', posted: new Date('2026-10-29T00:00:00Z'), description: 'Existing merchant', isoCurrencyCode: 'USD' } });
    const older = await prisma.transaction.create({ data: { externalId: `older-match-${suffix}`, accountId: legacy.id,
      amount: '-12.34', posted: new Date('2026-08-01T00:00:00Z'), description: 'Older merchant', isoCurrencyCode: 'CAD' } });
    const pendingLegacy = { ...change(`legacy-pending-${suffix}`, 'PENDING'), externalAccountId: `legacy-${suffix}` };
    const candidate = { ...change(`legacy-plaid-${suffix}`, 'POSTED', pendingLegacy.externalTransactionId), externalAccountId: `legacy-${suffix}` };
    const repeated = { ...change(`legacy-plaid-repeat-${suffix}`, 'POSTED'), externalAccountId: `legacy-${suffix}` };
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect((await runSync([pendingLegacy, candidate, repeated], 'legacy-cursor')).status).toBe('SUCCEEDED');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(before.transactionCursor);
    const review = await getMigrationReview(connectionId);
    expect(review?.cases[0].candidates[0].evidence.candidates.map((item) => item.id)).toContain(old.id);
    expect(review?.cases[0].candidates[0].evidence.candidates.map((item) => item.id)).not.toContain(differentAmount.id);
    expect(review?.cases[0].candidates[0].evidence.candidates.map((item) => item.id)).not.toContain(differentCurrency.id);
    expect(review?.cases[0].candidates[0].evidence.candidates.map((item) => item.id)).not.toContain(older.id);
    const reviewedCandidates = review!.cases[0].candidates;
    const search = await searchMigrationMatches(connectionId, review!.batchId, reviewedCandidates[0].id, 'merchant', 1);
    expect(search.matches.map((item) => item.id)).toContain(older.id);
    expect(search.matches.map((item) => item.id)).not.toContain(differentAmount.id);
    expect(search.matches.map((item) => item.id)).not.toContain(differentCurrency.id);
    const searched = search.matches.find((item) => item.id === older.id)!;
    await expect(includeMigrationMatch(connectionId, review!.batchId, reviewedCandidates[0].id, differentCurrency.id,
      differentCurrency.updatedAt.toISOString())).rejects.toThrow('not eligible');
    await prisma.transaction.update({ where: { id: older.id }, data: { description: 'Older merchant updated' } });
    await expect(includeMigrationMatch(connectionId, review!.batchId, reviewedCandidates[0].id, older.id,
      searched.updatedAt.toISOString())).rejects.toThrow('changed or is not eligible');
    const updated = (await searchMigrationMatches(connectionId, review!.batchId, reviewedCandidates[0].id, 'older', 1)).matches[0];
    await includeMigrationMatch(connectionId, review!.batchId, reviewedCandidates[0].id, older.id, updated.updatedAt.toISOString());
    const draft = [{ candidateId: reviewedCandidates[0].id, action: 'SAME_TRANSACTION' as const, transactionId: older.id }];
    const draftAttempts = await Promise.allSettled([
      saveMigrationDraft(connectionId, review!.batchId, review!.draftVersion, draft),
      saveMigrationDraft(connectionId, review!.batchId, review!.draftVersion, draft),
    ]);
    expect(draftAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const reopened = await getMigrationReview(connectionId);
    expect(reopened!.cases[0].draft).toEqual(draft);
    expect(reopened!.draftVersion).toBe(review!.draftVersion + 1);
    expect(reopened!.cases[0].candidates[0].evidence.candidates).toContainEqual(expect.objectContaining({ id: older.id, searched: true }));
    await prisma.transaction.deleteMany({ where: { id: { in: [older.id, differentAmount.id, differentCurrency.id] } } });
    await expect(commitMigrationReview(connectionId, review!.batchId, reviewedCandidates.map((item) => ({ candidateId: item.id,
      action: 'SAME_TRANSACTION' as const, transactionId: old.id })))).rejects.toThrow('distinct suggested match');
    expect((await prisma.account.findUniqueOrThrow({ where: { id: legacy.id } })).ingestionState).toBe('MIGRATING');
    expect(await prisma.transactionSource.count({ where: { accountSourceId: source.id } })).toBe(0);
    await commitMigrationReview(connectionId, review!.batchId, [
      { candidateId: reviewedCandidates[0].id, action: 'SAME_TRANSACTION', transactionId: old.id },
      { candidateId: reviewedCandidates[1].id, action: 'NEW_TRANSACTION' },
    ]);
    expect(await prisma.reconciliationDecision.count({ where: { caseId: review!.cases[0].id, appliedAt: null } })).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: legacy.id } })).ingestionState).toBe('ACTIVE');
    // Plaid may change while the owner reviews history. Publication must use
    // the approved snapshot before asking Plaid for subsequent changes.
    const fetch = vi.spyOn(PlaidProvider.prototype, 'syncPage').mockResolvedValue(page([], 'later-cursor'));
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    expect(await processAvailableJob()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.transaction.count({ where: { accountId: legacy.id } })).toBe(2);
    expect((await prisma.syncBatch.findUniqueOrThrow({ where: { id: review!.batchId } })).status).toBe('PUBLISHED');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe('legacy-cursor');
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ id: old.id, categoryId, isReviewed: true });
    expect(await prisma.transactionSource.findUniqueOrThrow({ where: { accountSourceId_externalTransactionId: {
      accountSourceId: source.id, externalTransactionId: pendingLegacy.externalTransactionId,
    } } })).toMatchObject({ transactionId: old.id, status: 'REMOVED' });
    expect(await processAvailableJob()).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'legacy-cursor' }));
    vi.restoreAllMocks();

    expect((await getUndoableMigration(connectionId))?.batchId).toBe(review!.batchId);
    const newSource = await prisma.transactionSource.findUniqueOrThrow({ where: { accountSourceId_externalTransactionId: {
      accountSourceId: source.id, externalTransactionId: repeated.externalTransactionId,
    } } });
    await prisma.transaction.update({ where: { id: newSource.transactionId }, data: { categoryId, isReviewed: true } });
    await expect(undoMigrationReview(connectionId, review!.batchId)).rejects.toThrow('categorized or reviewed');
    expect((await prisma.accountSource.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('ACTIVE');
    await prisma.transaction.update({ where: { id: newSource.transactionId }, data: { categoryId: null, isReviewed: false } });
    await prisma.transaction.update({ where: { id: old.id }, data: { isReviewed: false } });
    expect(await undoMigrationReview(connectionId, review!.batchId)).toEqual({ accounts: 1 });
    expect(await prisma.accountSource.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ status: 'PAUSED' });
    expect(await prisma.account.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ ingestionState: 'ACTIVE', candidateSourceId: null });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      description: 'Existing merchant', status: 'POSTED', categoryId, isReviewed: false,
    });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: newSource.transactionId } })).status).toBe('REMOVED');
    expect(await getUndoableMigration(connectionId)).toBeNull();
  });

  it('commits an explicitly searched same-amount match outside the suggestion window', async () => {
    await prisma.syncJob.deleteMany({ where: { status: 'QUEUED' } });
    const itemId = `search-${suffix}`;
    const secret = encryptSecret('fixture-token', key, 1, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId });
    const conn = await prisma.bankConnection.create({ data: { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId,
      tokenCiphertext: secret.ciphertext, tokenNonce: secret.nonce, tokenAuthTag: secret.authTag, tokenKeyVersion: 1 } });
    const account = await prisma.account.create({ data: { externalId: `search-account-${suffix}`, name: 'Search fixture', currency: 'CAD',
      type: 'CHECKING', balance: 100, balanceDate: new Date(), ingestionState: 'MIGRATING' } });
    try {
      const source = await prisma.accountSource.create({ data: { connectionId: conn.id, accountId: account.id, externalAccountId: `search-bank-${suffix}`, currency: 'CAD' } });
      await prisma.account.update({ where: { id: account.id }, data: { candidateSourceId: source.id } });
      const old = await prisma.transaction.create({ data: { externalId: `search-old-${suffix}`, accountId: account.id, amount: '-12.34',
        posted: new Date('2026-08-01T00:00:00Z'), description: 'Older match' } });
      await prisma.transaction.createMany({ data: Array.from({ length: 26 }, (_, index) => ({
        externalId: `search-extra-${index}-${suffix}`, accountId: account.id, amount: '-12.34',
        posted: new Date('2026-07-01T00:00:00Z'), description: `Older fixture ${index}`,
      })) });
      vi.spyOn(PlaidProvider.prototype, 'syncPage').mockResolvedValue(page([{ ...change(`search-new-${suffix}`, 'POSTED'), externalAccountId: source.externalAccountId }], 'search-cursor'));
      vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
      await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId: conn.id });
      expect(await processAvailableJob(conn.id)).toBe(true);
      const review = (await getMigrationReview(conn.id))!;
      const candidate = review.cases[0].candidates[0];
      const firstPage = await searchMigrationMatches(conn.id, review.batchId, candidate.id, 'Older', 1);
      const secondPage = await searchMigrationMatches(conn.id, review.batchId, candidate.id, 'Older', 2);
      expect(firstPage.matches).toHaveLength(25);
      expect(firstPage.hasMore).toBe(true);
      expect(secondPage.matches).toHaveLength(2);
      expect(secondPage.hasMore).toBe(false);
      expect(new Set([...firstPage.matches, ...secondPage.matches].map((item) => item.id)).size).toBe(27);
      const match = firstPage.matches.find((item) => item.id === old.id)!;
      await includeMigrationMatch(conn.id, review.batchId, candidate.id, old.id, match.updatedAt.toISOString());
      await prisma.transaction.update({ where: { id: old.id }, data: { description: 'Older match changed' } });
      await expect(commitMigrationReview(conn.id, review.batchId, [{ candidateId: candidate.id, action: 'SAME_TRANSACTION', transactionId: old.id }]))
        .rejects.toThrow('matching transaction changed');
      const refreshed = (await searchMigrationMatches(conn.id, review.batchId, candidate.id, 'Older', 1)).matches[0];
      await includeMigrationMatch(conn.id, review.batchId, candidate.id, old.id, refreshed.updatedAt.toISOString());
      await commitMigrationReview(conn.id, review.batchId, [{ candidateId: candidate.id, action: 'SAME_TRANSACTION', transactionId: old.id }]);
      expect(await prisma.transactionSource.findUnique({ where: { accountSourceId_externalTransactionId: {
        accountSourceId: source.id, externalTransactionId: `search-new-${suffix}`,
      } } })).toMatchObject({ transactionId: old.id });
    } finally {
      vi.restoreAllMocks();
      await prisma.reconciliationCase.deleteMany({ where: { connectionId: conn.id } });
      await prisma.bankConnection.delete({ where: { id: conn.id } });
      await prisma.account.delete({ where: { id: account.id } });
      await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
    }
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
      await prisma.account.update({ where: { id: mappingAccountId }, data: { ingestionState: 'ACTIVE', candidateSourceId: null } });
      await prisma.accountSource.delete({ where: { id: source.id } });
    }
  });

  it('excludes an unavailable account without blocking other account syncs', async () => {
    await prisma.syncJob.deleteMany({ where: { status: 'QUEUED' } });
    const itemId = `ignore-${suffix}`;
    const secret = encryptSecret('fixture-token', key, 1, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId });
    const conn = await prisma.bankConnection.create({ data: { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId,
      tokenCiphertext: secret.ciphertext, tokenNonce: secret.nonce, tokenAuthTag: secret.authTag, tokenKeyVersion: 1 } });
    const externalAccountId = `ignored-${suffix}`;
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([{ externalAccountId, name: 'Unavailable account',
      officialName: null, mask: null, rawType: 'investment', rawSubtype: '401k', currency: 'CAD', currentBalance: null,
      availableBalance: null, balanceObservedAt: new Date(), unavailable: true }]);
    vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue({ data: { added: [{ account_id: externalAccountId,
      transaction_id: 'ignored-invalid', amount: null }], modified: [], removed: [], accounts: [], has_more: false,
      next_cursor: 'ignored-cursor', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } } as never);
    try {
      await applyAccountMappings({ connectionId: conn.id, sessionId: 'fixture', mappings: [{ externalAccountId, action: 'IGNORE' }] });
      expect((await inventorySuggestions(conn.id)).accounts[0]).toMatchObject({ ignored: true, currentBalance: null });
      expect(await processAvailableJob(conn.id)).toBe(true);
      expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: conn.id } })).transactionCursor).toBe('ignored-cursor');
      expect(await prisma.quarantineItem.count({ where: { connectionId: conn.id } })).toBe(0);
      await expect(applyAccountMappings({ connectionId: conn.id, sessionId: 'fixture', mappings: [
        { externalAccountId, action: 'MAP', accountId },
      ] })).rejects.toThrow('earlier history cannot be recovered');
      expect(await prisma.ignoredBankAccount.count({ where: { connectionId: conn.id, externalAccountId } })).toBe(1);
      expect(await prisma.accountSource.count({ where: { connectionId: conn.id } })).toBe(0);
      expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: conn.id } })).transactionCursor).toBe('ignored-cursor');
    } finally {
      vi.restoreAllMocks();
      await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
      await prisma.bankConnection.delete({ where: { id: conn.id } });
    }
  });

  it('allows an excluded account to be mapped before any cursor has advanced', async () => {
    const itemId = `exclude-before-sync-${suffix}`;
    const secret = encryptSecret('fixture-token', key, 1, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId });
    const connection = await prisma.bankConnection.create({ data: { provider: 'PLAID', environment: 'SANDBOX', externalItemId: itemId,
      tokenCiphertext: secret.ciphertext, tokenNonce: secret.nonce, tokenAuthTag: secret.authTag, tokenKeyVersion: 1 } });
    const account = await prisma.account.create({ data: { externalId: `exclude-before-sync-local-${suffix}`,
      name: 'Existing account', currency: 'CAD', balance: 1, balanceDate: new Date() } });
    const externalAccountId = `exclude-before-sync-account-${suffix}`;
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([{ externalAccountId, name: 'Bank account',
      officialName: null, mask: null, rawType: 'depository', rawSubtype: 'checking', currency: 'CAD', currentBalance: '1.00',
      availableBalance: '1.00', balanceObservedAt: new Date(), unavailable: false }]);
    try {
      await applyAccountMappings({ connectionId: connection.id, sessionId: 'fixture', mappings: [{ externalAccountId, action: 'IGNORE' }] });
      await applyAccountMappings({ connectionId: connection.id, sessionId: 'fixture', mappings: [{ externalAccountId, action: 'MAP', accountId: account.id }] });
      expect(await prisma.ignoredBankAccount.count({ where: { connectionId: connection.id } })).toBe(0);
      expect(await prisma.accountSource.count({ where: { connectionId: connection.id, accountId: account.id } })).toBe(1);
      expect(await prisma.syncJob.count({ where: { connectionId: connection.id, jobType: 'CONNECTION_SYNC', status: 'QUEUED' } })).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await prisma.bankConnection.delete({ where: { id: connection.id } });
      await prisma.account.delete({ where: { id: account.id } });
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

  it('quarantines an invalid provider record and replays an explicitly repaired value without advancing early', async () => {
    await prisma.syncJob.deleteMany({ where: { status: 'QUEUED' } });
    const id = `quarantine-${suffix}`;
    const original = { transaction_id: id, account_id: `acct-${suffix}`, amount: null, date: '2026-10-29',
      name: 'Invalid purchase', pending: false, iso_currency_code: 'CAD' };
    vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue({ data: { added: [original], modified: [], removed: [],
      accounts: [], has_more: false, next_cursor: 'quarantine-cursor', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } } as never);
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    const before = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const job = await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    expect(await processAvailableJob()).toBe(true);
    expect((await prisma.syncJob.findUniqueOrThrow({ where: { id: job.jobId } })).status).toBe('FAILED');
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe(before.transactionCursor);
    const item = await prisma.quarantineItem.findFirstOrThrow({ where: { connectionId, externalTransactionId: id, status: 'OPEN' } });
    const app = express(); app.use(express.json()); app.use('/api/bank-connections', bankRoutes); app.use(errorHandler);
    const replay = await request(app).post(`/api/bank-connections/${connectionId}/quarantine/${item.id}/replay`).send({ patch: { amount: 12.34 } }).expect(202);
    expect(await processAvailableJob()).toBe(true);
    expect(await prisma.syncJob.findUniqueOrThrow({ where: { id: replay.body.data.jobId }, select: { status: true, errorMessage: true } })).toEqual({ status: 'SUCCEEDED', errorMessage: null });
    expect((await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionCursor).toBe('quarantine-cursor');
    expect((await prisma.quarantineItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('RESOLVED');
    const source = await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: id }, include: { transaction: true } });
    expect(source.transaction.amount.toString()).toBe('-12.34');
    await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
    vi.restoreAllMocks();
  });

  it('does not apply an old repair over a newer provider version', async () => {
    await prisma.syncJob.deleteMany({ where: { status: 'QUEUED' } });
    const id = `quarantine-newer-${suffix}`;
    const original = { transaction_id: id, account_id: `acct-${suffix}`, amount: null, date: '2026-10-29',
      name: 'Changed purchase', pending: false, iso_currency_code: 'CAD' };
    const response = (amount: number | null, cursor: string) => ({ data: { added: [{ ...original, amount }], modified: [], removed: [],
      accounts: [], has_more: false, next_cursor: cursor, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } });
    const fetch = vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue(response(null, 'unused') as never);
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    expect(await processAvailableJob()).toBe(true);
    const item = await prisma.quarantineItem.findFirstOrThrow({ where: { connectionId, externalTransactionId: id, status: 'OPEN' } });
    const app = express(); app.use(express.json()); app.use('/api/bank-connections', bankRoutes); app.use(errorHandler);
    await request(app).post(`/api/bank-connections/${connectionId}/quarantine/${item.id}/replay`).send({ patch: { amount: 99 } }).expect(202);
    fetch.mockResolvedValue(response(55, 'newer-cursor') as never);
    expect(await processAvailableJob()).toBe(true);
    const source = await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: id }, include: { transaction: true } });
    expect(source.transaction.amount.toString()).toBe('-55');
    expect((await prisma.quarantineItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('RESOLVED');
    await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
    vi.restoreAllMocks();
  });

  it('does not resurrect a quarantined transaction removed before replay', async () => {
    await prisma.syncJob.deleteMany({ where: { status: 'QUEUED' } });
    const id = `quarantine-removed-${suffix}`;
    const original = { transaction_id: id, account_id: `acct-${suffix}`, amount: null, date: '2026-10-29',
      name: 'Removed purchase', pending: false, iso_currency_code: 'CAD' };
    const fetch = vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue({ data: { added: [original], modified: [], removed: [],
      accounts: [], has_more: false, next_cursor: 'unused', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } } as never);
    vi.spyOn(PlaidProvider.prototype, 'listAccounts').mockResolvedValue([]);
    await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId });
    expect(await processAvailableJob()).toBe(true);
    const item = await prisma.quarantineItem.findFirstOrThrow({ where: { connectionId, externalTransactionId: id, status: 'OPEN' } });
    const app = express(); app.use(express.json()); app.use('/api/bank-connections', bankRoutes); app.use(errorHandler);
    await request(app).post(`/api/bank-connections/${connectionId}/quarantine/${item.id}/replay`).send({ patch: { amount: 99 } }).expect(202);
    fetch.mockResolvedValue({ data: { added: [], modified: [], removed: [{ transaction_id: id, account_id: `acct-${suffix}` }],
      accounts: [], has_more: false, next_cursor: 'removed-cursor', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } } as never);
    expect(await processAvailableJob()).toBe(true);
    expect(await prisma.transactionSource.findFirst({ where: { externalTransactionId: id } })).toBeNull();
    expect((await prisma.quarantineItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('RESOLVED');
    await prisma.syncJob.deleteMany({ where: { jobType: 'CATEGORIZE', status: 'QUEUED' } });
    vi.restoreAllMocks();
  });

  it('reconciles derived loan links after Plaid corrections, categorization and removals', async () => {
    await prisma.syncJob.deleteMany({ where: { status: 'QUEUED' } });
    const loan = await prisma.account.create({ data: { externalId: `loan-${suffix}`, name: 'Loan fixture', currency: 'CAD',
      type: 'LOAN', balance: -1000, balanceDate: new Date() } });
    const loanCategory = await prisma.category.create({ data: { name: `loan-category-${suffix}` } });
    try {
      await prisma.loanTransactionRule.create({ data: { accountId: loan.id, ruleType: 'PAYEE', normalizedPayee: 'fixture mortgage' } });
      const categoryRule = await prisma.loanTransactionRule.create({ data: { accountId: loan.id, ruleType: 'CATEGORY', categoryId: loanCategory.id } });
      const id = `loan-payment-${suffix}`;
      const original = { ...change(id, 'POSTED'), observedFacts: { ...change(id, 'POSTED').observedFacts,
        description: 'Fixture mortgage payment', payee: 'Fixture mortgage' } };
      expect((await runSync([original], 'loan-1')).status).toBe('SUCCEEDED');
      const source = await prisma.transactionSource.findFirstOrThrow({ where: { externalTransactionId: id } });
      let linked = await prisma.loanTransaction.findFirstOrThrow({ where: { sourceTransactionId: source.transactionId, linkedAccountId: loan.id } });
      expect(linked.amount.toString()).toBe('-12.34');
      expect((await runSync([{ ...original, changeType: 'MODIFIED', amount: '-30.00', postedDate: '2026-10-28' }], 'loan-2')).status).toBe('SUCCEEDED');
      linked = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: linked.id } });
      expect(linked.amount.toString()).toBe('-30');
      expect(linked.posted.toISOString()).toBe('2026-10-28T00:00:00.000Z');
      const changedPayee = { ...original, changeType: 'MODIFIED' as const, observedFacts: { ...original.observedFacts,
        description: 'Unrelated purchase', payee: 'Other' } };
      expect((await runSync([changedPayee], 'loan-3')).status).toBe('SUCCEEDED');
      expect(await prisma.loanTransaction.count({ where: { sourceTransactionId: source.transactionId, linkedAccountId: loan.id } })).toBe(0);
      await updateTransactionCategory(source.transactionId, loanCategory.id);
      expect(await prisma.loanTransaction.count({ where: { sourceTransactionId: source.transactionId, linkedAccountId: loan.id } })).toBe(1);
      await prisma.loanTransactionRule.update({ where: { id: categoryRule.id }, data: { isActive: false } });
      expect(await runTrackingForAccount(loan.id)).toBe(0);
      expect(await prisma.loanTransaction.count({ where: { sourceTransactionId: source.transactionId, linkedAccountId: loan.id } })).toBe(0);
      await prisma.loanTransactionRule.update({ where: { id: categoryRule.id }, data: { isActive: true } });
      expect(await runTrackingForAccount(loan.id)).toBe(1);
      expect((await runSync([{ ...original, changeType: 'REMOVED', providerStatus: 'REMOVED' }], 'loan-4')).status).toBe('SUCCEEDED');
      expect(await prisma.loanTransaction.count({ where: { sourceTransactionId: source.transactionId, linkedAccountId: loan.id } })).toBe(0);
    } finally {
      await prisma.account.delete({ where: { id: loan.id } });
      await prisma.category.delete({ where: { id: loanCategory.id } });
    }
  });

  it('marks reports stale after committed changes, including changes during report generation', async () => {
    const revision = (await prisma.reportRevision.findUniqueOrThrow({ where: { id: 'ledger' } })).revision;
    const report = await prisma.report.create({ data: { title: 'Fixture', type: 'MONTHLY_SUMMARY',
      content: {}, period: `fixture-${suffix}`, dataRevision: revision } });
    let concurrentId: string | undefined;
    try {
      expect((await getReportById(report.id))?.isStale).toBe(false);
      await expect(prisma.$transaction(async (tx) => {
        await tx.account.update({ where: { id: accountId }, data: { balance: 123 } });
        throw new Error('rollback fixture');
      })).rejects.toThrow('rollback fixture');
      expect((await getReportById(report.id))?.isStale).toBe(false);
      await prisma.account.update({ where: { id: accountId }, data: { balance: 124 } });
      expect((await getReportById(report.id))?.isStale).toBe(true);
      const concurrent = await prisma.report.create({ data: { title: 'Concurrent fixture', type: 'MONTHLY_SUMMARY',
        content: {}, period: `concurrent-${suffix}`, dataRevision: revision } });
      concurrentId = concurrent.id;
      expect((await getReportById(concurrent.id))?.isStale).toBe(true);
      expect((await getReports(1, 100)).data.find((item) => item.id === report.id)?.isStale).toBe(true);
    } finally { await prisma.report.deleteMany({ where: { id: { in: [report.id, ...(concurrentId ? [concurrentId] : [])] } } }); }
  });

  it('rotates connection and recovery tokens atomically and rolls back on corrupt data', async () => {
    const nextKey = randomBytes(32);
    const attempt = await prisma.linkAttempt.create({ data: { sessionId: 'rotation-fixture', provider: 'PLAID', environment: 'SANDBOX',
      expiresAt: new Date(Date.now() + 60000) } });
    const linkToken = encryptRecoverySecret('fixture-link', key, 1, `link-token:${attempt.id}`);
    const recoveryToken = encryptRecoverySecret('fixture-recovery', key, 1, `access-token:${attempt.id}`);
    await prisma.linkAttempt.update({ where: { id: attempt.id }, data: { linkToken: JSON.stringify(linkToken),
      recoveryPublicTokenCiphertext: '{broken' } });
    const original = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    try {
      await expect(rotateBankTokenKeys(prisma, key, 1, nextKey, 2)).rejects.toThrow('malformed');
      expect(await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).toMatchObject({
        tokenCiphertext: original.tokenCiphertext, tokenKeyVersion: 1, version: original.version });
      await prisma.linkAttempt.update({ where: { id: attempt.id }, data: { recoveryPublicTokenCiphertext: JSON.stringify(recoveryToken) } });
      await rotateBankTokenKeys(prisma, key, 1, nextKey, 2);
      const rotated = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(rotated.tokenKeyVersion).toBe(2);
      expect(rotated.version).toBe(original.version + 1);
      expect(decryptSecret({ ciphertext: rotated.tokenCiphertext!, nonce: rotated.tokenNonce!, authTag: rotated.tokenAuthTag!, keyVersion: 2 },
        nextKey, { provider: 'PLAID', environment: 'SANDBOX', externalItemId: suffix })).toBe('fixture-access-token');
      const saved = await prisma.linkAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(decryptRecoverySecret(JSON.parse(saved.linkToken!), nextKey, `link-token:${attempt.id}`)).toBe('fixture-link');
      expect(decryptRecoverySecret(JSON.parse(saved.recoveryPublicTokenCiphertext!), nextKey, `access-token:${attempt.id}`)).toBe('fixture-recovery');
    } finally { await prisma.linkAttempt.delete({ where: { id: attempt.id } }); }
  });
});
