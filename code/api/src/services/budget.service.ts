import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decimalToNumber } from '../lib/types';
import { deriveMonthCount } from './trend-utils';

/**
 * 52.1429 is the average number of weeks per year (accounting for leap years).
 * Dividing by 12 gives the precise average number of weeks per month.
 */
const WEEKS_PER_MONTH = 52.1429 / 12;

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

export async function getBudgets(periodParam?: string): Promise<BudgetWithProgress[]> {
  const budgets = await prisma.budget.findMany({
    include: { category: true },
    orderBy: { category: { name: 'asc' } },
  });

  const now = new Date();
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let monthCountForBudget = 1;

  if (periodParam === 'all') {
    const firstTx = await prisma.transaction.findFirst({
      orderBy: { posted: 'asc' },
      select: { posted: true },
    });
    // Add 1 so the "all" range includes the month of the first transaction
    // itself, not just the number of month boundaries between that date and now.
    monthCountForBudget = deriveMonthCount(undefined, firstTx?.posted, now) + 1;
    startDate = undefined;
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (periodParam) {
    const months = parseInt(periodParam, 10);
    if (!isNaN(months) && months > 0) {
      startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      monthCountForBudget = months;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  if (monthCountForBudget < 1) monthCountForBudget = 1;

  const results: BudgetWithProgress[] = [];


  for (const b of budgets) {
    // Use descendant categories for rollup
    const categoryIds = await getDescendantCategoryIds(b.categoryId);

    // Use the calculated startDate and endDate for the query
    const whereClause: Prisma.TransactionWhereInput = {
      categoryId: { in: categoryIds },
      amount: { lt: 0 },
    };
    if (startDate || endDate) {
      whereClause.posted = {};
      if (startDate) whereClause.posted.gte = startDate;
      if (endDate) whereClause.posted.lte = endDate;
    }

    const spent = await prisma.transaction.aggregate({
      where: whereClause,
      _sum: { amount: true },
    });

    const spentAmount = Math.abs(decimalToNumber(spent._sum.amount));
    
    let budgetMultiplier = 1;
    
    switch (b.period) {
      case 'YEARLY':
        budgetMultiplier = monthCountForBudget / 12;
        break;
      case 'QUARTERLY':
        budgetMultiplier = monthCountForBudget / 3;
        break;
      case 'MONTHLY':
        budgetMultiplier = monthCountForBudget;
        break;
      case 'WEEKLY':
        budgetMultiplier = monthCountForBudget * WEEKS_PER_MONTH;
        break;
      default:
        budgetMultiplier = monthCountForBudget;
    }

    const budgetAmount = decimalToNumber(b.amount) * budgetMultiplier;

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
