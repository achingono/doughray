import { Prisma } from '@prisma/client';
import { accountFacts, transactionFacts, transactionAnnotations, sourceFacts, dateOnlyToUtcStorage, lockSyncQueue, type NormalizedTransactionChange } from '@doughray/shared';
import { isDeepStrictEqual } from 'node:util';
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
    include: { candidates: { orderBy: { createdAt: 'asc' } }, decisions: { where: { appliedAt: null, undoneAt: null } } }, orderBy: { createdAt: 'asc' } });
  const selected = cases.filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batch.id);
  if (!selected.length) return null;
  const sourceIds = selected.map((item) => item.accountSourceId).filter((id): id is string => !!id);
  const sources = await prisma.accountSource.findMany({ where: { id: { in: sourceIds } }, include: { account: { select: { id: true, name: true } } } });
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  return { batchId: batch.id, stagedAt: batch.stagedAt, draftVersion: selected[0].version, cases: selected.map((item) => ({
    id: item.id, accountName: item.accountSourceId ? sourcesById.get(item.accountSourceId)?.account.name ?? 'Account' : 'Account',
    candidates: item.candidates.map((candidate) => ({ id: candidate.id, evidence: candidate.evidence as unknown as Evidence })),
    draft: item.decisions.filter((decision) => decision.candidateId && (decision.action === 'SAME_TRANSACTION' || decision.action === 'NEW_TRANSACTION'))
      .map((decision) => ({ candidateId: decision.candidateId!, action: decision.action, transactionId: decision.primaryTransactionId })),
  })) };
}

/** Save an incomplete review with optimistic concurrency and without switching providers. */
export async function saveMigrationDraft(connectionId: string, batchId: string, version: number, decisions: MigrationDecision[]) {
  return prisma.$transaction(async (tx) => {
    await lockSyncQueue(tx, 'CONNECTION_SYNC', connectionId);
    await tx.$queryRaw`SELECT id FROM "SyncJob" WHERE "connectionId" = ${connectionId}
      AND "jobType" = 'CONNECTION_SYNC' AND status IN ('QUEUED', 'RUNNING') ORDER BY id FOR UPDATE`;
    const batch = await tx.syncBatch.findFirst({ where: { id: batchId, connectionId, status: 'STAGED' } });
    if (!batch) throw new AppError(409, 'The review is no longer current.', 'REVIEW_STALE');
    const cases = (await tx.reconciliationCase.findMany({ where: { connectionId, status: 'OPEN' }, include: { candidates: true } }))
      .filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batch.id);
    if (!cases.length || cases.some((item) => item.version !== version)) throw new AppError(409, 'The draft changed; reopen the review before saving.', 'DRAFT_STALE');
    const connection = await tx.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    if (connection.pausedAt || (connection.transactionCursor ?? '') !== batch.cursorStart ||
        cases.some((item) => (item.manifest as unknown as Manifest).connectionVersion !== connection.version)) {
      throw new AppError(409, 'The connection changed; refresh the review.', 'REVIEW_STALE');
    }
    const candidates = new Map(cases.flatMap((item) => item.candidates).map((candidate) => [candidate.id, candidate]));
    const seen = new Set<string>();
    const matched = new Set<string>();
    for (const decision of decisions) {
      const candidate = candidates.get(decision.candidateId);
      if (!candidate || seen.has(decision.candidateId)) throw new AppError(400, 'Invalid draft transaction.', 'INVALID_DRAFT');
      seen.add(decision.candidateId);
      if (decision.action === 'SAME_TRANSACTION') {
        const evidence = candidate.evidence as unknown as Evidence;
        if (!decision.transactionId || matched.has(decision.transactionId) || !evidence.candidates.some((item) => item.id === decision.transactionId)) {
          throw new AppError(400, 'Choose a distinct suggested match for each transaction.', 'INVALID_MATCH');
        }
        matched.add(decision.transactionId);
      } else if (decision.transactionId) throw new AppError(400, 'New transactions cannot have a match.', 'INVALID_DRAFT');
    }
    const caseIds = cases.map((item) => item.id);
    await tx.reconciliationDecision.deleteMany({ where: { caseId: { in: caseIds }, appliedAt: null } });
    if (decisions.length) await tx.reconciliationDecision.createMany({ data: decisions.map((decision) => ({
      caseId: candidates.get(decision.candidateId)!.caseId, candidateId: decision.candidateId,
      action: decision.action, primaryTransactionId: decision.transactionId ?? null,
    })) });
    await tx.reconciliationCase.updateMany({ where: { id: { in: caseIds }, version }, data: { version: { increment: 1 } } });
    return { draftVersion: version + 1 };
  }, { timeout: 120000 });
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
    const baseline = new Map<string, { account: ReturnType<typeof accountFacts>; matched: Array<ReturnType<typeof transactionFacts>> }>();
    await tx.reconciliationDecision.deleteMany({ where: { caseId: { in: cases.map((item) => item.id) }, appliedAt: null } });
    // Lock the connection first; every concurrent sync is fenced by its version.
    const guarded = await tx.bankConnection.updateMany({ where: { id: connectionId, version: connection.version, pausedAt: null },
      data: { version: { increment: 1 }, healthDetail: 'Reconciliation approved; import is queued.' } });
    if (guarded.count !== 1) throw new AppError(409, 'The connection changed; refresh the review.', 'REVIEW_STALE');
    for (const item of cases) {
      if (!item.accountSourceId) throw new AppError(409, 'Review account is missing.', 'REVIEW_STALE');
      const source = await tx.accountSource.findUniqueOrThrow({ where: { id: item.accountSourceId } });
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${source.accountId} FOR UPDATE`;
      const account = await tx.account.findUniqueOrThrow({ where: { id: source.accountId } });
      baseline.set(item.id, { account: accountFacts(account), matched: [] });
    }

    for (const candidate of candidates) {
      const decision = byId.get(candidate.id)!;
      const evidence = candidate.evidence as unknown as Evidence;
      if (!candidate.accountSourceId || !candidate.plaidTransactionExternalId) throw new AppError(409, 'Review data is incomplete.', 'REVIEW_STALE');
      let transactionId: string | null = null;
      if (decision.action === 'SAME_TRANSACTION') {
        if (!decision.transactionId || matchedIds.has(decision.transactionId) || !evidence.candidates.some((item) => item.id === decision.transactionId)) {
          throw new AppError(400, 'Choose a distinct suggested match for each transaction.', 'INVALID_MATCH');
        }
        await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${decision.transactionId} FOR UPDATE`;
        const current = await tx.transaction.findUnique({ where: { id: decision.transactionId } });
        const account = await tx.account.findUniqueOrThrow({ where: { id: candidate.accountId }, select: { currency: true } });
        const date = dateOnlyToUtcStorage(evidence.change.postedDate);
        const original = evidence.candidates.find((item) => item.id === decision.transactionId)!;
        if (!current || current.accountId !== candidate.accountId || current.status !== 'POSTED' ||
            account.currency.toUpperCase() !== evidence.change.currency.toUpperCase() ||
            (current.isoCurrencyCode !== null && current.isoCurrencyCode.toUpperCase() !== account.currency.toUpperCase()) ||
            !current.amount.equals(evidence.change.amount) ||
            !current.amount.equals(original.amount) || current.posted.getTime() !== new Date(original.posted).getTime() ||
            Math.abs(current.posted.getTime() - date.getTime()) > 3 * 86400000) {
          throw new AppError(409, 'A matching transaction changed; refresh the review.', 'REVIEW_STALE');
        }
        matchedIds.add(current.id);
        baseline.get(candidate.caseId)!.matched.push(transactionFacts(current));
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
        beforeJson: baseline.get(item.id)! as unknown as Prisma.InputJsonObject,
        afterJson: { batchId, decisionCount: item.candidates.length } } });
    }
    // The worker publishes the approved snapshot and its cursor atomically,
    // then fetches changes that occurred while the review was open.
    await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId, payload: { reason: 'RECONCILIATION_APPROVED' } }, tx);
    return { approved: candidates.length };
  }, { timeout: 120000 });
}

