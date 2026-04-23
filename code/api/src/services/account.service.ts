import { prisma } from '../lib/prisma';
import { decimalToNumber, AccountWithStats } from '../lib/types';
import { AppError } from '../middleware/error-handler';
import { InterestType, LoanDetailSource, LoanType, PaymentFrequency } from '@prisma/client';

interface UpdateAccountBalanceInput {
  balance: number;
  availableBalance?: number | null;
  balanceDate?: Date;
}

interface UpdateImportedAccountInstitutionInput {
  institution: string;
}

export interface UpsertLoanDetailsInput {
  loanType: LoanType;
  originalPrincipal?: number | null;
  currentPrincipal?: number | null;
  interestType?: InterestType | null;
  interestRateAnnual?: number | null;
  paymentAmount?: number | null;
  paymentFrequency?: PaymentFrequency | null;
  termStartDate?: Date | null;
  termMaturityDate?: Date | null;
  originalAmortizationMonths?: number | null;
  remainingAmortizationMonths?: number | null;
  renewalDate?: Date | null;
  notes?: string | null;
  lastVerifiedAt?: Date | null;
  source?: LoanDetailSource;
}

function isImportedAccount(externalId: string): boolean {
  return externalId.startsWith('manual-import:') || externalId.startsWith('excel-import:');
}

function isLiabilityType(type: string): boolean {
  return type === 'CREDIT_CARD' || type === 'LOAN' || type === 'MORTGAGE';
}

export async function getAllAccounts(): Promise<AccountWithStats[]> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { transactions: true } },
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    type: a.type,
    currency: a.currency,
    balance: decimalToNumber(a.balance),
    availableBalance: a.availableBalance ? decimalToNumber(a.availableBalance) : null,
    balanceDate: a.balanceDate,
    transactionCount: a._count.transactions,
  }));
}

export async function getAccountById(id: string) {
  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      transactions: {
        orderBy: { posted: 'desc' },
        take: 20,
        include: { category: true },
      },
      loanDetails: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!account) return null;

  return {
    id: account.id,
    externalId: account.externalId,
    name: account.name,
    institution: account.institution,
    institutionDomain: account.institutionDomain,
    type: account.type,
    currency: account.currency,
    balance: decimalToNumber(account.balance),
    availableBalance: account.availableBalance ? decimalToNumber(account.availableBalance) : null,
    balanceDate: account.balanceDate,
    isActive: account.isActive,
    loanDetails: account.loanDetails
      ? {
          loanType: account.loanDetails.loanType,
          originalPrincipal: account.loanDetails.originalPrincipal === null ? null : decimalToNumber(account.loanDetails.originalPrincipal),
          currentPrincipal: account.loanDetails.currentPrincipal === null ? null : decimalToNumber(account.loanDetails.currentPrincipal),
          interestType: account.loanDetails.interestType,
          interestRateAnnual: account.loanDetails.interestRateAnnual === null ? null : decimalToNumber(account.loanDetails.interestRateAnnual),
          paymentAmount: account.loanDetails.paymentAmount === null ? null : decimalToNumber(account.loanDetails.paymentAmount),
          paymentFrequency: account.loanDetails.paymentFrequency,
          termStartDate: account.loanDetails.termStartDate,
          termMaturityDate: account.loanDetails.termMaturityDate,
          originalAmortizationMonths: account.loanDetails.originalAmortizationMonths,
          remainingAmortizationMonths: account.loanDetails.remainingAmortizationMonths,
          renewalDate: account.loanDetails.renewalDate,
          notes: account.loanDetails.notes,
          lastVerifiedAt: account.loanDetails.lastVerifiedAt,
          source: account.loanDetails.source,
          updatedBy: account.loanDetails.updatedBy,
          createdAt: account.loanDetails.createdAt,
          updatedAt: account.loanDetails.updatedAt,
        }
      : null,
    transactionCount: account._count.transactions,
    recentTransactions: account.transactions.map((t) => ({
      id: t.id,
      posted: t.posted,
      amount: decimalToNumber(t.amount),
      description: t.description,
      payee: t.payee,
      category: t.category ? { id: t.category.id, name: t.category.name, icon: t.category.icon, color: t.category.color } : null,
    })),
  };
}

