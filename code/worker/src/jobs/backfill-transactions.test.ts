import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    account: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      upsert: vi.fn(),
    },
  },
}));

const { simplefinMock } = vi.hoisted(() => ({
  simplefinMock: {
    fetchAccounts: vi.fn(),
    fetchTransactionsForAccount: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ default: prismaMock }));
vi.mock('../lib/simplefin', () => simplefinMock);

import { backfillTransactions } from './backfill-transactions';

describe('backfillTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.account.findUnique.mockResolvedValue({ ingestionState: 'ACTIVE', accountSources: [] });
  });

  it('marks non-SimpleFin accounts as complete and skips fetching them', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      {
        id: 'a-simplefin',
        externalId: 'ACT-123',
        name: 'SimpleFin Checking',
        backfillCursor: null,
      },
      {
        id: 'a-excel',
        externalId: 'excel-import:123:CAD',
        name: 'Excel Account',
        backfillCursor: null,
      },
    ]);
    simplefinMock.fetchAccounts.mockReturnValue({
      ok: true,
      accounts: [{ id: 'ACT-123' }],
    });
    simplefinMock.fetchTransactionsForAccount.mockReturnValue({
      ok: true,
      transactions: [],
    });

    await backfillTransactions();

    expect(simplefinMock.fetchTransactionsForAccount).toHaveBeenCalledTimes(1);
    expect(simplefinMock.fetchTransactionsForAccount).toHaveBeenCalledWith('ACT-123', expect.any(String), expect.any(String));
    expect(prismaMock.account.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['a-excel'] }, ingestionState: 'ACTIVE' }),
        data: expect.objectContaining({
          backfillCursor: null,
          backfillComplete: true,
        }),
      }),
    );
  });

  it('imports transactions for SimpleFin accounts', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      {
        id: 'a-simplefin',
        externalId: 'ACT-123',
        name: 'SimpleFin Checking',
        backfillCursor: new Date('2026-04-15T00:00:00.000Z'),
      },
    ]);
    simplefinMock.fetchAccounts.mockReturnValue({
      ok: true,
      accounts: [{ id: 'ACT-123' }],
    });
    simplefinMock.fetchTransactionsForAccount.mockReturnValue({
      ok: true,
      transactions: [
        {
          id: 'tx-1',
          accountId: 'ACT-123',
          posted: 1776168000,
          amount: '-42.50',
          description: 'Coffee',
          payee: 'Cafe',
          memo: '',
        },
      ],
    });

    await backfillTransactions();

    expect(prismaMock.transaction.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.account.update).toHaveBeenCalledTimes(1);
  });
});
