import { prisma } from '../lib/prisma';
import { DashboardSummary, TrendDataPoint, decimalToNumber } from '../lib/types';
import { isExpenseTransaction } from '../lib/expense-transactions';
import { getTotalAssetValue } from './asset.service';
import { buildCumulativeMonthlyPoints, deriveMonthCount, mapSnapshotsToTrendPoints, shouldUseSnapshots } from './trend-utils';

const ASSET_TYPES = new Set(['CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER']);
const LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN', 'MORTGAGE']);

export async function getDashboardSummary(accountId?: string): Promise<DashboardSummary> {
  const [accounts, manualAssetValue] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true, ...(accountId ? { id: accountId } : {}) } }),
    accountId ? Promise.resolve(0) : getTotalAssetValue(),
  ]);

  let totalAssets = manualAssetValue;
  let totalLiabilities = 0;

  for (const a of accounts) {
    const bal = decimalToNumber(a.balance);
    if (ASSET_TYPES.has(a.type)) {
      totalAssets += bal;
    } else if (LIABILITY_TYPES.has(a.type)) {
      totalLiabilities += Math.abs(bal);
    }
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthlyTransactions = await prisma.transaction.findMany({
    where: { posted: { gte: startOfMonth }, ...(accountId ? { accountId } : {}) },
    include: { category: { select: { name: true, parent: { select: { name: true } } } } },
  });

  let monthlyIncome = 0;
  let monthlyExpenses = 0;

  for (const t of monthlyTransactions) {
    const amt = decimalToNumber(t.amount);
    if (amt > 0) monthlyIncome += amt;
    else if (isExpenseTransaction({ amount: amt, category: t.category })) monthlyExpenses += Math.abs(amt);
  }

  return {
    netWorth: totalAssets - totalLiabilities,
    totalAssets,
    totalLiabilities,
    monthlyIncome,
    monthlyExpenses,
    monthlyNet: monthlyIncome - monthlyExpenses,
  };
}

export async function getTrends(months?: number, accountId?: string): Promise<TrendDataPoint[]> {
  const snapshotWhere = months && months > 0
    ? { date: { gte: new Date(new Date().setMonth(new Date().getMonth() - months)) } }
    : undefined;

  const snapshots = accountId
    ? await prisma.accountNetWorthSnapshot.findMany({
        where: snapshotWhere ? { accountId, ...snapshotWhere } : { accountId },
        select: { date: true, netWorth: true },
        orderBy: { date: 'asc' },
      })
    : await prisma.netWorthSnapshot.findMany({
        where: snapshotWhere,
        select: { date: true, netWorth: true },
        orderBy: { date: 'asc' },
      });

  const now = new Date();

  const firstTx = await prisma.transaction.findFirst({
    where: accountId ? { accountId } : undefined,
    orderBy: { posted: 'asc' },
    select: { posted: true },
  });

  const monthCount = deriveMonthCount(months, firstTx?.posted, now);

  if (!firstTx && snapshots.length === 0) {
    return [];
  }

  const useSnapshots = shouldUseSnapshots(snapshots.length, months, monthCount);

  if (useSnapshots) {
    return mapSnapshotsToTrendPoints(snapshots);
  }

  // Fallback: generate from transaction history when snapshots are missing/sparse
  if (!firstTx) {
    return mapSnapshotsToTrendPoints(snapshots);
  }

  const lastMonthExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const transactions = await prisma.transaction.findMany({
    where: {
      posted: { lt: lastMonthExclusive },
      ...(accountId ? { accountId } : {}),
    },
    select: { posted: true, amount: true },
    orderBy: { posted: 'asc' },
  });

  return buildCumulativeMonthlyPoints(transactions, monthCount, now);
}

export async function getSpendingByCategory(startDate?: Date, endDate?: Date, accountId?: string) {
  const where: any = {
    amount: { lt: 0 },
  };

  if (accountId) {
    where.accountId = accountId;
  }

  if (startDate || endDate) {
    where.posted = {};
    if (startDate) where.posted.gte = startDate;
    if (endDate) where.posted.lte = endDate;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      category: {
        select: {
          id: true,
          name: true,
          icon: true,
          color: true,
          parent: { select: { name: true } },
        },
      },
    },
  });

  const byCategory = new Map<string, { category: any; total: number }>();

  for (const t of transactions) {
    if (!isExpenseTransaction({ amount: decimalToNumber(t.amount), category: t.category })) continue;
    const catName = t.category?.name || 'Uncategorized';
    const existing = byCategory.get(catName) || {
      category: t.category
        ? { id: t.category.id, name: t.category.name, icon: t.category.icon, color: t.category.color }
        : { id: null, name: 'Uncategorized', icon: 'HelpCircle', color: 'gray' },
      total: 0,
    };
    existing.total += Math.abs(decimalToNumber(t.amount));
    byCategory.set(catName, existing);
  }

  return Array.from(byCategory.values())
    .sort((a, b) => b.total - a.total);
}
