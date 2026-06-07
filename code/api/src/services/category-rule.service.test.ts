import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    categoryRule: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { AppError } from '../middleware/error-handler';
import { applyCategoryRulesToTransactions, createCategoryRule, deleteCategoryRule, listCategoryRules } from './category-rule.service';

describe('category-rule.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (operations: any[]) => Promise.all(operations));
  });

  it('lists category rules with pagination', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([{ id: 'rule-1' }]);
    prismaMock.categoryRule.count.mockResolvedValue(1);

    const result = await listCategoryRules(1, 20);

    expect(result.data).toEqual([{ id: 'rule-1' }]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('deletes a category rule and unlinks transactions', async () => {
    prismaMock.categoryRule.findUnique.mockResolvedValue({ id: 'rule-1' });
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.categoryRule.delete.mockResolvedValue({ id: 'rule-1' });

    await deleteCategoryRule('rule-1');

    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { categoryRuleId: 'rule-1' },
      data: { categoryRuleId: null },
    });
    expect(prismaMock.categoryRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });

  it('throws when deleting a missing rule', async () => {
    prismaMock.categoryRule.findUnique.mockResolvedValue(null);
    await expect(deleteCategoryRule('missing')).rejects.toBeInstanceOf(AppError);
  });

  it('creates a category rule', async () => {
    prismaMock.categoryRule.create.mockResolvedValue({
      id: 'new-rule',
      normalizedPayee: 'test',
      categoryId: 'cat-1',
      accountId: null,
    });

    const result = await createCategoryRule({
      normalizedPayee: 'test',
      categoryId: 'cat-1',
      sourceTransactionId: 'tx-1',
    });

    expect(prismaMock.categoryRule.create).toHaveBeenCalledWith({
      data: { normalizedPayee: 'test', categoryId: 'cat-1', sourceTransactionId: 'tx-1' },
      select: { id: true, normalizedPayee: true, categoryId: true, accountId: true },
    });
    expect(result.id).toBe('new-rule');
  });

  it('applies matching rules to uncategorized transactions', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      { id: 'rule-1', normalizedPayee: 'netflix com', accountId: 'a1', categoryId: 'c1' },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([
      { id: 't1', accountId: 'a1', description: 'NETFLIX.COM', payee: null },
      { id: 't2', accountId: 'a1', description: 'STARBUCKS', payee: null },
    ]);
    prismaMock.transaction.update.mockResolvedValue({});

    const applied = await applyCategoryRulesToTransactions(['t1', 't2']);

    expect(applied).toBe(1);
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        categoryId: 'c1',
        isReviewed: true,
        categoryRuleId: 'rule-1',
      },
    });
  });
});

