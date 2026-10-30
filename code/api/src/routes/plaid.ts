import { Router } from 'express';
import { AppError } from '../middleware/error-handler';
import { requireOwnerSession } from '../middleware/auth';
import {
  completeInitialLink,
  completeUpdateLink,
  createLinkAttempt,
} from '../services/plaid-link.service';
import { enqueueSyncJob } from '../services/sync-queue.service';
import { getBankConfigStatus, getPlaidEnvironment, getPlaidProvider } from '../lib/bank-config';
import { prisma } from '../lib/prisma';
import { verifyPlaidWebhook } from '../lib/plaid-webhook';
import type { Prisma } from '@prisma/client';
import type { IncomingHttpHeaders } from 'http';

const router = Router();

/**
 * Plaid routes. All management routes require the owner session plus CSRF;
 * the webhook is the single cryptographically verified public entry point.
 *
 * NOTE: the webhook route must read the exact raw request bytes before JSON
 * parsing. index.ts mounts express.raw for this path ahead of express.json().
 */

// ---------------------------------------------------------------------------
// Authenticated Link management
// ---------------------------------------------------------------------------

router.post('/link-token', requireOwnerSession(), async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'UPDATE' ? 'UPDATE' : 'NEW';
    const attempt = await createLinkAttempt({
      mode,
      connectionId: typeof req.body?.connectionId === 'string' ? req.body.connectionId : null,
      linkSessionId: typeof req.body?.linkSessionId === 'string' ? req.body.linkSessionId : null,
      sessionId: req.ownerSession?.sessionId as string,
    });
    res.status(201).json({ data: attempt });
  } catch (err) {
    next(err);
  }
});

