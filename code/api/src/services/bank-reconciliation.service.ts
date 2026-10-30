import { Prisma } from '@prisma/client';
import { dateOnlyToUtcStorage, lockSyncQueue, type NormalizedTransactionChange } from '@doughray/shared';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error-handler';
import { enqueueSyncJob } from './sync-queue.service';

type Evidence = { change: NormalizedTransactionChange; candidates: Array<{ id: string; posted: string; amount: string; description: string; payee: string | null }> };
type Manifest = { batchId: string; connectionVersion: number };
export type MigrationDecision = { candidateId: string; action: 'SAME_TRANSACTION' | 'NEW_TRANSACTION'; transactionId?: string };

export async function getMigrationReview(connectionId: string) {
  const batch = await prisma.syncBatch.findFirst({ where: { connectionId, status: 'STAGED' }, orderBy: { stagedAt: 'desc' } });
  if (!batch) return null;
  const cases = await prisma.reconciliationCase.findMany({ where: { connectionId, status: 'OPEN' },
    include: { candidates: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  const selected = cases.filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batch.id);
  if (!selected.length) return null;
  const sourceIds = selected.map((item) => item.accountSourceId).filter((id): id is string => !!id);
  const sources = await prisma.accountSource.findMany({ where: { id: { in: sourceIds } }, include: { account: { select: { id: true, name: true } } } });
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  return { batchId: batch.id, stagedAt: batch.stagedAt, cases: selected.map((item) => ({
    id: item.id, accountName: item.accountSourceId ? sourcesById.get(item.accountSourceId)?.account.name ?? 'Account' : 'Account',
    candidates: item.candidates.map((candidate) => ({ id: candidate.id, evidence: candidate.evidence as unknown as Evidence })),
  })) };
}

export async function commitMigrationReview(connectionId: string, batchId: string, decisions: MigrationDecision[]) {
  return prisma.$transaction(async (tx) => {
    // The worker locks the job before the connection. Follow the same order
    // so a concurrent publication cannot deadlock the approval transaction.
    await lockSyncQueue(tx, 'CONNECTION_SYNC', connectionId);
    await tx.$queryRaw`SELECT id FROM "SyncJob" WHERE "connectionId" = ${connectionId}
      AND "jobType" = 'CONNECTION_SYNC' AND status IN ('QUEUED', 'RUNNING') ORDER BY id FOR UPDATE`;
    const batch = await tx.syncBatch.findFirst({ where: { id: batchId, connectionId, status: 'STAGED' } });
    if (!batch) throw new AppError(409, 'The review is no longer current.', 'REVIEW_STALE');
    const cases = (await tx.reconciliationCase.findMany({ where: { connectionId, status: 'OPEN' }, include: { candidates: true } }))
      .filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batch.id);
    if (!cases.length) throw new AppError(409, 'No open review exists for this batch.', 'REVIEW_STALE');
    const manifest = cases[0].manifest as unknown as Manifest;
    const connection = await tx.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    if ((connection.transactionCursor ?? '') !== batch.cursorStart || connection.version !== manifest.connectionVersion || connection.pausedAt) {
      throw new AppError(409, 'The connection changed; refresh the review.', 'REVIEW_STALE');
    }
    const candidates = cases.flatMap((item) => item.candidates);
    const byId = new Map(decisions.map((decision) => [decision.candidateId, decision]));
    if (byId.size !== decisions.length || byId.size !== candidates.length || candidates.some((candidate) => !byId.has(candidate.id))) {
      throw new AppError(400, 'Choose an action for every transaction.', 'INCOMPLETE_DECISIONS');
    }
    const matchedIds = new Set<string>();
    // Lock the connection first; every concurrent sync is fenced by its version.
    const guarded = await tx.bankConnection.updateMany({ where: { id: connectionId, version: connection.version, pausedAt: null },
      data: { version: { increment: 1 }, healthDetail: 'Reconciliation approved; import is queued.' } });
    if (guarded.count !== 1) throw new AppError(409, 'The connection changed; refresh the review.', 'REVIEW_STALE');

    for (const candidate of candidates) {
      const decision = byId.get(candidate.id)!;
      const evidence = candidate.evidence as unknown as Evidence;
      if (!candidate.accountSourceId || !candidate.plaidTransactionExternalId) throw new AppError(409, 'Review data is incomplete.', 'REVIEW_STALE');
      let transactionId: string | null = null;
      if (decision.action === 'SAME_TRANSACTION') {
        if (!decision.transactionId || matchedIds.has(decision.transactionId) || !evidence.candidates.some((item) => item.id === decision.transactionId)) {
          throw new AppError(400, 'Choose a distinct suggested match for each transaction.', 'INVALID_MATCH');
        }
        const current = await tx.transaction.findUnique({ where: { id: decision.transactionId } });
        const date = dateOnlyToUtcStorage(evidence.change.postedDate);
        const original = evidence.candidates.find((item) => item.id === decision.transactionId)!;
        if (!current || current.accountId !== candidate.accountId || current.status !== 'POSTED' ||
            !current.amount.equals(original.amount) || current.posted.getTime() !== new Date(original.posted).getTime() ||
            Math.abs(current.posted.getTime() - date.getTime()) > 3 * 86400000) {
          throw new AppError(409, 'A matching transaction changed; refresh the review.', 'REVIEW_STALE');
        }
        matchedIds.add(current.id);
        transactionId = current.id;
        await tx.transactionSource.create({ data: { accountSourceId: candidate.accountSourceId,
          externalTransactionId: candidate.plaidTransactionExternalId, transactionId,
          observedFacts: evidence.change.observedFacts as unknown as Prisma.InputJsonObject,
          pendingExternalId: evidence.change.pendingExternalId, sourceBatchId: batch.id } });
      }
      await tx.reconciliationDecision.create({ data: { caseId: candidate.caseId, candidateId: candidate.id,
        action: decision.action, primaryTransactionId: transactionId, appliedAt: new Date() } });
      await tx.reconciliationCandidate.update({ where: { id: candidate.id }, data: { decided: true } });
    }
    for (const item of cases) {
      if (!item.accountSourceId) throw new AppError(409, 'Review account is missing.', 'REVIEW_STALE');
      const account = await tx.accountSource.findUniqueOrThrow({ where: { id: item.accountSourceId }, select: { accountId: true } });
      const updated = await tx.account.updateMany({ where: { id: account.accountId, ingestionState: 'MIGRATING', candidateSourceId: item.accountSourceId },
        data: { ingestionState: 'ACTIVE', candidateSourceId: null } });
      if (updated.count !== 1) throw new AppError(409, 'Account mapping changed; refresh the review.', 'REVIEW_STALE');
      await tx.reconciliationCase.update({ where: { id: item.id }, data: { status: 'COMMITTED', version: { increment: 1 } } });
      await tx.reconciliationAudit.create({ data: { caseId: item.id, action: 'PLAN_APPLIED',
        afterJson: { batchId, decisionCount: item.candidates.length } } });
    }
    // The worker publishes the approved snapshot and its cursor atomically,
    // then fetches changes that occurred while the review was open.
    await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId, payload: { reason: 'RECONCILIATION_APPROVED' } }, tx);
    return { approved: candidates.length };
  }, { timeout: 120000 });
}

