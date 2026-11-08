import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    category: {
      findUnique: vi.fn(),
    },
    categoryRule: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@doughray/shared', async (importOriginal) => ({ ...(await importOriginal<typeof import('@doughray/shared')>()), reconcileLoanTransactions: vi.fn() }));

import { AppError } from '../middleware/error-handler';
import { getRecategorizePreview, recategorizeTransaction } from './recategorization.service';

describe('recategorization.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => callback(prismaMock));
    prismaMock.category.findUnique.mockResolvedValue({ id: 'c1', children: [] });
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: 't1',
      accountId: 'a1',
      posted: new Date('2026-04-10T00:00:00.000Z'),
      description: 'NETFLIX.COM',
      payee: null,
      categoryId: null,
      isReviewed: false,
      categoryRuleId: null,
    });
  });

  it('builds recategorization preview for matching past transactions', async () => {
    prismaMock.categoryRule.findUnique.mockResolvedValue(null);
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        posted: new Date('2026-04-10T00:00:00.000Z'),
        amount: -15.99,
        description: 'NETFLIX.COM',
        payee: null,
        categoryId: null,
        isReviewed: false,
        categoryRuleId: null,
      },
      {
        id: 't0',
        posted: new Date('2026-03-10T00:00:00.000Z'),
        amount: -15.99,
        description: 'NETFLIX.COM',
        payee: null,
        categoryId: null,
        isReviewed: false,
        categoryRuleId: null,
      },
    ]);

    const preview = await getRecategorizePreview('t1', 'all-past');

    expect(preview.normalizedPayee).toBe('netflix com');
    expect(preview.eligiblePastCount).toBe(2);
  });

  it('applies single-instance recategorization', async () => {
    prismaMock.transaction.update.mockResolvedValue({ id: 't1' });

    const result = await recategorizeTransaction('t1', 'c1', 'single-instance');

    expect(result.futureRule).toBeNull();
    expect(result.appliedPastCount).toBe(0);
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { categoryId: 'c1', isReviewed: true, categoryRuleId: null },
    });
  });

  it('applies past-and-future recategorization with rule upsert', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        posted: new Date('2026-04-10T00:00:00.000Z'),
        amount: -15.99,
        description: 'NETFLIX.COM',
        payee: null,
        categoryId: null,
        isReviewed: false,
        categoryRuleId: null,
      },
      {
        id: 't0',
        posted: new Date('2026-03-10T00:00:00.000Z'),
        amount: -15.99,
        description: 'NETFLIX.COM',
        payee: null,
        categoryId: null,
        isReviewed: false,
        categoryRuleId: null,
      },
    ]);
    prismaMock.categoryRule.upsert.mockResolvedValue({ id: 'rule-1', categoryId: 'c1', accountId: 'a1' });
    prismaMock.transaction.update.mockResolvedValue({ id: 't1' });
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });

    const result = await recategorizeTransaction('t1', 'c1', 'all-past-and-future');

    expect(result.futureRule).toEqual({ id: 'rule-1', categoryId: 'c1', accountId: 'a1' });
    expect(result.appliedPastCount).toBe(1);
    expect(prismaMock.categoryRule.upsert).toHaveBeenCalled();
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t0'] } },
      data: {
        categoryId: 'c1',
        isReviewed: true,
        categoryRuleId: 'rule-1',
      },
    });
  });

  it('rejects recurring scopes for unknown merchant keys', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: 't1',
      accountId: 'a1',
      posted: new Date('2026-04-10T00:00:00.000Z'),
      description: '',
      payee: null,
      categoryId: null,
      isReviewed: false,
      categoryRuleId: null,
    });

    await expect(recategorizeTransaction('t1', 'c1', 'all-future')).rejects.toBeInstanceOf(AppError);
  });
});

