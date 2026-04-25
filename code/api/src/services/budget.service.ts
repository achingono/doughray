import { prisma } from '../lib/prisma';
import { decimalToNumber } from '../lib/types';

const EXCLUDED_BUDGET_CATEGORY_NAMES = new Set(['Transfers']);

async function getDescendantCategoryIds(rootCategoryId: string): Promise<string[]> {
  const categories = await prisma.category.findMany({
    select: { id: true, parentId: true, name: true },
  });

  const childrenByParent = new Map<string | null, Array<{ id: string; name: string }>>();
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push({ id: category.id, name: category.name });
    childrenByParent.set(category.parentId, siblings);
  }

  const ids = new Set<string>([rootCategoryId]);
  const stack = [rootCategoryId];

  while (stack.length > 0) {
    const currentId = stack.pop() as string;
    const children = childrenByParent.get(currentId) ?? [];
    for (const child of children) {
      if (EXCLUDED_BUDGET_CATEGORY_NAMES.has(child.name)) {
        continue;
      }
      if (!ids.has(child.id)) {
        ids.add(child.id);
        stack.push(child.id);
      }
    }
  }

  return Array.from(ids);
}

export interface BudgetWithProgress {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  amount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  period: string;
  startDate: Date;
  endDate: Date | null;
}

export async function getBudgets(): Promise<BudgetWithProgress[]> {
  const budgets = await prisma.budget.findMany({
    include: { category: true },
    orderBy: { category: { name: 'asc' } },
  });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const results: BudgetWithProgress[] = [];

  for (const b of budgets) {
    const categoryIds = await getDescendantCategoryIds(b.categoryId);

    const spent = await prisma.transaction.aggregate({
      where: {
        categoryId: { in: categoryIds },
        amount: { lt: 0 },
        posted: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    });

    const spentAmount = Math.abs(decimalToNumber(spent._sum.amount));
    const budgetAmount = decimalToNumber(b.amount);

    results.push({
      id: b.id,
      categoryId: b.categoryId,
      categoryName: b.category.name,
      categoryIcon: b.category.icon,
      categoryColor: b.category.color,
      amount: budgetAmount,
      spent: spentAmount,
      remaining: budgetAmount - spentAmount,
      percentUsed: budgetAmount > 0 ? (spentAmount / budgetAmount) * 100 : 0,
      period: b.period,
      startDate: b.startDate,
      endDate: b.endDate,
    });
  }

  return results;
}

export async function createBudget(data: {
  categoryId: string;
  amount: number;
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate: Date;
  endDate?: Date;
}) {
  return prisma.budget.create({
    data: {
      categoryId: data.categoryId,
      amount: data.amount,
      period: data.period,
      startDate: data.startDate,
      endDate: data.endDate,
    },
    include: { category: true },
  });
}

export async function updateBudget(id: string, data: { amount?: number; period?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; endDate?: Date }) {
  return prisma.budget.update({
    where: { id },
    data,
    include: { category: true },
  });
}

export async function deleteBudget(id: string) {
  return prisma.budget.delete({ where: { id } });
}
