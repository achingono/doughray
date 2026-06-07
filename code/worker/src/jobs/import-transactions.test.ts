import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    syncLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    account: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    transaction: {
      count: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

const { simplefinMock } = vi.hoisted(() => ({
  simplefinMock: {
    fetchAccounts: vi.fn(),
    fetchTransactions: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ default: prismaMock }));
vi.mock('../lib/simplefin', () => simplefinMock);

import { importTransactions } from './import-transactions';

describe('importTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates account balances without mutating loan metadata fields', async () => {
    prismaMock.syncLog.findFirst.mockResolvedValue({ startedAt: new Date('2026-04-22T00:00:00.000Z') });
    prismaMock.transaction.count.mockResolvedValue(12);
    prismaMock.syncLog.create.mockResolvedValue({ id: 'sync-1' });
    prismaMock.account.findUnique.mockResolvedValue({ id: 'a1' });
    prismaMock.transaction.upsert.mockResolvedValue({});

    simplefinMock.fetchAccounts.mockReturnValue({
      ok: true,
      accounts: [
        {
          id: 'ACT-1',
          name: 'Mortgage',
          currency: 'USD',
          balance: '-538830.46',
          'available-balance': '-538830.46',
          'balance-date': 1776124800,
          org: { name: 'Bank', domain: 'bank.test' },
        },
      ],
    });
    simplefinMock.fetchTransactions.mockReturnValue({
      ok: true,
      transactions: [
        {
          id: 'tx-1',
          accountId: 'ACT-1',
          accountName: 'Mortgage',
          currency: 'USD',
          posted: 1776124800,
          amount: '-1631.86',
          description: 'Mortgage payment',
          payee: 'Bank',
          memo: '',
        },
      ],
    });

    const result = await importTransactions();
    const [upsertArgs] = prismaMock.account.upsert.mock.calls[0];

    expect(result).toEqual({ accountCount: 1, transactionCount: 1 });
    expect(prismaMock.account.upsert).toHaveBeenCalledTimes(1);
    expect(upsertArgs.where).toEqual({ externalId: 'ACT-1' });
    expect(upsertArgs.update).not.toHaveProperty('loanDetails');
    expect(upsertArgs.create).not.toHaveProperty('loanDetails');
    expect(upsertArgs.update).not.toHaveProperty('registeredDetails');
    expect(upsertArgs.create).not.toHaveProperty('registeredDetails');
    expect(upsertArgs.update).not.toHaveProperty('creditCardDetails');
    expect(upsertArgs.create).not.toHaveProperty('creditCardDetails');
  });
});
