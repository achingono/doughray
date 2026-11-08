import { randomUUID } from 'node:crypto';
import { Prisma, type SyncJob } from '@prisma/client';
import {
  BankProviderErrorKind, NormalizationError, PlaidProvider, dateOnlyToUtcStorage,
  decryptSecret, loadBankConfig, validateCurrency, QuarantinedProviderRecord, NORMALIZATION_VERSION,
  accountFacts, transactionFacts, transactionAnnotations, sourceFacts,
  enqueueBankSync,
  reconcileLoanTransactions,
  type NormalizedTransactionChange, type PlaidRecordRepair,
} from '@doughray/shared';
import prisma from '../lib/prisma';

/** Fetch all pages before publishing. A mutation restarts at the original cursor. */
export async function fetchCompleteUpdate(provider: Pick<PlaidProvider, 'syncPage'>, accessToken: string, startCursor: string | null, repairs: PlaidRecordRepair[] = [], excludedAccountIds: string[] = []) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = startCursor;
    let historyStatus: string | null = null;
    const changes: NormalizedTransactionChange[] = [];
    try {
      for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
        const page = await provider.syncPage({ accessToken, cursor, ...(repairs.length ? { repairs } : {}),
          ...(excludedAccountIds.length ? { excludedAccountIds } : {}) });
        changes.push(...page.changes);
        historyStatus = page.transactionsUpdateStatus;
        cursor = page.nextCursor;
        if (!page.hasMore) return { changes, cursor, historyStatus };
        if (cursor === null) throw new Error('Plaid returned a missing pagination cursor.');
      }
      throw new Error('Plaid update exceeded the page limit.');
    } catch (error) {
      if ((error as { kind?: string }).kind === BankProviderErrorKind.MUTATION_DURING_PAGINATION && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Plaid update could not be paginated.');
}

export async function syncConnection(job: SyncJob): Promise<void> {
  if (!job.connectionId) throw new Error('Connection sync job has no connection.');
  const connection = await prisma.bankConnection.findUnique({ where: { id: job.connectionId } });
  if (!connection || connection.provider !== 'PLAID' || ['DISCONNECTED', 'AUTH_REQUIRED', 'CONSENT_REVOKED'].includes(connection.status) || connection.pausedAt) {
    throw new Error('Connection is unavailable or paused.');
  }
  const config = loadBankConfig();
  const configuredEnvironment = config.plaid.env === 'production' ? 'PRODUCTION' : config.plaid.env === 'sandbox' ? 'SANDBOX' : null;
  if (configuredEnvironment !== connection.environment || !config.encryption.keyMaterial ||
      !connection.tokenCiphertext || !connection.tokenNonce || !connection.tokenAuthTag ||
      connection.tokenKeyVersion !== config.encryption.keyVersion) {
    throw new Error('Connection environment or encryption key is not available.');
  }
  // Keep the reviewed snapshot stable until the owner commits or discards it.
  const staged = await prisma.syncBatch.findFirst({ where: {
    connectionId: connection.id, status: 'STAGED', cursorStart: connection.transactionCursor ?? '',
  } });
  if (staged) {
    const cases = await prisma.reconciliationCase.findMany({ where: { connectionId: connection.id }, select: { status: true, manifest: true } });
    const related = cases.filter((item) => (item.manifest as { batchId?: string } | null)?.batchId === staged.id);
    if (related.length && related.every((item) => item.status === 'COMMITTED')) {
      await publishApprovedBatch(job, connection, staged.id);
    }
    return;
  }
  const accessToken = decryptSecret({ ciphertext: connection.tokenCiphertext, nonce: connection.tokenNonce,
    authTag: connection.tokenAuthTag, keyVersion: connection.tokenKeyVersion }, config.encryption.keyMaterial,
    { provider: 'PLAID', environment: connection.environment, externalItemId: connection.externalItemId });
  const provider = new PlaidProvider({ settings: config.plaid });
  const [pausedSources, ignoredAccounts] = await Promise.all([
    prisma.accountSource.findMany({ where: { connectionId: connection.id, status: 'PAUSED' }, select: { externalAccountId: true } }),
    prisma.ignoredBankAccount.findMany({ where: { connectionId: connection.id }, select: { externalAccountId: true } }),
  ]);
  const excludedAccountIds = [...new Set([...pausedSources, ...ignoredAccounts].map((source) => source.externalAccountId))];
  const quarantine = await prisma.quarantineItem.findMany({ where: { connectionId: connection.id, status: 'REPLAYING' } });
  const repairs: PlaidRecordRepair[] = quarantine.map((item) => item.sourcePayload as unknown as {
    cursorStart: string | null; fingerprint: string; ruleVersion: number; patch?: PlaidRecordRepair['patch'];
  }).filter((item) => item.cursorStart === connection.transactionCursor && item.ruleVersion === NORMALIZATION_VERSION && item.patch !== undefined)
    .map((item) => ({ fingerprint: item.fingerprint, ruleVersion: item.ruleVersion, patch: item.patch! }));
  let update: Awaited<ReturnType<typeof fetchCompleteUpdate>>;
  try { update = await fetchCompleteUpdate(provider, accessToken, connection.transactionCursor, repairs, excludedAccountIds); }
  catch (error) { annotateQuarantine(error, connection.transactionCursor, connection.version); throw error; }
  const inventory = await provider.listAccounts(accessToken, excludedAccountIds);

  // Network calls are complete before entering the database transaction.
  try { await prisma.$transaction(async (tx) => {
    const now = new Date();
    const fencedJob = await tx.syncJob.updateMany({ where: {
      id: job.id, status: 'RUNNING', leaseOwner: job.leaseOwner, version: job.version,
      leaseExpiresAt: { gt: now },
    }, data: { heartbeatAt: now } });
    if (fencedJob.count !== 1) throw new Error('Sync lease expired before publication.');
    const sources = await tx.accountSource.findMany({ where: { connectionId: connection.id, status: 'ACTIVE' }, include: { account: true } });
    const sourcesByExternalId = new Map(sources.map((source) => [source.externalAccountId, source]));
    for (const change of update.changes) {
      if (change.changeType !== 'REMOVED' && !sourcesByExternalId.has(change.externalAccountId)) {
        throw new Error('Map all bank accounts before importing their transactions.');
      }
    }
    const migrating = sources.filter((source) => source.account.ingestionState === 'MIGRATING' && source.account.candidateSourceId === source.id);
    if (migrating.length) {
      const guarded = await tx.bankConnection.updateMany({ where: {
        id: connection.id, version: connection.version, pausedAt: null, status: { notIn: ['DISCONNECTED', 'AUTH_REQUIRED', 'CONSENT_REVOKED'] },
      }, data: {
        transactionsInitialState: update.historyStatus === 'NOT_READY' ? 'NOT_READY' : 'COMPLETE',
        transactionsHistoryState: update.historyStatus === 'HISTORICAL_UPDATE_COMPLETE' ? 'COMPLETE' : 'PROCESSING',
        healthDetail: update.historyStatus === 'HISTORICAL_UPDATE_COMPLETE' ? 'Review account history before switching providers.' : 'Waiting for historical transactions before reconciliation.',
      } });
      if (guarded.count !== 1) throw new Error('Connection changed before staging.');
      // Reconciliation must cover historical data, not only the first partial pull.
      if (update.historyStatus !== 'HISTORICAL_UPDATE_COMPLETE') return;
      const batch = await tx.syncBatch.create({ data: { connectionId: connection.id, jobId: job.id, status: 'STAGED',
        cursorStart: connection.transactionCursor ?? '', cursorEnd: update.cursor, attempt: job.attempts, isHistorical: true } });
      // Keep only the last patch for each provider ID in this snapshot.
      const latest = new Map(update.changes.map((change) => [change.externalTransactionId, change]));
      for (const change of latest.values()) {
        const source = sourcesByExternalId.get(change.externalAccountId);
        await tx.syncBatchItem.create({ data: { batchId: batch.id, accountSourceId: source?.id,
          externalTransactionId: change.externalTransactionId, changeType: change.changeType,
          observedFacts: JSON.parse(JSON.stringify(change)) as Prisma.InputJsonObject } });
      }
      for (const source of migrating) {
        const caseRow = await tx.reconciliationCase.create({ data: { kind: 'MIGRATION_PREVIEW', connectionId: connection.id,
          accountSourceId: source.id, manifest: { batchId: batch.id, connectionVersion: connection.version },
          coverageJson: { historyStatus: update.historyStatus } } });
        for (const change of latest.values()) {
          if (change.externalAccountId !== source.externalAccountId || change.changeType === 'REMOVED' || change.providerStatus !== 'POSTED') continue;
          validateAccountCurrency(change, source.account.currency);
          const posted = dateOnlyToUtcStorage(change.postedDate);
          const candidates = await tx.transaction.findMany({ where: { accountId: source.accountId, status: 'POSTED',
            amount: change.amount,
            OR: [{ isoCurrencyCode: null }, { isoCurrencyCode: source.account.currency.toUpperCase() }],
            posted: { gte: new Date(posted.getTime() - 3 * 86400000), lte: new Date(posted.getTime() + 3 * 86400000) } },
            select: { id: true, posted: true, amount: true, description: true, payee: true }, orderBy: { posted: 'desc' }, take: 100 });
          await tx.reconciliationCandidate.create({ data: { caseId: caseRow.id, accountId: source.accountId, accountSourceId: source.id,
            plaidTransactionExternalId: change.externalTransactionId, proposedAction: 'DEFER',
            evidence: JSON.parse(JSON.stringify({ change, candidates })) as Prisma.InputJsonObject } });
        }
      }
      return;
    }
    const fencedConnection = await tx.bankConnection.updateMany({ where: {
      id: connection.id, version: connection.version, pausedAt: null, status: { notIn: ['DISCONNECTED', 'AUTH_REQUIRED', 'CONSENT_REVOKED'] },
    }, data: { status: 'HEALTHY', healthDetail: null, lastErrorCode: null, lastErrorMessage: null,
      lastSuccessfulSyncAt: now, transactionCursor: update.cursor, transactionCursorUpdatedAt: now,
      transactionsInitialState: update.historyStatus === 'NOT_READY' ? 'NOT_READY'
        : update.historyStatus === 'INITIAL_UPDATE_COMPLETE' || update.historyStatus === 'HISTORICAL_UPDATE_COMPLETE' ? 'COMPLETE' : 'PROCESSING',
      transactionsHistoryState: update.historyStatus === 'HISTORICAL_UPDATE_COMPLETE' ? 'COMPLETE'
        : update.historyStatus === 'NOT_READY' ? 'NOT_READY' : 'PROCESSING',
    } });
    if (fencedConnection.count !== 1) throw new Error('Connection changed before publication.');

    for (const snapshot of inventory) {
      const source = await tx.accountSource.findUnique({ where: { connectionId_externalAccountId: {
        connectionId: connection.id, externalAccountId: snapshot.externalAccountId,
      } }, include: { account: true } });
      if (!source || source.status !== 'ACTIVE' || source.account.ingestionState !== 'ACTIVE' || source.account.candidateSourceId) continue;
      const usable = snapshot.currency === source.account.currency && snapshot.currentBalance !== null && snapshot.balanceObservedAt !== null;
      const locked = await tx.account.updateMany({ where: { id: source.accountId, ingestionState: 'ACTIVE', candidateSourceId: null },
        data: usable ? { balance: snapshot.currentBalance!, availableBalance: snapshot.availableBalance, balanceDate: snapshot.balanceObservedAt! }
          : { updatedAt: now } });
      if (locked.count !== 1) throw new Error('Account changed before publication.');
      await tx.accountSource.update({ where: { id: source.id }, data: {
        balanceStale: !usable, balanceObservedAt: usable ? snapshot.balanceObservedAt : source.balanceObservedAt,
        availableBalance: usable ? snapshot.availableBalance : source.availableBalance,
      } });
    }

    const batch = await tx.syncBatch.create({ data: {
      connectionId: connection.id, jobId: job.id, cursorStart: connection.transactionCursor ?? '',
      cursorEnd: update.cursor, status: 'PUBLISHED', attempt: job.attempts, publishedAt: now,
      addedCount: update.changes.filter((c) => c.changeType === 'ADDED').length,
      modifiedCount: update.changes.filter((c) => c.changeType === 'MODIFIED').length,
      removedCount: update.changes.filter((c) => c.changeType === 'REMOVED').length,
    } });
    await applyChanges(tx, connection.id, batch.id, update.changes);
    await resolveReplays(tx, connection.id, connection.transactionCursor, now);
    await enqueueBankSync(prisma, { jobType: 'CATEGORIZE', trigger: 'SCHEDULED' }, tx);
    await tx.syncJob.update({ where: { id: job.id }, data: {
      fetchedCount: update.changes.length,
      addedCount: update.changes.filter((c) => c.changeType === 'ADDED').length,
      modifiedCount: update.changes.filter((c) => c.changeType === 'MODIFIED').length,
      removedCount: update.changes.filter((c) => c.changeType === 'REMOVED').length,
    } });
  }, { timeout: 120000 }); }
  catch (error) { annotateQuarantine(error, connection.transactionCursor, connection.version); throw error; }
}

function annotateQuarantine(error: unknown, cursor: string | null, version: number): void {
  if (error instanceof QuarantinedProviderRecord) { error.cursorStart = cursor; error.connectionVersion = version; }
}

function validateAccountCurrency(change: NormalizedTransactionChange, expected: string): void {
  try {
    if (validateCurrency(change.currency) !== expected.toUpperCase()) throw new NormalizationError('CURRENCY_INVALID', 'Transaction currency differs from its account.');
  } catch (error) {
    if (error instanceof NormalizationError && change.sourceEvidence) throw new QuarantinedProviderRecord(error, change.sourceEvidence);
    throw error;
  }
}

async function resolveReplays(tx: Prisma.TransactionClient, connectionId: string, cursor: string | null, now: Date): Promise<void> {
  const open = await tx.quarantineItem.findMany({ where: { connectionId, status: 'REPLAYING' } });
  const ids = open.filter((item) => (item.sourcePayload as { cursorStart?: string | null }).cursorStart === cursor).map((item) => item.id);
  if (ids.length) await tx.quarantineItem.updateMany({ where: { id: { in: ids }, status: 'REPLAYING' }, data: {
    status: 'RESOLVED', resolvedAt: now, resolutionNote: 'The update was published or the provider supplied a newer version.',
  } });
}

async function publishApprovedBatch(job: SyncJob, connection: { id: string; version: number; transactionCursor: string | null }, batchId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const fencedJob = await tx.syncJob.updateMany({ where: { id: job.id, status: 'RUNNING', leaseOwner: job.leaseOwner,
      version: job.version, leaseExpiresAt: { gt: now } }, data: { heartbeatAt: now } });
    if (fencedJob.count !== 1) throw new Error('Sync lease expired before publication.');
    const batch = await tx.syncBatch.findFirst({ where: { id: batchId, connectionId: connection.id, status: 'STAGED' }, include: { items: { orderBy: { createdAt: 'asc' } } } });
    if (!batch || batch.cursorStart !== (connection.transactionCursor ?? '')) throw new Error('Approved review changed before publication.');
    const cases = await tx.reconciliationCase.findMany({ where: { connectionId: connection.id }, select: { id: true, status: true, manifest: true } });
    const related = cases.filter((item) => (item.manifest as { batchId?: string } | null)?.batchId === batch.id);
    if (!related.length || related.some((item) => item.status !== 'COMMITTED')) throw new Error('Review is not approved.');
    const fencedConnection = await tx.bankConnection.updateMany({ where: { id: connection.id, version: connection.version,
      pausedAt: null, status: { notIn: ['DISCONNECTED', 'AUTH_REQUIRED', 'CONSENT_REVOKED'] } }, data: { status: 'HEALTHY', healthDetail: null,
      transactionCursor: batch.cursorEnd, transactionCursorUpdatedAt: now, lastSuccessfulSyncAt: now,
      transactionsInitialState: 'COMPLETE', transactionsHistoryState: 'COMPLETE' } });
    if (fencedConnection.count !== 1) throw new Error('Connection changed before publication.');
    const changes = batch.items.map((item) => item.observedFacts as unknown as NormalizedTransactionChange);
    await applyChanges(tx, connection.id, batch.id, changes);
    for (const item of related) {
      // Older approvals lack the baseline needed for safe undo.
      const caseRow = await tx.reconciliationCase.findUniqueOrThrow({ where: { id: item.id } });
      if (!caseRow.accountSourceId) throw new Error('Review account is missing.');
      const source = await tx.accountSource.findUniqueOrThrow({ where: { id: caseRow.accountSourceId }, include: { account: true } });
      const sourceRows = await tx.transactionSource.findMany({ where: { accountSourceId: source.id }, orderBy: { id: 'asc' } });
      const transactions = await tx.transaction.findMany({ where: { id: { in: [...new Set(sourceRows.map((row) => row.transactionId))] } }, orderBy: { id: 'asc' } });
      await tx.reconciliationAudit.create({ data: { caseId: caseRow.id, action: 'FACTS_UPDATED', afterJson: {
        batchId: batch.id, account: accountFacts(source.account), sources: sourceRows.map(sourceFacts),
        transactions: transactions.map((row) => ({ facts: transactionFacts(row), annotations: transactionAnnotations(row) })),
      } as unknown as Prisma.InputJsonObject } });
    }
    await resolveReplays(tx, connection.id, connection.transactionCursor, now);
    await tx.syncBatch.update({ where: { id: batch.id }, data: { status: 'PUBLISHED', publishedAt: now } });
    await enqueueBankSync(prisma, { jobType: 'CATEGORIZE', trigger: 'SCHEDULED' }, tx);
    await tx.syncJob.update({ where: { id: job.id }, data: { rerunRequested: true, fetchedCount: changes.length,
      addedCount: changes.filter((change) => change.changeType === 'ADDED').length,
      modifiedCount: changes.filter((change) => change.changeType === 'MODIFIED').length,
      removedCount: changes.filter((change) => change.changeType === 'REMOVED').length } });
  }, { timeout: 120000 });
}

