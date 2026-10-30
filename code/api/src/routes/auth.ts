import { Router } from 'express';
import { z } from 'zod';
import { verifyOwnerPassword } from '@doughray/shared';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error-handler';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  createOwnerSession,
  destroyOwnerSession,
  loginClientKey,
  ownerPasswordHashConfigured,
  recordLoginFailure,
  requireOwnerSession,
} from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  password: z.string().min(1).max(1024),
});

/**
 * Login. The password is actually evaluated against OWNER_PASSWORD_HASH before
 * any rate-limit accounting so invalid configurations never leak timing hints.
 */
router.post('/login', async (req, res, next) => {
  try {
    if (!ownerPasswordHashConfigured()) {
      throw new AppError(503, 'Owner access is not provisioned. Set OWNER_PASSWORD_HASH to log in.', 'OWNER_NOT_PROVISIONED');
    }

    const credential = loginSchema.safeParse(req.body);
    if (!credential.success) {
      throw new AppError(400, 'Password is required.', 'VALIDATION_ERROR');
    }

    const clientKey = loginClientKey(req);
    const rate = checkLoginRateLimit(clientKey);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      throw new AppError(429, 'Too many failed login attempts. Try again later.', 'LOGIN_RATE_LIMITED');
    }

    const valid = verifyOwnerPassword(credential.data.password, process.env.OWNER_PASSWORD_HASH as string);
    if (!valid) {
      recordLoginFailure(clientKey);
      throw new AppError(401, 'Invalid password.', 'INVALID_CREDENTIALS');
    }

    clearLoginFailures(clientKey);
    // Opportunistic cleanup of expired sessions; keeps the table small without a cron.
    await prisma.authSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const csrfToken = await createOwnerSession(res);
    res.json({ data: { authenticated: true, csrfToken } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireOwnerSession(), async (req, res, next) => {
  try {
    await destroyOwnerSession(req, res);
    res.json({ data: { authenticated: false } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireOwnerSession(), (_req, res) => {
  res.json({ data: { authenticated: true } });
});

export default router;
