import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budget: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    transaction: {
      aggregate: vi.fn(),
    },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { createBudget, deleteBudget, getBudgets, updateBudget } from './budget.service';

describe('budget.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes budget progress values including descendant categories', async () => {
    prismaMock.budget.findMany.mockResolvedValue([
      {
        id: 'b1',
        categoryId: 'c1',
        category: { name: 'Food', icon: 'Utensils', color: 'blue' },
        amount: new Decimal('500'),
        period: 'MONTHLY',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: null,
      },
    ]);
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'c1', parentId: null, name: 'Food' },
      { id: 'c1a', parentId: 'c1', name: 'Groceries' },
      { id: 'c1b', parentId: 'c1', name: 'Restaurants' },
      { id: 'c1b1', parentId: 'c1b', name: 'Delivery' },
      { id: 'transfer', parentId: 'c1', name: 'Transfers' },
      { id: 'other', parentId: null, name: 'Other' },
    ]);
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: new Decimal('-125.50') } });

    const result = await getBudgets();

    expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: { in: expect.arrayContaining(['c1', 'c1a', 'c1b', 'c1b1']) },
        }),
      }),
    );
    expect(prismaMock.transaction.aggregate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: { in: expect.arrayContaining(['transfer']) },
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'b1',
        amount: 500,
        spent: 125.5,
        remaining: 374.5,
        percentUsed: 25.1,
      }),
    ]);
  });

  it('delegates create/update/delete to prisma', async () => {
    prismaMock.budget.create.mockResolvedValue({ id: 'b1' });
    prismaMock.budget.update.mockResolvedValue({ id: 'b1', amount: new Decimal('600') });
    prismaMock.budget.delete.mockResolvedValue({ id: 'b1' });

    await createBudget({
      categoryId: 'c1',
      amount: 500,
      period: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    await updateBudget('b1', { amount: 600 });
    await deleteBudget('b1');

    expect(prismaMock.budget.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: 'c1', amount: 500 }) }),
    );
    expect(prismaMock.budget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: { amount: 600 } }),
    );
    expect(prismaMock.budget.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
  });
});