async function applyChanges(tx: Prisma.TransactionClient, connectionId: string, batchId: string, changes: NormalizedTransactionChange[]): Promise<void> {
  const pending = changes.filter((change) => change.changeType !== 'REMOVED' && change.providerStatus === 'PENDING');
  const posted = changes.filter((change) => change.changeType !== 'REMOVED' && change.providerStatus !== 'PENDING');
  const removed = changes.filter((change) => change.changeType === 'REMOVED');
  for (const change of pending) {
    const successor = posted.find((item) => item.externalAccountId === change.externalAccountId && item.pendingExternalId === change.externalTransactionId);
    const successorSource = successor ? await tx.transactionSource.findFirst({ where: { externalTransactionId: successor.externalTransactionId,
      accountSource: { connectionId, externalAccountId: change.externalAccountId } }, include: { accountSource: { include: { account: true } } } }) : null;
    if (!successorSource) { await applyChange(tx, connectionId, batchId, change); continue; }
    const source = successorSource.accountSource;
    validateAccountCurrency(change, source.account.currency);
    const locked = await tx.account.updateMany({ where: { id: source.accountId, ingestionState: 'ACTIVE', candidateSourceId: null }, data: { updatedAt: new Date() } });
    if (locked.count !== 1) throw new Error('Account changed before publication.');
    const previous = await tx.transactionSource.findUnique({ where: { accountSourceId_externalTransactionId: {
      accountSourceId: source.id, externalTransactionId: change.externalTransactionId,
    } } });
    if (previous && previous.transactionId !== successorSource.transactionId) throw new Error('Pending and posted provider identities require reconciliation.');
    if (!previous) await tx.transactionSource.create({ data: { accountSourceId: source.id, externalTransactionId: change.externalTransactionId,
      transactionId: successorSource.transactionId, observedFacts: change.observedFacts as unknown as Prisma.InputJsonObject, sourceBatchId: batchId } });
  }
  for (const change of [...posted, ...removed]) await applyChange(tx, connectionId, batchId, change);
  const sourceRows = await tx.transactionSource.findMany({ where: { accountSource: { connectionId },
    externalTransactionId: { in: changes.map((change) => change.externalTransactionId) } }, select: { transactionId: true } });
  await reconcileLoanTransactions(tx, sourceRows.map((source) => source.transactionId));
}

