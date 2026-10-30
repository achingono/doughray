import express from 'express';
import request from 'supertest';
import { scryptSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessions } = vi.hoisted(() => ({ sessions: new Map<string, { id: string; tokenHash: string; expiresAt: Date; lastSeenAt: Date }>() }));
vi.mock('../lib/prisma', () => ({ prisma: { authSession: {
  create: vi.fn(async ({ data }) => { const row = { id: 'session-1', ...data, lastSeenAt: new Date() }; sessions.set(row.tokenHash, row); return row; }),
  findUnique: vi.fn(async ({ where }) => sessions.get(where.tokenHash) ?? null),
  update: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
  deleteMany: vi.fn(async ({ where }) => { if (where.tokenHash) sessions.delete(where.tokenHash); return { count: 0 }; }),
} } }));

import authRoutes from '../routes/auth';
import { requireOwnerSession } from './auth';
import { errorHandler } from './error-handler';

describe('owner session and CSRF protection', () => {
  beforeEach(() => {
    sessions.clear();
    const salt = Buffer.alloc(16, 7);
    const key = scryptSync('fixture-password', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    process.env.OWNER_PASSWORD_HASH = `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
    process.env.NODE_ENV = 'test';
  });

  it('requires login and validates CSRF before mutations', async () => {
    const app = express(); app.use(express.json()); app.use('/auth', authRoutes);
    app.get('/private', requireOwnerSession(), (_req, res) => res.json({ ok: true }));
    app.post('/private', requireOwnerSession(), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    await request(app).get('/private').expect(401);
    await request(app).post('/auth/login').send({ password: 'wrong' }).expect(401);
    const login = await request(app).post('/auth/login').send({ password: 'fixture-password' }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('HttpOnly');
    const cookieHeader = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    await request(app).get('/private').set('Cookie', cookieHeader).expect(200);
    await request(app).post('/private').set('Cookie', cookieHeader).expect(403);
    await request(app).post('/private').set('Cookie', cookieHeader).set('X-CSRF-Token', login.body.data.csrfToken).expect(200);
    await request(app).post('/auth/logout').set('Cookie', cookieHeader).set('X-CSRF-Token', login.body.data.csrfToken).expect(200);
    await request(app).get('/private').set('Cookie', cookieHeader).expect(401);
  });
});
