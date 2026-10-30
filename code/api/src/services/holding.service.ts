import { prisma } from '../lib/prisma';
import { HoldingsSummary, decimalToNumber, TrendDataPoint } from '../lib/types';
import { getTotalAssetValue } from './asset.service';
import { buildCumulativeMonthlyPoints, deriveMonthCount, mapSnapshotsToTrendPoints, shouldUseSnapshots } from './trend-utils';

const ASSET_TYPES = new Set(['CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER']);
const LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN', 'MORTGAGE']);

export async function getHoldings(): Promise<HoldingsSummary> {
  const [accounts, manualAssetValue] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      include: { _count: { select: { transactions: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    getTotalAssetValue(),
  ]);

  let totalAssets = manualAssetValue;
  let totalLiabilities = 0;

  const accountList = accounts.map((a) => {
    const bal = decimalToNumber(a.balance);
    if (ASSET_TYPES.has(a.type)) totalAssets += bal;
    else if (LIABILITY_TYPES.has(a.type)) totalLiabilities += Math.abs(bal);

    return {
      id: a.id,
      name: a.name,
      institution: a.institution,
      type: a.type,
      currency: a.currency,
      balance: bal,
      availableBalance: a.availableBalance ? decimalToNumber(a.availableBalance) : null,
      balanceDate: a.balanceDate,
      transactionCount: a._count.transactions,
    };
  });

  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    accounts: accountList,
  };
}

export async function getHoldingsHistory(months?: number): Promise<TrendDataPoint[]> {
  const where = months && months > 0
    ? { date: { gte: new Date(new Date().setMonth(new Date().getMonth() - months)) } }
    : undefined;

  const snapshots = await prisma.netWorthSnapshot.findMany({
    where,
    select: { date: true, netWorth: true },
    orderBy: { date: 'asc' },
  });

  const now = new Date();

  const firstTx = await prisma.transaction.findFirst({
    where: { status: 'POSTED' },
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
    where: { status: 'POSTED', posted: { lt: lastMonthExclusive } },
    select: { posted: true, amount: true },
    orderBy: { posted: 'asc' },
  });

  return buildCumulativeMonthlyPoints(transactions, monthCount, now);
}