export async function refreshConnection(job: SyncJob): Promise<void> {
  if (!job.connectionId) throw new Error('Bank refresh job has no connection.');
  const connection = await prisma.bankConnection.findUnique({ where: { id: job.connectionId } });
  const config = loadBankConfig();
  const expectedEnvironment = config.plaid.env === 'production' ? 'PRODUCTION' : config.plaid.env === 'sandbox' ? 'SANDBOX' : null;
  if (!config.plaid.refreshEnabled || !connection || ['DISCONNECTED', 'AUTH_REQUIRED', 'CONSENT_REVOKED'].includes(connection.status) || connection.pausedAt ||
      connection.environment !== expectedEnvironment || !config.encryption.keyMaterial || connection.tokenKeyVersion !== config.encryption.keyVersion ||
      !connection.tokenCiphertext || !connection.tokenNonce || !connection.tokenAuthTag) {
    throw new Error('Connection is unavailable or bank refresh is disabled.');
  }
  const token = decryptSecret({ ciphertext: connection.tokenCiphertext, nonce: connection.tokenNonce,
    authTag: connection.tokenAuthTag, keyVersion: connection.tokenKeyVersion }, config.encryption.keyMaterial,
    { provider: 'PLAID', environment: connection.environment, externalItemId: connection.externalItemId });
  const result = await new PlaidProvider({ settings: config.plaid }).refreshTransactions(token);
  if (!result.refreshed) throw new Error('Bank refresh is temporarily rate limited.');
}

