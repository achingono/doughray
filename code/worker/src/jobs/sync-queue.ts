import { randomUUID } from 'node:crypto';
import { Prisma, type SyncJob } from '@prisma/client';
import { BankProviderErrorKind, NormalizationError, QuarantinedProviderRecord, enqueueBankSync, lockSyncQueue } from '@doughray/shared';
import prisma from '../lib/prisma';
import { importTransactions } from './import-transactions';
import { backfillTransactions } from './backfill-transactions';
import { categorizeTransactions } from './categorize-transactions';
import { refreshConnection, syncConnection } from './sync-connection';

const workerId = randomUUID();
const LEASE_MS = 5 * 60 * 1000;

export async function claimNextSyncJob(): Promise<SyncJob | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "SyncJob"
      WHERE (status = 'QUEUED' AND "nextRunAt" <= NOW())
         OR (status = 'RUNNING' AND "leaseExpiresAt" < NOW())
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    return tx.syncJob.update({ where: { id: rows[0].id }, data: {
      status: 'RUNNING', leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      heartbeatAt: new Date(), startedAt: new Date(), attempts: { increment: 1 }, version: { increment: 1 },
    } });
  });
}

export async function processNextSyncJob(): Promise<boolean> {
  const job = await claimNextSyncJob();
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void prisma.syncJob.updateMany({ where: { id: job.id, status: 'RUNNING', leaseOwner: workerId, version: job.version },
      data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      .catch(() => undefined);
  }, 30000);
  let failure: unknown;
  try {
    switch (job.jobType) {
      case 'SIMPLEFIN_IMPORT': await importTransactions(); break;
      case 'SIMPLEFIN_BACKFILL': await backfillTransactions(); break;
      case 'CONNECTION_SYNC': await syncConnection(job); break;
      case 'BANK_REFRESH': await refreshConnection(job); break;
      case 'CATEGORIZE': await categorizeTransactions(); break;
      default: throw new Error(`Unsupported sync job type: ${job.jobType}`);
    }
  } catch (error) { failure = error; }
  finally { clearInterval(heartbeat); }

  await prisma.$transaction(async (tx) => {
    await lockSyncQueue(tx, job.jobType, job.connectionId);
    const current = await tx.syncJob.findUnique({ where: { id: job.id } });
    if (!current || current.status !== 'RUNNING' || current.leaseOwner !== workerId || current.version !== job.version) return;
    if (failure) {
      const providerError = failure as { kind?: string; providerCode?: string; requestId?: string; retriable?: boolean };
      const blocked = failure instanceof NormalizationError || (providerError.kind && !providerError.retriable &&
        providerError.kind !== BankProviderErrorKind.MUTATION_DURING_PAGINATION);
      const retry = !blocked && current.attempts < current.maxAttempts;
      const safeMessage = failure instanceof NormalizationError ? `Invalid provider data: ${failure.reason}`
        : providerError.providerCode ? `Provider error: ${providerError.providerCode}`
          : failure instanceof Error && /^(Map all bank accounts|Account migration|Connection is unavailable|Connection environment)/.test(failure.message)
            ? failure.message : 'Sync failed; check connection and retry.';
      if (failure instanceof QuarantinedProviderRecord && job.connectionId) {
        const connection = await tx.bankConnection.findUnique({ where: { id: job.connectionId } });
        if (connection && connection.version === failure.connectionVersion && connection.transactionCursor === failure.cursorStart) {
          const items = await tx.quarantineItem.findMany({ where: { connectionId: job.connectionId, status: { in: ['OPEN', 'REPLAYING'] } } });
          const prior = items.find((item) => {
            const payload = item.sourcePayload as { fingerprint?: string; cursorStart?: string | null };
            return payload.fingerprint === failure.evidence.fingerprint && payload.cursorStart === failure.cursorStart;
          });
          if (prior) await tx.quarantineItem.update({ where: { id: prior.id }, data: { status: 'OPEN', reason: failure.reason } });
          else await tx.quarantineItem.create({ data: { connectionId: job.connectionId,
            externalTransactionId: typeof failure.evidence.record.transaction_id === 'string' ? failure.evidence.record.transaction_id : null,
            reason: failure.reason, sourcePayload: { ...failure.evidence, cursorStart: failure.cursorStart,
              connectionVersion: failure.connectionVersion, ruleVersion: failure.ruleVersion } as Prisma.InputJsonObject } });
        }
      }
      await tx.syncJob.update({ where: { id: job.id }, data: {
        status: retry ? 'QUEUED' : 'FAILED', nextRunAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** current.attempts)),
        errorMessage: safeMessage, requestId: providerError.requestId ?? null,
        completedAt: retry ? null : new Date(), leaseOwner: null, leaseExpiresAt: null,
        quarantinedCount: failure instanceof QuarantinedProviderRecord ? 1 : 0,
      } });
      if (job.connectionId) {
        const health = providerError.kind === BankProviderErrorKind.AUTH_REQUIRED || providerError.kind === BankProviderErrorKind.CONSENT_REVOKED
          ? 'AUTH_REQUIRED' as const : undefined;
        // A stale worker must not overwrite a revocation or disconnect reported
        // while its provider request was in flight.
        await tx.bankConnection.updateMany({ where: { id: job.connectionId,
          status: { notIn: ['DISCONNECTED', 'AUTH_REQUIRED', 'CONSENT_REVOKED'] } }, data: {
          status: health, version: health ? { increment: 1 } : undefined, healthDetail: safeMessage, lastErrorAt: new Date(),
          lastErrorCode: providerError.providerCode ?? null, lastErrorMessage: safeMessage,
        } });
      }
      return;
    }
    if (current.rerunRequested) {
      await tx.syncJob.update({ where: { id: job.id }, data: {
        status: 'QUEUED', rerunRequested: false, attempts: 0, nextRunAt: new Date(),
        leaseOwner: null, leaseExpiresAt: null, errorMessage: null,
      } });
    } else {
      await tx.syncJob.update({ where: { id: job.id }, data: {
        status: 'SUCCEEDED', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, errorMessage: null,
      } });
    }
  });
  if (!failure && job.jobType === 'SIMPLEFIN_IMPORT') {
    await enqueueBankSync(prisma, { jobType: 'CATEGORIZE', trigger: 'SCHEDULED' });
  }
  if (!failure && job.jobType === 'BANK_REFRESH' && job.connectionId) {
    await enqueueBankSync(prisma, { jobType: 'CONNECTION_SYNC', trigger: 'SCHEDULED', connectionId: job.connectionId });
  }
  return true;
}

export function startSyncQueue(): void {
  let working = false;
  const tick = async () => {
    if (working) return;
    working = true;
    try { while (await processNextSyncJob()) { /* drain available jobs */ } }
    catch (error) { console.error('[SyncQueue] Worker failed:', error instanceof Error ? error.message : 'unknown error'); }
    finally { working = false; }
  };
  void tick();
  setInterval(() => { void tick(); }, 2000);
}