type UndoBaseline = { account: ReturnType<typeof accountFacts>; matched: Array<ReturnType<typeof transactionFacts>> };
type UndoPublished = { batchId: string; account: ReturnType<typeof accountFacts>; sources: Array<ReturnType<typeof sourceFacts>>;
  transactions: Array<{ facts: ReturnType<typeof transactionFacts>; annotations: ReturnType<typeof transactionAnnotations> }> };

export async function getUndoableMigration(connectionId: string) {
  const cases = await prisma.reconciliationCase.findMany({ where: { connectionId, status: 'COMMITTED' },
    include: { audits: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } });
  const selected = cases.find((item) => item.audits.some((audit) => audit.action === 'PLAN_APPLIED' && audit.beforeJson) &&
    item.audits.some((audit) => audit.action === 'FACTS_UPDATED' && audit.afterJson));
  if (!selected) return null;
  const batchId = (selected.manifest as unknown as Manifest).batchId;
  return { batchId, accounts: cases.filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batchId).length };
}

/** Undo only while provider facts and newly imported annotations still match the published journal. */
export async function undoMigrationReview(connectionId: string, batchId: string) {
  return prisma.$transaction(async (tx) => {
    await lockSyncQueue(tx, 'CONNECTION_SYNC', connectionId);
    await tx.$queryRaw`SELECT id FROM "SyncJob" WHERE "connectionId" = ${connectionId}
      AND "jobType" = 'CONNECTION_SYNC' AND status IN ('QUEUED', 'RUNNING') ORDER BY id FOR UPDATE`;
    const batch = await tx.syncBatch.findFirst({ where: { id: batchId, connectionId, status: 'PUBLISHED' } });
    if (!batch) throw new AppError(409, 'This switch is not available to undo.', 'UNDO_UNAVAILABLE');
    const cases = (await tx.reconciliationCase.findMany({ where: { connectionId, status: 'COMMITTED' }, include: { audits: true }, orderBy: { accountSourceId: 'asc' } }))
      .filter((item) => (item.manifest as unknown as Manifest | null)?.batchId === batchId);
    if (!cases.length) throw new AppError(409, 'This switch was already undone or has no undo journal.', 'UNDO_UNAVAILABLE');
    const connection = await tx.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const fenced = await tx.bankConnection.updateMany({ where: { id: connectionId, version: connection.version },
      data: { version: { increment: 1 }, healthDetail: 'Account switch undone; its Plaid source is paused.' } });
    if (fenced.count !== 1) throw new AppError(409, 'The connection changed; try again.', 'UNDO_CONFLICT');
    for (const item of cases) {
      const before = item.audits.find((audit) => audit.action === 'PLAN_APPLIED')?.beforeJson as unknown as UndoBaseline | null;
      const after = item.audits.find((audit) => audit.action === 'FACTS_UPDATED')?.afterJson as unknown as UndoPublished | null;
      if (!before?.account || !Array.isArray(before.matched) || !after?.account || !Array.isArray(after.sources) ||
          !Array.isArray(after.transactions) || after.batchId !== batchId || !item.accountSourceId) {
        throw new AppError(409, 'This switch does not have a complete undo journal.', 'UNDO_UNAVAILABLE');
      }
      const source = await tx.accountSource.findUniqueOrThrow({ where: { id: item.accountSourceId } });
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${source.accountId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "TransactionSource" WHERE "accountSourceId" = ${source.id} ORDER BY id FOR UPDATE`;
      const sourceRows = await tx.transactionSource.findMany({ where: { accountSourceId: source.id }, orderBy: { id: 'asc' } });
      const transactionIds = [...new Set(sourceRows.map((row) => row.transactionId))].sort();
      if (transactionIds.length) await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id IN (${Prisma.join(transactionIds)}) ORDER BY id FOR UPDATE`;
      const account = await tx.account.findUniqueOrThrow({ where: { id: source.accountId } });
      const transactions = await tx.transaction.findMany({ where: { id: { in: transactionIds } }, orderBy: { id: 'asc' } });
      if (source.status !== 'ACTIVE' || account.ingestionState !== 'ACTIVE' || account.candidateSourceId ||
          !isDeepStrictEqual(accountFacts(account), after.account) || !isDeepStrictEqual(sourceRows.map(sourceFacts), after.sources) ||
          transactions.length !== after.transactions.length) {
        throw new AppError(409, 'The bank or account changed after the switch; review those changes before undoing.', 'UNDO_CONFLICT');
      }
      const beforeById = new Map(before.matched.map((facts) => [facts.id, facts]));
      const afterById = new Map(after.transactions.map((row) => [row.facts.id, row]));
      for (const current of transactions) {
        const published = afterById.get(current.id);
        if (!published || !isDeepStrictEqual(transactionFacts(current), published.facts)) {
          throw new AppError(409, 'A transaction changed after the switch; review it before undoing.', 'UNDO_CONFLICT');
        }
        if (!beforeById.has(current.id) && !isDeepStrictEqual(transactionAnnotations(current), published.annotations)) {
          throw new AppError(409, 'A new transaction was categorized or reviewed after the switch; review it before undoing.', 'UNDO_CONFLICT');
        }
        const otherSources = await tx.transactionSource.count({ where: { transactionId: current.id, accountSourceId: { not: source.id } } });
        const linkedLoans = await tx.loanTransaction.count({ where: { sourceTransactionId: current.id } });
        if (otherSources || linkedLoans) throw new AppError(409, 'A transaction has additional links that require review before undoing.', 'UNDO_CONFLICT');
      }
      await tx.transactionSource.updateMany({ where: { accountSourceId: source.id }, data: { status: 'REMOVED' } });
      for (const current of transactions) {
        const original = beforeById.get(current.id);
        if (original) await tx.transaction.update({ where: { id: current.id }, data: {
          posted: new Date(original.posted), amount: original.amount, description: original.description,
          payee: original.payee, memo: original.memo, status: original.status,
          authorizedDate: original.authorizedDate ? new Date(original.authorizedDate) : null,
          isoCurrencyCode: original.isoCurrencyCode, replacementTransactionId: original.replacementTransactionId,
        } });
        else await tx.transaction.update({ where: { id: current.id }, data: { status: 'REMOVED' } });
      }
      await tx.accountSource.update({ where: { id: source.id }, data: { status: 'PAUSED' } });
      await tx.account.update({ where: { id: account.id }, data: { ingestionState: 'ACTIVE', candidateSourceId: null,
        balance: before.account.balance, availableBalance: before.account.availableBalance, balanceDate: new Date(before.account.balanceDate) } });
      await tx.reconciliationDecision.updateMany({ where: { caseId: item.id, appliedAt: { not: null } }, data: { undoneAt: new Date(), undoneBy: 'owner' } });
      await tx.reconciliationCase.update({ where: { id: item.id }, data: { status: 'UNDONE', version: { increment: 1 } } });
      await tx.reconciliationAudit.create({ data: { caseId: item.id, action: 'UNDONE', afterJson: { batchId, accountId: account.id } } });
    }
    return { accounts: cases.length };
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
