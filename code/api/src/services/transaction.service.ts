import { prisma } from '../lib/prisma';
import { PaginatedResponse, TransactionFilters, decimalToNumber } from '../lib/types';

export interface TransactionListItem {
  id: string;
  posted: Date;
  amount: number;
  description: string;
  payee: string | null;
  memo: string | null;
  isReviewed: boolean;
  status: 'POSTED' | 'PENDING' | 'REMOVED' | 'SUPERSEDED';
  categoryRuleId: string | null;
  account: { id: string; name: string; institution: string | null; currency: string };
  category: { id: string; name: string; icon: string | null; color: string | null } | null;
}

export async function getTransactions(
  filters: TransactionFilters,
  page: number = 1,
  limit: number = 50
): Promise<PaginatedResponse<TransactionListItem>> {
  const where: any = { status: filters.status ?? 'POSTED' };

  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.categoryId === '__uncategorized') where.categoryId = null;
  else if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.startDate || filters.endDate) {
    where.posted = {};
    if (filters.startDate) where.posted.gte = filters.startDate;
    if (filters.endDate) where.posted.lte = filters.endDate;
  }
  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search, mode: 'insensitive' } },
      { payee: { contains: filters.search, mode: 'insensitive' } },
      { memo: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        account: { select: { id: true, name: true, institution: true, currency: true } },
        category: { select: { id: true, name: true, icon: true, color: true } },
      },
      orderBy: { posted: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    data: transactions.map((t) => ({
      id: t.id,
      posted: t.posted,
      amount: decimalToNumber(t.amount),
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      isReviewed: t.isReviewed,
      status: t.status,
      categoryRuleId: t.categoryRuleId,
      account: t.account,
      category: t.category,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getTransactionFilterCategories(filters: Omit<TransactionFilters, 'categoryId'>) {
  const where: any = { status: filters.status ?? 'POSTED' };

  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.startDate || filters.endDate) {
    where.posted = {};
    if (filters.startDate) where.posted.gte = filters.startDate;
    if (filters.endDate) where.posted.lte = filters.endDate;
  }
  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search, mode: 'insensitive' } },
      { payee: { contains: filters.search, mode: 'insensitive' } },
      { memo: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const grouped = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where,
    _count: { _all: true },
  });

  const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => !!id);
  const categories = categoryIds.length
    ? await prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, icon: true, color: true },
      })
    : [];

  const byId = new Map(categories.map((c) => [c.id, c]));

  const options = grouped
    .map((g) => {
      if (!g.categoryId) {
        return {
          id: '__uncategorized',
          name: 'Uncategorized',
          icon: 'HelpCircle',
          color: 'gray',
          count: g._count._all,
        };
      }

      const category = byId.get(g.categoryId);
      if (!category) return null;

      return {
        id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        count: g._count._all,
      };
    })
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, b) => b.count - a.count);

  return options;
}

export async function updateTransactionCategory(id: string, categoryId: string) {
  return prisma.transaction.update({
    where: { id },
    data: { categoryId, isReviewed: true, categoryRuleId: null, categoryOwnership: 'USER' },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
    },
  });
}
