import { Router } from 'express';
import { z } from 'zod';
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
      action: z.enum(['MAP', 'CREATE']),
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
