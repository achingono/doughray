import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error-handler';
import { Prisma, type SyncJob, type SyncJobTrigger, type SyncJobType } from '@prisma/client';
import { enqueueBankSync } from '@doughray/shared';

/**
 * Durable sync-work enqueueing backed by the SyncJob table.
 *
 * The API persists work and returns 202; the worker claims jobs with database
 * leases. Requests are coalesced per connection so a webhook, cron/manual
 * burst, or startup trigger never creates an unbounded job pile-up.
 */

export interface EnqueueSyncJobInput {
  jobType: SyncJobType;
  trigger: SyncJobTrigger;
  connectionId?: string | null;
  payload?: Prisma.InputJsonObject;
}

export interface EnqueueSyncJobResult {
  jobId: string;
  coalesced: boolean;
}

export async function enqueueSyncJob(input: EnqueueSyncJobInput, transaction?: Prisma.TransactionClient): Promise<EnqueueSyncJobResult> {
  return enqueueBankSync(prisma, input, transaction);
}

export interface SyncJobDto {
  id: string;
  jobType: string;
  trigger: string;
  connectionId: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  rerunRequested: boolean;
  counts: {
    fetched: number;
    added: number;
    modified: number;
    removed: number;
    matched: number;
    quarantined: number;
  };
  errorMessage: string | null;
  requestId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export function toSyncJobDto(job: SyncJob): SyncJobDto {
  return {
    id: job.id,
    jobType: job.jobType,
    trigger: job.trigger,
    connectionId: job.connectionId,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt ? job.nextRunAt.toISOString() : null,
    rerunRequested: job.rerunRequested,
    counts: {
      fetched: job.fetchedCount,
      added: job.addedCount,
      modified: job.modifiedCount,
      removed: job.removedCount,
      matched: job.matchedCount,
      quarantined: job.quarantinedCount,
    },
    errorMessage: job.errorMessage,
    requestId: job.requestId,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
  };
}

export async function getSyncJobOrThrow(id: string): Promise<SyncJob> {
  const job = await prisma.syncJob.findUnique({ where: { id } });
  if (!job) {
    throw new AppError(404, 'Sync job not found.', 'NOT_FOUND');
  }
  return job;
}
