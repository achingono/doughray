import { Prisma, SyncJobStatus, type PrismaClient, type SyncJobTrigger, type SyncJobType } from '@prisma/client';

export interface SyncJobRequest {
  jobType: SyncJobType;
  trigger: SyncJobTrigger;
  connectionId?: string | null;
  payload?: Prisma.InputJsonObject;
}

export function syncQueueKey(jobType: SyncJobType, connectionId: string | null): string {
  return `sync:${jobType}:${connectionId ?? 'global'}`;
}

export async function lockSyncQueue(tx: Prisma.TransactionClient, jobType: SyncJobType, connectionId: string | null): Promise<void> {
  const key = syncQueueKey(jobType, connectionId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Submit/coalesce one job under a transaction-scoped lock shared with completion. */
export async function enqueueBankSync(prisma: PrismaClient, input: SyncJobRequest, transaction?: Prisma.TransactionClient): Promise<{ jobId: string; coalesced: boolean }> {
  if (!transaction) return prisma.$transaction((tx) => enqueueBankSync(prisma, input, tx));
  const connectionId = input.connectionId ?? null;
  await lockSyncQueue(transaction, input.jobType, connectionId);
  const active = await transaction.syncJob.findFirst({
    where: { jobType: input.jobType, connectionId, status: { in: [SyncJobStatus.QUEUED, SyncJobStatus.RUNNING] } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) {
    if (active.status === SyncJobStatus.RUNNING) {
      await transaction.syncJob.update({ where: { id: active.id }, data: { rerunRequested: true } });
    }
    return { jobId: active.id, coalesced: true };
  }
  const created = await transaction.syncJob.create({ data: {
    jobType: input.jobType, trigger: input.trigger, connectionId, payload: input.payload,
  } });
  return { jobId: created.id, coalesced: false };
}
