import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transaction: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { getTransactionFilterCategories, getTransactions, updateTransactionCategory } from './transaction.service';

describe('transaction.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated transactions with mapped amounts', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        posted: new Date('2026-01-01T00:00:00.000Z'),
        amount: new Decimal('-14.20'),
        description: 'Coffee',
        payee: 'Cafe',
        memo: null,
        isReviewed: false,
        categoryRuleId: null,
        account: { id: 'a1', name: 'Checking', institution: 'Bank' },
        category: null,
      },
    ]);
    prismaMock.transaction.count.mockResolvedValue(1);

    const result = await getTransactions({ search: 'cof' }, 2, 1);

    expect(result.pagination).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect(result.data[0]).toEqual(expect.objectContaining({ id: 't1', amount: -14.2 }));
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 1,
        take: 1,
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it('builds filter category options including uncategorized', async () => {
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'c1', _count: { _all: 5 } },
      { categoryId: null, _count: { _all: 2 } },
    ]);
    prismaMock.category.findMany.mockResolvedValue([{ id: 'c1', name: 'Food', icon: 'Utensils', color: 'blue' }]);

    const options = await getTransactionFilterCategories({});

    expect(options).toEqual([
      { id: 'c1', name: 'Food', icon: 'Utensils', color: 'blue', count: 5 },
      { id: '__uncategorized', name: 'Uncategorized', icon: 'HelpCircle', color: 'gray', count: 2 },
    ]);
  });

  it('updates transaction category and marks as reviewed', async () => {
    prismaMock.transaction.update.mockResolvedValue({ id: 't1', isReviewed: true, categoryId: 'c1' });

    await updateTransactionCategory('t1', 'c1');

    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { categoryId: 'c1', isReviewed: true, categoryRuleId: null, categoryOwnership: 'USER' },
      }),
    );
  });

  it('lists pending transactions separately from posted transactions', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    prismaMock.transaction.count.mockResolvedValue(0);
    await getTransactions({ status: 'PENDING' });
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING' } }));
    await getTransactions({});
    expect(prismaMock.transaction.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { status: 'POSTED' } }));
  });
});