async function applyChange(tx: Prisma.TransactionClient, connectionId: string, batchId: string, change: NormalizedTransactionChange): Promise<void> {
  const existing = await tx.transactionSource.findFirst({ where: {
    externalTransactionId: change.externalTransactionId,
    accountSource: { connectionId, ...(change.externalAccountId ? { externalAccountId: change.externalAccountId } : {}) },
  }, include: { accountSource: { include: { account: true } }, transaction: true } });
  if (change.changeType === 'REMOVED') {
    if (!existing || existing.status === 'REMOVED') return;
    const locked = await tx.account.updateMany({ where: { id: existing.accountSource.accountId, ingestionState: 'ACTIVE', candidateSourceId: null },
      data: { updatedAt: new Date() } });
    if (locked.count !== 1) throw new Error('Account migration requires reconciliation before import.');
    await tx.transactionSource.update({ where: { id: existing.id }, data: { status: 'REMOVED', sourceBatchId: batchId } });
    // Historical aliases from another provider do not override a removal by
    // the account's current authoritative source. A pending/posted alias on
    // this same source may still keep the canonical transaction active.
    const otherActive = await tx.transactionSource.count({ where: {
      transactionId: existing.transactionId, accountSourceId: existing.accountSourceId, status: 'ACTIVE',
    } });
    if (otherActive === 0) await tx.transaction.update({ where: { id: existing.transactionId }, data: { status: 'REMOVED' } });
    return;
  }
  const source = await tx.accountSource.findUnique({ where: { connectionId_externalAccountId: {
    connectionId, externalAccountId: change.externalAccountId,
  } }, include: { account: true } });
  if (!source || source.status !== 'ACTIVE') throw new Error('Map all bank accounts before importing their transactions.');
  if (source.account.ingestionState !== 'ACTIVE' || source.account.candidateSourceId !== null) {
    throw new Error('Account migration requires reconciliation before import.');
  }
  // Lock the account and recheck its state so a concurrent cutover cannot race publication.
  const protectedAccount = await tx.account.updateMany({ where: {
    id: source.accountId, ingestionState: 'ACTIVE', candidateSourceId: null,
  }, data: { updatedAt: new Date() } });
  if (protectedAccount.count !== 1) throw new Error('Account changed before publication.');
  validateAccountCurrency(change, source.account.currency);
  const currency = validateCurrency(change.currency);
  const predecessor = change.pendingExternalId ? await tx.transactionSource.findUnique({ where: {
    accountSourceId_externalTransactionId: { accountSourceId: source.id, externalTransactionId: change.pendingExternalId },
  } }) : null;
  if (existing && predecessor && existing.transactionId !== predecessor.transactionId) {
    throw new Error('Pending and posted provider identities require reconciliation.');
  }
  const transactionId = existing?.transactionId ?? predecessor?.transactionId;
  const facts = { amount: change.amount, posted: dateOnlyToUtcStorage(change.postedDate),
    authorizedDate: change.authorizedDate ? dateOnlyToUtcStorage(change.authorizedDate) : null,
    description: change.observedFacts.description || 'Transaction', payee: change.observedFacts.payee,
    memo: change.observedFacts.memo, isoCurrencyCode: currency,
    status: change.providerStatus === 'PENDING' ? 'PENDING' as const : 'POSTED' as const };
  const canonical = transactionId
    ? await tx.transaction.update({ where: { id: transactionId }, data: facts })
    : await tx.transaction.create({ data: { ...facts, accountId: source.accountId, externalId: `plaid-local:${randomUUID()}` } });
  if (predecessor) await tx.transactionSource.update({ where: { id: predecessor.id }, data: { status: 'REMOVED' } });
  const observedFacts = change.observedFacts as unknown as Prisma.InputJsonObject;
  await tx.transactionSource.upsert({ where: { accountSourceId_externalTransactionId: {
    accountSourceId: source.id, externalTransactionId: change.externalTransactionId,
  } }, create: { accountSourceId: source.id, externalTransactionId: change.externalTransactionId,
    transactionId: canonical.id, observedFacts, pendingExternalId: change.pendingExternalId,
    pendingTransactionSourceId: predecessor?.id, sourceBatchId: batchId },
  update: { observedFacts, status: 'ACTIVE', pendingExternalId: change.pendingExternalId,
    pendingTransactionSourceId: predecessor?.id, sourceBatchId: batchId } });
}
