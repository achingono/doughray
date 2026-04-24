import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    account: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    accountLoanDetails: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { AppError } from '../middleware/error-handler';
import { getAccountById, getAllAccounts, updateAccountBalance, updateImportedAccountInstitution, upsertAccountLoanDetails } from './account.service';

describe('account.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps account rows for getAllAccounts', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      {
        id: 'a1',
        name: 'Checking',
        institution: 'Bank',
        type: 'CHECKING',
        currency: 'USD',
        balance: new Decimal('100.25'),
        availableBalance: new Decimal('90.25'),
        balanceDate: new Date('2026-01-01T00:00:00.000Z'),
        _count: { transactions: 3 },
      },
    ]);

    const result = await getAllAccounts();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'a1',
        balance: 100.25,
        availableBalance: 90.25,
        transactionCount: 3,
      }),
    ]);
  });

  it('returns null when getAccountById misses', async () => {
    prismaMock.account.findUnique.mockResolvedValue(null);
    await expect(getAccountById('missing')).resolves.toBeNull();
  });

  it('maps account detail with recent transactions', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'a1',
      externalId: 'ext-1',
      name: 'Checking',
      institution: 'Bank',
      institutionDomain: 'bank.test',
      type: 'CHECKING',
      currency: 'USD',
      balance: new Decimal('100'),
      availableBalance: null,
      balanceDate: new Date('2026-01-02T00:00:00.000Z'),
      isActive: true,
      _count: { transactions: 1 },
      loanDetails: null,
      transactions: [
        {
          id: 't1',
          posted: new Date('2026-01-02T00:00:00.000Z'),
          amount: new Decimal('-12.5'),
          description: 'Coffee',
          payee: 'Cafe',
          category: { id: 'c1', name: 'Food', icon: 'Utensils', color: 'blue' },
        },
      ],
    });

    const result = await getAccountById('a1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'a1',
        loanDetails: null,
        transactionCount: 1,
        recentTransactions: [
          expect.objectContaining({
            id: 't1',
            amount: -12.5,
          }),
        ],
      }),
    );
  });

  it('updates an account balance and returns the refreshed detail', async () => {
    prismaMock.account.findUnique
      .mockResolvedValueOnce({ id: 'a1' })
      .mockResolvedValueOnce({
        id: 'a1',
        externalId: 'ext-1',
        name: 'Checking',
        institution: 'Bank',
        institutionDomain: null,
        type: 'CHECKING',
        currency: 'USD',
        balance: new Decimal('150'),
        availableBalance: new Decimal('140'),
        balanceDate: new Date('2026-04-14T00:00:00.000Z'),
        isActive: true,
        _count: { transactions: 0 },
        loanDetails: null,
        transactions: [],
      });
    prismaMock.account.update.mockResolvedValue({ id: 'a1' });

    const result = await updateAccountBalance('a1', {
      balance: 150,
      availableBalance: 140,
      balanceDate: new Date('2026-04-14T00:00:00.000Z'),
    });

    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: {
        balance: 150,
        availableBalance: 140,
        balanceDate: new Date('2026-04-14T00:00:00.000Z'),
      },
    });
    expect(result).toEqual(expect.objectContaining({ id: 'a1', balance: 150, availableBalance: 140 }));
  });

  it('returns null when updating a missing account balance', async () => {
    prismaMock.account.findUnique.mockResolvedValue(null);

    await expect(updateAccountBalance('missing', { balance: 10 })).resolves.toBeNull();
    expect(prismaMock.account.update).not.toHaveBeenCalled();
  });

  it('updates institution for imported accounts', async () => {
    prismaMock.account.findUnique
      .mockResolvedValueOnce({ id: 'a1', externalId: 'excel-import:123:CAD' })
      .mockResolvedValueOnce({
        id: 'a1',
        externalId: 'excel-import:123:CAD',
        name: 'Imported Account',
        institution: 'Broker A',
        institutionDomain: null,
        type: 'INVESTMENT',
        currency: 'CAD',
        balance: new Decimal('1000'),
        availableBalance: null,
        balanceDate: new Date('2026-04-14T00:00:00.000Z'),
        isActive: true,
        _count: { transactions: 0 },
        loanDetails: null,
        transactions: [],
      });
    prismaMock.account.update.mockResolvedValue({ id: 'a1' });

    const result = await updateImportedAccountInstitution('a1', { institution: 'Broker A' });

    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { institution: 'Broker A' },
    });
    expect(result).toEqual(expect.objectContaining({ id: 'a1', institution: 'Broker A' }));
  });

  it('rejects institution updates for non-imported accounts', async () => {
    prismaMock.account.findUnique.mockResolvedValue({ id: 'a1', externalId: 'ACT-123' });

    await expect(updateImportedAccountInstitution('a1', { institution: 'Bank X' })).rejects.toBeInstanceOf(AppError);
    expect(prismaMock.account.update).not.toHaveBeenCalled();
  });

  it('upserts loan details for liability accounts', async () => {
    prismaMock.account.findUnique
      .mockResolvedValueOnce({ id: 'a1', type: 'MORTGAGE' })
      .mockResolvedValueOnce({
        id: 'a1',
        externalId: 'ext-1',
        name: 'Mortgage',
        institution: 'Bank',
        institutionDomain: null,
        type: 'MORTGAGE',
        currency: 'USD',
        balance: new Decimal('-500000'),
        availableBalance: null,
        balanceDate: new Date('2026-04-14T00:00:00.000Z'),
        isActive: true,
        _count: { transactions: 0 },
        loanDetails: {
          accountId: 'a1',
          loanType: 'MORTGAGE',
          originalPrincipal: new Decimal('559000'),
          currentPrincipal: new Decimal('538830.46'),
          interestType: 'FIXED',
          interestRateAnnual: new Decimal('5.05'),
          paymentAmount: new Decimal('1631.86'),
          paymentFrequency: 'SEMI_MONTHLY',
          termStartDate: new Date('2024-08-01T00:00:00.000Z'),
          termMaturityDate: new Date('2027-08-01T00:00:00.000Z'),
          originalAmortizationMonths: 300,
          remainingAmortizationMonths: 279,
          renewalDate: new Date('2027-08-01T00:00:00.000Z'),
          notes: 'Manual import',
          lastVerifiedAt: new Date('2026-04-20T00:00:00.000Z'),
          source: 'USER_ENTERED',
          updatedBy: 'system',
          createdAt: new Date('2026-04-14T00:00:00.000Z'),
          updatedAt: new Date('2026-04-20T00:00:00.000Z'),
        },
        transactions: [],
      });
    prismaMock.accountLoanDetails.upsert.mockResolvedValue({ accountId: 'a1' });

    const result = await upsertAccountLoanDetails('a1', {
      loanType: 'MORTGAGE',
      originalPrincipal: 559000,
      currentPrincipal: 538830.46,
      interestType: 'FIXED',
      interestRateAnnual: 5.05,
      paymentAmount: 1631.86,
      paymentFrequency: 'SEMI_MONTHLY',
      originalAmortizationMonths: 300,
      remainingAmortizationMonths: 279,
      source: 'USER_ENTERED',
    });

    expect(prismaMock.accountLoanDetails.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'a1' },
        update: expect.objectContaining({ updatedBy: 'system' }),
        create: expect.objectContaining({ accountId: 'a1', updatedBy: 'system' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'a1',
        loanDetails: expect.objectContaining({
          loanType: 'MORTGAGE',
          originalPrincipal: 559000,
          currentPrincipal: 538830.46,
        }),
      }),
    );
  });

  it('rejects loan details updates for non-liability accounts', async () => {
    prismaMock.account.findUnique.mockResolvedValue({ id: 'a1', type: 'CHECKING' });

    await expect(
      upsertAccountLoanDetails('a1', {
        loanType: 'MORTGAGE',
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(prismaMock.accountLoanDetails.upsert).not.toHaveBeenCalled();
  });
});