router.post('/exchange', requireOwnerSession(), async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : null;
    const publicToken = typeof body?.publicToken === 'string' ? body.publicToken : null;
    if (!attemptId || !publicToken) {
      throw new AppError(400, 'attemptId and publicToken are required.', 'VALIDATION_ERROR');
    }
    const result = await completeInitialLink({
      attemptId,
      publicToken,
      sessionId: req.ownerSession?.sessionId as string,
      institutionName: typeof body?.institutionName === 'string' ? body.institutionName : null,
      institutionId: typeof body?.institutionId === 'string' ? body.institutionId : null,
    });
    res.status(result.duplicate ? 200 : 201).json({
      data: {
        connection: result.connection,
        accounts: result.accounts,
        duplicate: result.duplicate,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/connections/:id/link-complete', requireOwnerSession(), async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : null;
    if (!attemptId) {
      throw new AppError(400, 'attemptId is required.', 'VALIDATION_ERROR');
    }
    const result = await completeUpdateLink({
      connectionId: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      attemptId,
      sessionId: req.ownerSession?.sessionId as string,
      institutionName: typeof body?.institutionName === 'string' ? body.institutionName : null,
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Verified webhook (public entry point)
// ---------------------------------------------------------------------------

interface RawBodyRequest {
  headers: IncomingHttpHeaders;
  body: unknown;
}

function plaidVerificationHeader(headers: IncomingHttpHeaders): string | undefined {
  const value = headers['plaid-verification'];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

router.post('/webhook', async (req, res, next) => {
  try {
    // Verify BEFORE parsing: body hash covers the exact bytes.
    const raw = req.body as RawBodyRequest['body'];
    if (!Buffer.isBuffer(raw)) {
      throw new AppError(400, 'Raw body is required for webhook verification.', 'WEBHOOK_RAW_BODY_REQUIRED');
    }
    const verification = await verifyPlaidWebhook(raw, plaidVerificationHeader(req.headers), getPlaidProvider());
    if (!verification.ok) {
      // Silently drop: malformed payloads receive no discriminating feedback.
      res.status(verification.reason === 'KEY_UNAVAILABLE' ? 503 : 400).json({ error: { message: 'Webhook verification failed.', code: 'WEBHOOK_REJECTED' } });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new AppError(400, 'Webhook payload is not valid JSON.', 'WEBHOOK_INVALID_JSON');
    }

    const webhookType = typeof payload.webhook_type === 'string' ? payload.webhook_type : 'UNKNOWN';
    const webhookCode = typeof payload.webhook_code === 'string' ? payload.webhook_code : 'UNKNOWN';
    const itemId = typeof payload.item_id === 'string' ? payload.item_id : null;
    const computedHash = verification.bodySha256;

    // A body can be identical for distinct events. Persist each verified
    // delivery and its queued work together; duplicates coalesce at the queue.
    const { receipt, dispatched } = await prisma.$transaction(async (tx) => {
    const receipt = await tx.webhookReceipt.create({
      data: {
        provider: 'PLAID',
        environment: environmentOrDefault(),
        webhookType,
        webhookCode,
        itemId,
        bodySha256: computedHash,
        signatureKeyId: verification.keyId,
        verificationState: 'VALID',
        status: 'RECEIVED',
        // Safe projection only: type/code/item id; never token-bearing values.
        payloadSafe: { webhookType, webhookCode, itemId },
      },
    });

    const dispatched = await dispatchWebhookEvent(tx, webhookType, webhookCode, itemId);
    if (dispatched) {
      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
      });
    } else {
      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { status: 'DUPLICATE' },
      });
    }
    return { receipt, dispatched };
    });

    res.status(200).json({ received: true, receiptId: receipt.id, dispatched });
  } catch (err) {
    next(err);
  }
});

function environmentOrDefault(): 'SANDBOX' | 'PRODUCTION' {
  const env = getPlaidEnvironment();
  return env === 'production' ? 'PRODUCTION' : 'SANDBOX';
}

const SYNC_DISPATCH_CODES = new Set([
  'SYNC_UPDATES_AVAILABLE',
  'INITIAL_UPDATE_COMPLETE',
  'HISTORICAL_UPDATE_COMPLETE',
]);

/** Persist work before returning success; unknown codes are recorded but ignored. */
async function dispatchWebhookEvent(
  tx: Prisma.TransactionClient,
  webhookType: string,
  webhookCode: string,
  itemId: string | null,
): Promise<boolean> {
  if (webhookType === 'TRANSACTIONS' && SYNC_DISPATCH_CODES.has(webhookCode)) {
    const connection = itemId
      ? await tx.bankConnection.findUnique({
          where: {
            provider_environment_externalItemId: {
              provider: 'PLAID',
              environment: environmentOrDefault(),
              externalItemId: itemId,
            },
          },
          select: { id: true, status: true, pausedAt: true },
        })
      : null;
    if (!connection || connection.status === 'DISCONNECTED' || connection.pausedAt !== null) {
      return false;
    }
    await enqueueSyncJob({
      jobType: 'CONNECTION_SYNC',
      trigger: 'WEBHOOK',
      connectionId: connection.id,
      payload: { webhookCode },
    }, tx);
    return true;
  }

  if (webhookType === 'ITEM') {
    await recordItemHealthEvent(tx, itemId, webhookCode);
    return false;
  }

  return false;
}

/** Item health events update the connection row; no sync work is enqueued. */
async function recordItemHealthEvent(tx: Prisma.TransactionClient, itemId: string | null, code: string): Promise<void> {
  if (!itemId || itemId === '') return;
  const connection = await tx.bankConnection.findUnique({
    where: { provider_environment_externalItemId: { provider: 'PLAID', environment: environmentOrDefault(), externalItemId: itemId } },
    select: { id: true },
  });
  if (!connection) return;

  const status = code === 'USER_PERMISSION_REVOKED' || code === 'CONSENT_EXPIRED'
    ? 'AUTH_REQUIRED'
    : code === 'ERROR' ? 'ERROR' : null;
  if (status === null) return;

  await tx.bankConnection.update({
    where: { id: connection.id },
    data: {
      status,
      healthDetail: `Provider reported ITEM ${code.toLowerCase()}`,
      lastErrorAt: new Date(),
      lastErrorCode: code,
    },
  });
}

// Config status (safe booleans only) for the Settings screen.
router.get('/config-status', requireOwnerSession(), (_req, res) => {
  const status = getBankConfigStatus();
  res.json({ data: status });
});

export default router;
