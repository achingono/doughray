import { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma';

/**
 * Single-owner session authentication.
 *
 * - Password provisioning happens exclusively through OWNER_PASSWORD_HASH
 *   (server configuration; see code/scripts/password-hash.mjs). No browser
 *   code ships secrets and there is no default password.
 * - Sessions are server-side rows (AuthSession) referenced by an opaque,
 *   HttpOnly cookie. Only the SHA-256 hash of the token is stored.
 * - State-changing requests require the X-CSRF-Token header to match the
 *   readable csrf cookie issued at login (defense in depth on top of a
 *   SameSite=strict session cookie).
 * - Only health, auth and the cryptographically verified Plaid webhook stay
 *   outside the session requirement.
 */

const SESSION_COOKIE = 'doughray_session';
const CSRF_COOKIE = 'doughray_csrf';
const SESSION_TTL_DAYS = 7;
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

export interface OwnerSession {
  sessionId: string;
  tokenHash: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    ownerSession?: OwnerSession;
  }
}

export class AuthError extends Error {
  constructor(public statusCode: number, message: string, public code: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function ownerPasswordHashConfigured(): boolean {
  const stored = process.env.OWNER_PASSWORD_HASH ?? '';
  return stored.startsWith('scrypt:') && stored.split(':').length === 3 && stored.length > 'scrypt:'.length;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const raw = part.slice(separator + 1).trim();
    let value = raw;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`;
}

function csrfCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${CSRF_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}; SameSite=Lax${secure}`;
}

function clearCookies(): string[] {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`,
  ];
}

export async function createOwnerSession(res: Response): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.authSession.create({
    data: { tokenHash: hashToken(token), expiresAt },
  });
  res.setHeader('Set-Cookie', [sessionCookie(token, SESSION_TTL_DAYS * 24 * 60 * 60), csrfCookie(csrfToken)]);
  return csrfToken;
}

async function loadOwnerSession(req: Request): Promise<OwnerSession | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await prisma.authSession.findUnique({ where: { tokenHash } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    const refreshedExpires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    try {
      await prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: refreshedExpires },
      });
    } catch {
      // Session row may have been deleted concurrently; verification at use time handles it.
    }
  }
  return { sessionId: session.id, tokenHash };
}

/** Fail-closed session requirement for every financial/management route. */
export function requireOwnerSession(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!ownerPasswordHashConfigured()) {
        res.status(503).json({
          error: {
            message: 'Owner access is not provisioned. Set OWNER_PASSWORD_HASH to log in.',
            code: 'OWNER_NOT_PROVISIONED',
          },
        });
        return;
      }
      const session = await loadOwnerSession(req);
      if (session === null) {
        res.status(401).json({
          error: { message: 'Owner authentication required.', code: 'AUTH_REQUIRED' },
        });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        const header = req.headers['x-csrf-token'];
        const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
        const valid = typeof header === 'string' && header.length > 0 && typeof cookie === 'string'
          && safeEqual(header, cookie);
        if (!valid) {
          res.status(403).json({
            error: { message: 'CSRF token missing or invalid.', code: 'CSRF_INVALID' },
          });
          return;
        }
      }
      req.ownerSession = session;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Login rate limiting (fixed window per client IP)
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

interface RateEntry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const failureEntries = new Map<string, RateEntry>();

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = failureEntries.get(key);
  if (entry && entry.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  let entry = failureEntries.get(key);
  if (!entry || now - entry.windowStart > LOCK_WINDOW_MS) {
    entry = { failures: 0, windowStart: now, lockedUntil: 0 };
    failureEntries.set(key, entry);
  }
  entry.failures += 1;
  if (entry.failures >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_WINDOW_MS;
    entry.failures = 0;
    entry.windowStart = now;
  }
}

export function clearLoginFailures(key: string): void {
  failureEntries.delete(key);
}

export function loginClientKey(req: Request): string {
  // Express only derives req.ip from forwarded headers when trust proxy is
  // explicitly configured; never accept a client-supplied header directly.
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export async function destroyOwnerSession(req: Request, res: Response): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  res.setHeader('Set-Cookie', clearCookies());
}
