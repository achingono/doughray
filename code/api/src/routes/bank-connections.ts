import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { lockSyncQueue, NORMALIZATION_VERSION } from '@doughray/shared';
import { AppError } from '../middleware/error-handler';
import { prisma } from '../lib/prisma';
import {
  applyAccountMappings,
  disconnectConnection,
  inventorySuggestions,
} from '../services/plaid-link.service';
import { getBankConnectionDto, listBankConnections } from '../services/bank-dto';
import { enqueueSyncJob } from '../services/sync-queue.service';
import { getBankConfig, getBankConfigStatus } from '../lib/bank-config';

const router = Router();

/**
 * Bank connection management. Safe DTOs only: provider ids are opaque and
 * access-token material never leaves the server.
 *
 * NOTE: mounted behind requireOwnerSession() in index.ts — no per-route guards
 * except where noted (none in this file).
 */

const ACCOUNT_MAPPING_SCHEMA = z.object({
  mappings: z.array(
    z.object({
      externalAccountId: z.string().min(1).max(256),
      action: z.enum(['MAP', 'CREATE', 'IGNORE']),
      accountId: z.string().min(1).max(64).nullish(),
      label: z.string().max(160).nullish(),
      type: z.string().max(32).nullish(),
    }),
  ).min(1).max(50),
});

router.get('/', async (_req, res, next) => {
  try {
    const [connections, config] = await Promise.all([
      listBankConnections(),
      Promise.resolve(getBankConfigStatus()),
    ]);
    res.json({ data: { connections, config } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json({ data: await getBankConnectionDto(req.params.id) });
  } catch (err) {
    next(err);
  }
});

/** Suggested mappings of provider accounts to local accounts (advisory). */
router.get('/:id/accounts', async (req, res, next) => {
  try {
    const suggestions = await inventorySuggestions(req.params.id);
    res.json({ data: suggestions });
  } catch (err) {
    next(err);
  }
});

const REPAIR_SCHEMA = z.object({ patch: z.object({
  amount: z.number().finite().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  name: z.string().min(1).max(512).optional(), iso_currency_code: z.string().regex(/^[A-Za-z]{3}$/).optional(),
}).strict() });

router.get('/:id/quarantine', async (req, res, next) => {
  try {
    await requireConnection(req.params.id);
    const rows = await prisma.quarantineItem.findMany({ where: { connectionId: req.params.id, status: { in: ['OPEN', 'REPLAYING'] } }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows.map((row) => ({ id: row.id, status: row.status, reason: row.reason, replayCount: row.replayCount,
      record: (row.sourcePayload as { record?: unknown }).record ?? null })) });
  } catch (error) { next(error); }
});

router.post('/:id/quarantine/:itemId/replay', async (req, res, next) => {
  try {
    const parsed = REPAIR_SCHEMA.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid repair values.', 'VALIDATION_ERROR');
    const result = await prisma.$transaction(async (tx) => {
      await lockSyncQueue(tx, 'CONNECTION_SYNC', req.params.id);
      await tx.$queryRaw`SELECT id FROM "SyncJob" WHERE "connectionId" = ${req.params.id}
        AND "jobType" = 'CONNECTION_SYNC' AND status IN ('QUEUED', 'RUNNING') ORDER BY id FOR UPDATE`;
      const item = await tx.quarantineItem.findFirst({ where: { id: req.params.itemId, connectionId: req.params.id, status: 'OPEN' } });
      if (!item) throw new AppError(409, 'The quarantine item is no longer available.', 'QUARANTINE_STALE');
      const connection = await tx.bankConnection.findUniqueOrThrow({ where: { id: req.params.id } });
      const payload = item.sourcePayload as { fingerprint?: string; cursorStart?: string | null; ruleVersion?: number };
      if (!payload.fingerprint || payload.cursorStart !== connection.transactionCursor || payload.ruleVersion !== NORMALIZATION_VERSION || connection.pausedAt) {
        throw new AppError(409, 'The bank update or normalization rules changed; sync again before repairing this item.', 'QUARANTINE_STALE');
      }
      await tx.quarantineItem.update({ where: { id: item.id }, data: { status: 'REPLAYING', replayCount: { increment: 1 },
        lastReplayAt: new Date(), sourcePayload: { ...(item.sourcePayload as Prisma.JsonObject), patch: parsed.data.patch } as Prisma.InputJsonObject } });
      const job = await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId: req.params.id,
        payload: { reason: 'QUARANTINE_REPLAY' } }, tx);
      return { jobId: job.jobId };
    });
    res.status(202).json({ data: result });
  } catch (error) { next(error); }
});

router.post('/:id/account-mappings', async (req, res, next) => {
  try {
    const parsed = ACCOUNT_MAPPING_SCHEMA.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        `Invalid account mappings: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
        'VALIDATION_ERROR',
      );
    }
    await applyAccountMappings({
      connectionId: req.params.id,
      sessionId: req.ownerSession?.sessionId as string,
      mappings: parsed.data.mappings,
    });
    res.status(200).json({ data: await getBankConnectionDto(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/sync', async (req, res, next) => {
  try {
    const { connectionId } = await requireConnection(req.params.id);
    const job = await enqueueSyncJob({
      jobType: 'CONNECTION_SYNC',
      trigger: 'MANUAL',
      connectionId,
      payload: { reason: 'MANUAL_SYNC' as const },
    });
    res.status(202).json({ data: { jobId: job.jobId, coalesced: job.coalesced } });
  } catch (err) {
    next(err);
  }
});

/**
 * Optional "Refresh from bank" (distinct from "Sync now"): asks Plaid to pull
 * fresh data from the institution. Worker routes it through BANK_REFRESH and
 * skips unsupported/throttled refreshes.
 */
router.post('/:id/refresh', async (req, res, next) => {
  try {
    const { connectionId } = await requireConnection(req.params.id);
    const settings = getBankConfig().plaid;
    if (!settings.refreshEnabled) {
      throw new AppError(400, 'Refresh from bank is disabled for this deployment (PLAID_REFRESH_ENABLED).', 'REFRESH_DISABLED');
    }
    const job = await enqueueSyncJob({
      jobType: 'BANK_REFRESH',
      trigger: 'MANUAL',
      connectionId,
      payload: { requestedBy: 'owner' as const },
    });
    res.status(202).json({ data: { jobId: job.jobId, coalesced: job.coalesced } });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/pause', async (req, res, next) => {
  try {
    const { connectionId } = await requireConnection(req.params.id);
    const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw bankNotFound();
    await prisma.bankConnection.update({
      where: { id: connectionId, version: connection.version },
      data: { pausedAt: new Date(), version: { increment: 1 } },
    });
    res.json({ data: await getBankConnectionDto(connectionId) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resume', async (req, res, next) => {
  try {
    const { connectionId } = await requireConnection(req.params.id);
    const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw bankNotFound();
    await prisma.bankConnection.update({
      where: { id: connectionId, version: connection.version },
      data: { pausedAt: null, version: { increment: 1 } },
    });
    await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId, payload: { reason: 'RESUME' } });
    res.json({ data: await getBankConnectionDto(connectionId) });
  } catch (err) {
    next(err);
  }
});

/** Tracked disconnect: fenced provider removal; local history is retained. */
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await disconnectConnection(req.params.id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

async function requireConnection(id: string): Promise<{ connectionId: string }> {
  const connection = await prisma.bankConnection.findUnique({ where: { id }, select: { id: true } });
  if (!connection) throw bankNotFound();
  return { connectionId: connection.id };
}

function bankNotFound(): AppError {
  return new AppError(404, 'Bank connection not found.', 'NOT_FOUND');
}

export default router;