export async function updateAccountBalance(id: string, input: UpdateAccountBalanceInput) {
  const existing = await prisma.account.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) return null;

  await prisma.account.update({
    where: { id },
    data: {
      balance: input.balance,
      availableBalance: input.availableBalance === undefined ? undefined : input.availableBalance,
      balanceDate: input.balanceDate ?? new Date(),
    },
  });

  return getAccountById(id);
}

export async function updateImportedAccountInstitution(id: string, input: UpdateImportedAccountInstitutionInput) {
  const existing = await prisma.account.findUnique({
    where: { id },
    select: { id: true, externalId: true },
  });

  if (!existing) return null;
  if (!isImportedAccount(existing.externalId)) {
    throw new AppError(400, 'Only imported accounts can update institution name', 'VALIDATION_ERROR');
  }

  await prisma.account.update({
    where: { id },
    data: {
      institution: input.institution.trim(),
    },
  });

  return getAccountById(id);
}

export async function upsertAccountLoanDetails(id: string, input: UpsertLoanDetailsInput) {
  const existing = await prisma.account.findUnique({
    where: { id },
    select: { id: true, type: true },
  });

  if (!existing) return null;
  if (!isLiabilityType(existing.type)) {
    throw new AppError(400, 'Loan details can only be updated for liability accounts', 'VALIDATION_ERROR');
  }

  await prisma.accountLoanDetails.upsert({
    where: { accountId: id },
    update: {
      loanType: input.loanType,
      originalPrincipal: input.originalPrincipal === undefined ? undefined : input.originalPrincipal,
      currentPrincipal: input.currentPrincipal === undefined ? undefined : input.currentPrincipal,
      interestType: input.interestType === undefined ? undefined : input.interestType,
      interestRateAnnual: input.interestRateAnnual === undefined ? undefined : input.interestRateAnnual,
      paymentAmount: input.paymentAmount === undefined ? undefined : input.paymentAmount,
      paymentFrequency: input.paymentFrequency === undefined ? undefined : input.paymentFrequency,
      termStartDate: input.termStartDate === undefined ? undefined : input.termStartDate,
      termMaturityDate: input.termMaturityDate === undefined ? undefined : input.termMaturityDate,
      originalAmortizationMonths: input.originalAmortizationMonths === undefined ? undefined : input.originalAmortizationMonths,
      remainingAmortizationMonths: input.remainingAmortizationMonths === undefined ? undefined : input.remainingAmortizationMonths,
      renewalDate: input.renewalDate === undefined ? undefined : input.renewalDate,
      notes: input.notes === undefined ? undefined : input.notes,
      lastVerifiedAt: input.lastVerifiedAt === undefined ? undefined : input.lastVerifiedAt,
      source: input.source ?? 'USER_ENTERED',
      updatedBy: 'system',
    },
    create: {
      accountId: id,
      loanType: input.loanType,
      originalPrincipal: input.originalPrincipal ?? null,
      currentPrincipal: input.currentPrincipal ?? null,
      interestType: input.interestType ?? null,
      interestRateAnnual: input.interestRateAnnual ?? null,
      paymentAmount: input.paymentAmount ?? null,
      paymentFrequency: input.paymentFrequency ?? null,
      termStartDate: input.termStartDate ?? null,
      termMaturityDate: input.termMaturityDate ?? null,
      originalAmortizationMonths: input.originalAmortizationMonths ?? null,
      remainingAmortizationMonths: input.remainingAmortizationMonths ?? null,
      renewalDate: input.renewalDate ?? null,
      notes: input.notes ?? null,
      lastVerifiedAt: input.lastVerifiedAt ?? null,
      source: input.source ?? 'USER_ENTERED',
      updatedBy: 'system',
    },
  });

  return getAccountById(id);
}
