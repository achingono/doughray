import { prisma } from '../lib/prisma';
import { normalizePayee } from '../lib/normalize-payee';
import type { PaginatedResponse } from '../lib/types';
import { AppError } from '../middleware/error-handler';

export interface CreateCategoryRuleInput {
  normalizedPayee: string;
  categoryId: string;
  accountId?: string;
  sourceTransactionId: string;
}

export interface CategoryRuleListItem {
  id: string;
  normalizedPayee: string;
  categoryId: string;
  accountId: string | null;
  sourceTransactionId: string;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string; icon: string | null; color: string | null };
  account: { id: string; name: string; institution: string | null } | null;
}

export async function createCategoryRule(input: CreateCategoryRuleInput) {
  const result = await prisma.categoryRule.create({ data: input, select: { id: true, normalizedPayee: true, categoryId: true, accountId: true } });
  return result;
}

export async function listCategoryRules(page = 1, limit = 20): Promise<PaginatedResponse<CategoryRuleListItem>> {
  const [rules, total] = await Promise.all([
    prisma.categoryRule.findMany({
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        account: { select: { id: true, name: true, institution: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.categoryRule.count(),
  ]);

  return {
    data: rules,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function deleteCategoryRule(id: string): Promise<void> {
  const existing = await prisma.categoryRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new AppError(404, 'Category rule not found', 'NOT_FOUND');
  }

  await prisma.$transaction([
    prisma.transaction.updateMany({
      where: { categoryRuleId: id },
      data: { categoryRuleId: null },
    }),
    prisma.categoryRule.delete({ where: { id } }),
  ]);
}

export async function applyCategoryRulesToTransactions(transactionIds: string[]): Promise<number> {
  if (transactionIds.length === 0) return 0;

  const [rules, transactions] = await Promise.all([
    prisma.categoryRule.findMany({
      select: { id: true, normalizedPayee: true, accountId: true, categoryId: true },
    }),
    prisma.transaction.findMany({
      where: {
        id: { in: transactionIds },
        categoryId: null,
        isReviewed: false,
      },
      select: {
        id: true,
        accountId: true,
        description: true,
        payee: true,
      },
    }),
  ]);

  if (rules.length === 0 || transactions.length === 0) return 0;

  const accountScopedRuleByKey = new Map<string, { id: string; categoryId: string }>();
  const globalRuleByKey = new Map<string, { id: string; categoryId: string }>();

  for (const rule of rules) {
    if (rule.accountId) {
      accountScopedRuleByKey.set(`${rule.accountId}::${rule.normalizedPayee}`, { id: rule.id, categoryId: rule.categoryId });
    } else {
      globalRuleByKey.set(rule.normalizedPayee, { id: rule.id, categoryId: rule.categoryId });
    }
  }

  let applied = 0;
  for (const transaction of transactions) {
    const key = normalizePayee(transaction.payee || transaction.description);
    if (key === 'unknown-merchant') continue;

    const accountScoped = accountScopedRuleByKey.get(`${transaction.accountId}::${key}`);
    const global = globalRuleByKey.get(key);
    const rule = accountScoped ?? global;
    if (!rule) continue;

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        categoryId: rule.categoryId,
        isReviewed: true,
        categoryRuleId: rule.id,
      },
    });
    applied += 1;
  }

  return applied;
}

