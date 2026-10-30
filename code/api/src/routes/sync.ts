import { Router } from 'express';
import { AppError } from '../middleware/error-handler';
import { getLatestSync, getSyncHistory } from '../services/sync.service';
import { enqueueSyncJob, getSyncJobOrThrow, toSyncJobDto } from '../services/sync-queue.service';
import { prisma } from '../lib/prisma';

const router = Router();

// SimpleFin sync history compatibility (legacy SyncLog table).
// NOTE: mounted behind requireOwnerSession() in index.ts — no per-route guards.
router.get('/status', async (_req, res, next) => {
  try {
    const latest = await getLatestSync();
    res.json({ data: latest });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const raw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = Number.parseInt(raw as string, 10) || 10;
    const history = await getSyncHistory(Math.min(Math.max(limit, 1), 100));
    res.json({ data: history });
  } catch (err) {
    next(err);
  }
});

/**
 * Trigger the SimpleFin import job. Returns 202 with a persisted job ID;
 * the worker claims it through the leased queue.
 */
router.post('/trigger', async (_req, res, next) => {
  try {
    const job = await enqueueSyncJob({ jobType: 'SIMPLEFIN_IMPORT', trigger: 'MANUAL' });
    res.status(202).json({ data: { jobId: job.jobId, coalesced: job.coalesced, status: 'QUEUED' } });
  } catch (err) {
    next(err);
  }
});

/** Poll real progress/results for any persisted sync job. */
router.get('/jobs/:id', async (req, res, next) => {
  try {
    const job = await getSyncJobOrThrow(req.params.id);
    const batches = await prisma.syncBatch.findMany({
      where: { jobId: job.id },
      select: {
        id: true,
        status: true,
        addedCount: true,
        modifiedCount: true,
        removedCount: true,
        quarantinedCount: true,
        attempt: true,
        error: true,
        publishedAt: true,
      },
      orderBy: { attempt: 'desc' },
      take: 10,
    });
    res.json({
      data: {
        ...toSyncJobDto(job),
        batches: batches.map((batch) => ({
          ...batch,
          publishedAt: batch.publishedAt ? batch.publishedAt.toISOString() : null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