export async function discardMigrationReview(connectionId: string, batchId: string) {
  await prisma.$transaction(async (tx) => {
    // Serialize refresh with approval and publication using the same lock order.
    await lockSyncQueue(tx, 'CONNECTION_SYNC', connectionId);
    await tx.$queryRaw`SELECT id FROM "SyncJob" WHERE "connectionId" = ${connectionId}
      AND "jobType" = 'CONNECTION_SYNC' AND status IN ('QUEUED', 'RUNNING') ORDER BY id FOR UPDATE`;
    const batch = await tx.syncBatch.findFirst({ where: { id: batchId, connectionId, status: 'STAGED' } });
    if (!batch) throw new AppError(409, 'The review is no longer current.', 'REVIEW_STALE');
    const cases = await tx.reconciliationCase.findMany({ where: { connectionId, status: 'OPEN' } });
    const caseIds = cases.filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batch.id).map((item) => item.id);
    if (!caseIds.length) throw new AppError(409, 'The review has already been approved.', 'REVIEW_STALE');
    await tx.reconciliationCase.updateMany({ where: { id: { in: caseIds } }, data: { status: 'DISCARDED' } });
    await tx.syncBatch.update({ where: { id: batch.id }, data: { status: 'DISCARDED', error: 'Review refreshed by owner.' } });
    await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId, payload: { reason: 'RECONCILIATION_REFRESH' } }, tx);
  });
}
