import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    account: { findMany: vi.fn() },
    transaction: { findMany: vi.fn(), findFirst: vi.fn() },
    netWorthSnapshot: { findMany: vi.fn() },
    accountNetWorthSnapshot: { findMany: vi.fn() },
  },
}));

const { assetServiceMock } = vi.hoisted(() => ({
  assetServiceMock: {
    getTotalAssetValue: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('./asset.service', () => assetServiceMock);

import { getDashboardSummary, getSpendingByCategory, getTrends } from './dashboard.service';

describe('dashboard.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes dashboard summary totals', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      { type: 'CHECKING', balance: new Decimal('1000') },
      { type: 'CREDIT_CARD', balance: new Decimal('-200') },
    ]);
    assetServiceMock.getTotalAssetValue.mockResolvedValue(500);
    prismaMock.transaction.findMany.mockResolvedValue([
      { amount: new Decimal('200'), category: null },
      { amount: new Decimal('-50'), category: { name: 'Food', parent: { name: 'Food & Dining' } } },
      { amount: new Decimal('-100'), category: { name: 'Transfers', parent: { name: 'Financial' } } },
      { amount: new Decimal('-25'), category: { name: 'Investments', parent: { name: 'Income' } } },
    ]);

    const summary = await getDashboardSummary();

    expect(summary).toEqual({
      netWorth: 1300,
      totalAssets: 1500,
      totalLiabilities: 200,
      monthlyIncome: 200,
      monthlyExpenses: 50,
      monthlyNet: 150,
    });
  });

  it('uses snapshots for trends when snapshot count is sufficient', async () => {
    prismaMock.netWorthSnapshot.findMany.mockResolvedValue([
      { date: new Date('2026-01-01T00:00:00.000Z'), netWorth: new Decimal('100') },
      { date: new Date('2026-02-01T00:00:00.000Z'), netWorth: new Decimal('110') },
      { date: new Date('2026-03-01T00:00:00.000Z'), netWorth: new Decimal('120') },
    ]);
    prismaMock.transaction.findFirst.mockResolvedValue({ posted: new Date('2026-01-01T00:00:00.000Z') });

    const trends = await getTrends(2);

    expect(trends).toEqual([
      { date: '2026-01-01', value: 100 },
      { date: '2026-02-01', value: 110 },
      { date: '2026-03-01', value: 120 },
    ]);
  });

  it('falls back to transaction-derived trends when snapshots are sparse', async () => {
    prismaMock.netWorthSnapshot.findMany.mockResolvedValue([]);
    prismaMock.transaction.findFirst.mockResolvedValue({ posted: new Date('2026-01-01T00:00:00.000Z') });
    prismaMock.transaction.findMany.mockResolvedValue([
      { posted: new Date('2026-01-05T00:00:00.000Z'), amount: new Decimal('100') },
      { posted: new Date('2026-02-10T00:00:00.000Z'), amount: new Decimal('-30') },
    ]);

    const trends = await getTrends(2);

    expect(trends.length).toBe(3);
    expect(trends[2].value).toBe(70);
  });

  it('groups spending by category including uncategorized and excluding non-expense transfers', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { amount: new Decimal('-12.5'), category: { id: 'c1', name: 'Food', icon: 'Utensils', color: 'blue', parent: { name: 'Food & Dining' } } },
      { amount: new Decimal('-7.5'), category: { id: 'c1', name: 'Food', icon: 'Utensils', color: 'blue', parent: { name: 'Food & Dining' } } },
      { amount: new Decimal('-20'), category: null },
      { amount: new Decimal('-200'), category: { id: 'c2', name: 'Transfers', icon: 'ArrowRightLeft', color: 'slate', parent: { name: 'Financial' } } },
      { amount: new Decimal('-40'), category: { id: 'c3', name: 'Investments', icon: 'TrendingUp', color: 'emerald', parent: { name: 'Income' } } },
    ]);

    const spending = await getSpendingByCategory();

    expect(spending).toHaveLength(2);
    expect(spending).toEqual(
      expect.arrayContaining([
        {
          category: { id: null, name: 'Uncategorized', icon: 'HelpCircle', color: 'gray' },
          total: 20,
        },
        {
          category: { id: 'c1', name: 'Food', icon: 'Utensils', color: 'blue' },
          total: 20,
        },
      ]),
    );
  });
});
