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
    accountRegisteredDetails: {
      upsert: vi.fn(),
    },
    accountCreditCardDetails: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { AppError } from '../middleware/error-handler';
import {
  getAccountById,
  getAccountCreditCardDetails,
  getAccountRegisteredDetails,
  getAllAccounts,
  updateAccountBalance,
  updateImportedAccountInstitution,
  upsertAccountCreditCardDetails,
  upsertAccountLoanDetails,
  upsertAccountRegisteredDetails,
} from './account.service';

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
      registeredDetails: null,
      creditCardDetails: null,
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
        registeredDetails: null,
        creditCardDetails: null,
        investmentDetails: null,
        savingsDetails: null,
        genericMetadata: null,
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
        registeredDetails: null,
        creditCardDetails: null,
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
        registeredDetails: null,
        creditCardDetails: null,
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
        registeredDetails: null,
        creditCardDetails: null,
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

  it('gets registered details with staleness', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'a-reg',
      registeredDetails: {
        accountId: 'a-reg',
        registrationType: 'RRSP',
        annualContributionLimit: new Decimal('31560'),
        totalContributionRoom: new Decimal('42000'),
        contributedThisYear: new Decimal('6000'),
        unusedCarryforward: new Decimal('36000'),
        beneficiaryName: null,
        beneficiaryDateOfBirth: null,
        grantRoomAvailable: null,
        grantsReceived: null,
        subscriptionLimit: null,
        verificationSource: 'CRA_NOTICE_OF_ASSESSMENT',
        lastVerifiedAt: new Date('2026-03-15T00:00:00.000Z'),
        notes: 'NOA',
        createdAt: new Date('2026-03-15T10:22:00.000Z'),
        updatedAt: new Date('2026-04-10T14:50:00.000Z'),
      },
    });

    const result = await getAccountRegisteredDetails('a-reg');

    expect(result).toEqual(
      expect.objectContaining({
        accountId: 'a-reg',
        registrationType: 'RRSP',
        annualContributionLimit: 31560,
        staleness: expect.objectContaining({
          isStale: false,
        }),
      }),
    );
  });

  it('upserts registered details and validates contribution room totals', async () => {
    prismaMock.account.findUnique
      .mockResolvedValueOnce({ id: 'a-reg' })
      .mockResolvedValueOnce({
        id: 'a-reg',
        registeredDetails: {
          accountId: 'a-reg',
          registrationType: 'RRSP',
          annualContributionLimit: new Decimal('31560'),
          totalContributionRoom: new Decimal('42000'),
          contributedThisYear: new Decimal('6000'),
          unusedCarryforward: new Decimal('36000'),
          beneficiaryName: null,
          beneficiaryDateOfBirth: null,
          grantRoomAvailable: null,
          grantsReceived: null,
          subscriptionLimit: null,
          verificationSource: 'CRA_NOTICE_OF_ASSESSMENT',
          lastVerifiedAt: new Date('2026-03-15T00:00:00.000Z'),
          notes: null,
          createdAt: new Date('2026-03-15T10:22:00.000Z'),
          updatedAt: new Date('2026-04-10T14:50:00.000Z'),
        },
      });
    prismaMock.accountRegisteredDetails.upsert.mockResolvedValue({ accountId: 'a-reg' });

    const result = await upsertAccountRegisteredDetails('a-reg', {
      registrationType: 'RRSP',
      annualContributionLimit: 31560,
      totalContributionRoom: 42000,
      contributedThisYear: 6000,
      unusedCarryforward: 36000,
      verificationSource: 'CRA_NOTICE_OF_ASSESSMENT',
      lastVerifiedAt: new Date('2026-03-15T00:00:00.000Z'),
    });

    expect(prismaMock.accountRegisteredDetails.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'a-reg' },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ accountId: 'a-reg' }));

    prismaMock.account.findUnique.mockResolvedValueOnce({ id: 'a-reg' });
    await expect(
      upsertAccountRegisteredDetails('a-reg', {
        registrationType: 'RRSP',
        totalContributionRoom: 40000,
        contributedThisYear: 6000,
        unusedCarryforward: 36000,
        lastVerifiedAt: new Date('2026-03-15T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects RESP upsert when beneficiary fields are incomplete', async () => {
    prismaMock.account.findUnique.mockResolvedValue({ id: 'a-resp' });

    await expect(
      upsertAccountRegisteredDetails('a-resp', {
        registrationType: 'RESP',
        beneficiaryName: 'Emma',
        beneficiaryDateOfBirth: null,
        lastVerifiedAt: new Date('2026-04-20T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('gets credit card details with utilization warning', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'a-cc',
      creditCardDetails: {
        accountId: 'a-cc',
        creditLimit: new Decimal('5000'),
        currentUtilization: new Decimal('45.5'),
        annualPercentageRate: new Decimal('19.99'),
        minimumPaymentDueDate: 21,
        lastStatementBalance: new Decimal('2275'),
        lastStatementDate: new Date('2026-04-15T00:00:00.000Z'),
        hasAnnualFee: true,
        annualFeeAmount: new Decimal('139'),
        rewardsProgram: 'CASH_BACK',
        rewardsRate: new Decimal('1.5'),
        rewardsRedeemedThisYear: new Decimal('120'),
        issuingBank: 'TD',
        cardType: 'CREDIT',
        verificationSource: 'INSTITUTION_STATEMENT',
        lastVerifiedAt: new Date('2026-04-15T00:00:00.000Z'),
        notes: 'TD Infinite Card',
        createdAt: new Date('2026-04-15T12:00:00.000Z'),
        updatedAt: new Date('2026-04-15T12:00:00.000Z'),
      },
    });

    const result = await getAccountCreditCardDetails('a-cc');

    expect(result).toEqual(
      expect.objectContaining({
        accountId: 'a-cc',
        currentUtilization: 45.5,
        utilization: {
          isHigh: true,
          warningMessage: 'Credit utilization at 45.5%. Maintaining above 30% utilization may impact credit score.',
        },
      }),
    );
  });

  it('upserts credit card details and validates utilization range', async () => {
    prismaMock.account.findUnique
      .mockResolvedValueOnce({ id: 'a-cc', type: 'CREDIT_CARD' })
      .mockResolvedValueOnce({
        id: 'a-cc',
        creditCardDetails: {
          accountId: 'a-cc',
          creditLimit: new Decimal('5000'),
          currentUtilization: new Decimal('45.5'),
          annualPercentageRate: new Decimal('19.99'),
          minimumPaymentDueDate: 21,
          lastStatementBalance: new Decimal('2275'),
          lastStatementDate: new Date('2026-04-15T00:00:00.000Z'),
          hasAnnualFee: true,
          annualFeeAmount: new Decimal('139'),
          rewardsProgram: 'CASH_BACK',
          rewardsRate: new Decimal('1.5'),
          rewardsRedeemedThisYear: new Decimal('120'),
          issuingBank: 'TD',
          cardType: 'CREDIT',
          verificationSource: 'INSTITUTION_STATEMENT',
          lastVerifiedAt: new Date('2026-04-15T00:00:00.000Z'),
          notes: null,
          createdAt: new Date('2026-04-15T12:00:00.000Z'),
          updatedAt: new Date('2026-04-15T12:00:00.000Z'),
        },
      });
    prismaMock.accountCreditCardDetails.upsert.mockResolvedValue({ accountId: 'a-cc' });

    const result = await upsertAccountCreditCardDetails('a-cc', {
      creditLimit: 5000,
      currentUtilization: 45.5,
      annualPercentageRate: 19.99,
      minimumPaymentDueDate: 21,
      lastStatementBalance: 2275,
      verificationSource: 'INSTITUTION_STATEMENT',
      lastVerifiedAt: new Date('2026-04-15T00:00:00.000Z'),
    });

    expect(prismaMock.accountCreditCardDetails.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'a-cc' },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ accountId: 'a-cc' }));

    prismaMock.account.findUnique.mockResolvedValueOnce({ id: 'a-cc', type: 'CREDIT_CARD' });
    await expect(
      upsertAccountCreditCardDetails('a-cc', {
        creditLimit: 5000,
        currentUtilization: 101,
        annualPercentageRate: 19.99,
        minimumPaymentDueDate: 21,
        lastVerifiedAt: new Date('2026-04-15T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
