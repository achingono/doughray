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

export type RegistrationType = 'RRSP' | 'TFSA' | 'RESP' | 'RIF' | 'RDSP';
export type RegistrationVerificationSource = 'CRA_NOTICE_OF_ASSESSMENT' | 'INSTITUTION_STATEMENT' | 'USER_ENTERED' | 'IMPORTED';
export type CreditCardRewardsProgram = 'NONE' | 'CASH_BACK' | 'POINTS' | 'MILES' | 'TRAVEL_CREDIT';
export type CreditCardType = 'CREDIT' | 'CHARGE' | 'SECURED';
export type CreditCardVerificationSource = 'INSTITUTION_STATEMENT' | 'USER_ENTERED' | 'SYNCED_FROM_ACCOUNT_AGGREGATOR';

export interface UpsertRegisteredDetailsInput {
  registrationType: RegistrationType;
  annualContributionLimit?: number;
  totalContributionRoom?: number;
  contributedThisYear?: number;
  unusedCarryforward?: number;
  beneficiaryName?: string | null;
  beneficiaryDateOfBirth?: Date | null;
  grantRoomAvailable?: number | null;
  grantsReceived?: number | null;
  subscriptionLimit?: number | null;
  verificationSource?: RegistrationVerificationSource;
  lastVerifiedAt: Date;
  notes?: string | null;
}

export interface UpsertCreditCardDetailsInput {
  creditLimit: number;
  currentUtilization: number;
  annualPercentageRate: number;
  minimumPaymentDueDate: number;
  lastStatementBalance?: number;
  lastStatementDate?: Date | null;
  hasAnnualFee?: boolean;
  annualFeeAmount?: number | null;
  rewardsProgram?: CreditCardRewardsProgram | null;
  rewardsRate?: number | null;
  rewardsRedeemedThisYear?: number | null;
  issuingBank?: string | null;
  cardType?: CreditCardType | null;
  verificationSource?: CreditCardVerificationSource;
  lastVerifiedAt: Date;
  notes?: string | null;
}

function isImportedAccount(externalId: string): boolean {
  return externalId.startsWith('manual-import:') || externalId.startsWith('excel-import:');
}

function isLiabilityType(type: string): boolean {
  return type === 'CREDIT_CARD' || type === 'LOAN' || type === 'MORTGAGE';
}

function toNonNegative(value: number | null | undefined, field: string) {
  if (value === null || value === undefined) return;
  if (value < 0) {
    throw new AppError(400, `${field} must be >= 0`, 'VALIDATION_ERROR');
  }
}

function calculateStaleness(lastVerifiedAt: Date) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const isDaysOld = Math.floor((Date.now() - lastVerifiedAt.getTime()) / MS_PER_DAY);
  const isStale = isDaysOld > 365;
  return {
    isDaysOld,
    isStale,
    warningMessage: isStale
      ? `Contribution room last verified ${isDaysOld} days ago. Please update from latest CRA Notice of Assessment.`
      : null,
  };
}

function calculateUtilization(currentUtilization: number) {
  const isHigh = currentUtilization > 30;
  return {
    isHigh,
    warningMessage: isHigh
      ? `Credit utilization at ${currentUtilization}%. Maintaining above 30% utilization may impact credit score.`
      : null,
  };
}

function mapRegisteredDetails(details: any) {
  return {
    accountId: details.accountId,
    registrationType: details.registrationType,
    annualContributionLimit: decimalToNumber(details.annualContributionLimit),
    totalContributionRoom: decimalToNumber(details.totalContributionRoom),
    contributedThisYear: decimalToNumber(details.contributedThisYear),
    unusedCarryforward: decimalToNumber(details.unusedCarryforward),
    beneficiaryName: details.beneficiaryName,
    beneficiaryDateOfBirth: details.beneficiaryDateOfBirth,
    grantRoomAvailable: details.grantRoomAvailable === null ? null : decimalToNumber(details.grantRoomAvailable),
    grantsReceived: details.grantsReceived === null ? null : decimalToNumber(details.grantsReceived),
    subscriptionLimit: details.subscriptionLimit === null ? null : decimalToNumber(details.subscriptionLimit),
    verificationSource: details.verificationSource,
    lastVerifiedAt: details.lastVerifiedAt,
    notes: details.notes,
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
  };
}

function mapCreditCardDetails(details: any) {
  return {
    accountId: details.accountId,
    creditLimit: decimalToNumber(details.creditLimit),
    currentUtilization: decimalToNumber(details.currentUtilization),
    annualPercentageRate: decimalToNumber(details.annualPercentageRate),
    minimumPaymentDueDate: details.minimumPaymentDueDate,
    lastStatementBalance: decimalToNumber(details.lastStatementBalance),
    lastStatementDate: details.lastStatementDate,
    hasAnnualFee: details.hasAnnualFee,
    annualFeeAmount: details.annualFeeAmount === null ? null : decimalToNumber(details.annualFeeAmount),
    rewardsProgram: details.rewardsProgram,
    rewardsRate: details.rewardsRate === null ? null : decimalToNumber(details.rewardsRate),
    rewardsRedeemedThisYear: details.rewardsRedeemedThisYear === null ? null : decimalToNumber(details.rewardsRedeemedThisYear),
    issuingBank: details.issuingBank,
    cardType: details.cardType,
    verificationSource: details.verificationSource,
    lastVerifiedAt: details.lastVerifiedAt,
    notes: details.notes,
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
  };
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
      registeredDetails: true,
      creditCardDetails: true,
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
    registeredDetails: account.registeredDetails ? mapRegisteredDetails(account.registeredDetails) : null,
    creditCardDetails: account.creditCardDetails ? mapCreditCardDetails(account.creditCardDetails) : null,
    investmentDetails: null,
    savingsDetails: null,
    genericMetadata: null,
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
      source: input.source === undefined ? undefined : input.source,
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

export async function getAccountRegisteredDetails(id: string) {
  const account = await prisma.account.findUnique({
    where: { id },
    select: { id: true, registeredDetails: true },
  });

  if (!account || !account.registeredDetails) {
    return null;
  }

  const mapped = mapRegisteredDetails(account.registeredDetails);
  return {
    ...mapped,
    staleness: calculateStaleness(mapped.lastVerifiedAt),
  };
}

export async function upsertAccountRegisteredDetails(id: string, input: UpsertRegisteredDetailsInput) {
  const existing = await prisma.account.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) return null;

  toNonNegative(input.annualContributionLimit, 'annualContributionLimit');
  toNonNegative(input.totalContributionRoom, 'totalContributionRoom');
  toNonNegative(input.contributedThisYear, 'contributedThisYear');
  toNonNegative(input.unusedCarryforward, 'unusedCarryforward');
  toNonNegative(input.grantRoomAvailable, 'grantRoomAvailable');
  toNonNegative(input.grantsReceived, 'grantsReceived');
  toNonNegative(input.subscriptionLimit, 'subscriptionLimit');

  const totalContributionRoom = input.totalContributionRoom ?? 0;
  const contributedThisYear = input.contributedThisYear ?? 0;
  const unusedCarryforward = input.unusedCarryforward ?? 0;

  if (contributedThisYear + unusedCarryforward > totalContributionRoom) {
    throw new AppError(
      400,
      `Contributed this year (${contributedThisYear}) + unused carryforward (${unusedCarryforward}) exceeds total contribution room (${totalContributionRoom})`,
      'VALIDATION_ERROR',
    );
  }

  const hasBeneficiaryName = input.beneficiaryName !== undefined && input.beneficiaryName !== null && input.beneficiaryName.trim().length > 0;
  const hasBeneficiaryDateOfBirth = input.beneficiaryDateOfBirth !== undefined && input.beneficiaryDateOfBirth !== null;

  if (input.registrationType === 'RESP' && (!hasBeneficiaryName || !hasBeneficiaryDateOfBirth)) {
    throw new AppError(400, 'RESP requires both beneficiaryName and beneficiaryDateOfBirth', 'VALIDATION_ERROR');
  }

  if (input.lastVerifiedAt.getTime() > Date.now()) {
    throw new AppError(400, 'lastVerifiedAt must be in the past', 'VALIDATION_ERROR');
  }

  await prisma.accountRegisteredDetails.upsert({
    where: { accountId: id },
    update: {
      registrationType: input.registrationType,
      annualContributionLimit: input.annualContributionLimit === undefined ? undefined : input.annualContributionLimit,
      totalContributionRoom: input.totalContributionRoom === undefined ? undefined : input.totalContributionRoom,
      contributedThisYear: input.contributedThisYear === undefined ? undefined : input.contributedThisYear,
      unusedCarryforward: input.unusedCarryforward === undefined ? undefined : input.unusedCarryforward,
      beneficiaryName: input.beneficiaryName === undefined ? undefined : input.beneficiaryName,
      beneficiaryDateOfBirth: input.beneficiaryDateOfBirth === undefined ? undefined : input.beneficiaryDateOfBirth,
      grantRoomAvailable: input.grantRoomAvailable === undefined ? undefined : input.grantRoomAvailable,
      grantsReceived: input.grantsReceived === undefined ? undefined : input.grantsReceived,
      subscriptionLimit: input.subscriptionLimit === undefined ? undefined : input.subscriptionLimit,
      verificationSource: input.verificationSource === undefined ? undefined : input.verificationSource,
      lastVerifiedAt: input.lastVerifiedAt,
      notes: input.notes === undefined ? undefined : input.notes,
    },
    create: {
      accountId: id,
      registrationType: input.registrationType,
      annualContributionLimit: input.annualContributionLimit ?? 0,
      totalContributionRoom: input.totalContributionRoom ?? 0,
      contributedThisYear: input.contributedThisYear ?? 0,
      unusedCarryforward: input.unusedCarryforward ?? 0,
      beneficiaryName: input.beneficiaryName ?? null,
      beneficiaryDateOfBirth: input.beneficiaryDateOfBirth ?? null,
      grantRoomAvailable: input.grantRoomAvailable ?? null,
      grantsReceived: input.grantsReceived ?? null,
      subscriptionLimit: input.subscriptionLimit ?? null,
      verificationSource: input.verificationSource ?? 'USER_ENTERED',
      lastVerifiedAt: input.lastVerifiedAt,
      notes: input.notes ?? null,
    },
  });

  return getAccountRegisteredDetails(id);
}

export async function getAccountCreditCardDetails(id: string) {
  const account = await prisma.account.findUnique({
    where: { id },
    select: { id: true, creditCardDetails: true },
  });

  if (!account || !account.creditCardDetails) {
    return null;
  }

  const mapped = mapCreditCardDetails(account.creditCardDetails);
  return {
    ...mapped,
    utilization: calculateUtilization(mapped.currentUtilization),
  };
}

export async function upsertAccountCreditCardDetails(id: string, input: UpsertCreditCardDetailsInput) {
  const existing = await prisma.account.findUnique({
    where: { id },
    select: { id: true, type: true },
  });

  if (!existing) return null;
  if (existing.type !== 'CREDIT_CARD') {
    throw new AppError(400, 'Credit card details can only be updated for credit card accounts', 'VALIDATION_ERROR');
  }

  if (input.creditLimit <= 0) {
    throw new AppError(400, 'Credit limit must be > 0', 'VALIDATION_ERROR');
  }
  if (input.currentUtilization < 0 || input.currentUtilization > 100) {
    throw new AppError(400, 'Utilization must be between 0 and 100', 'VALIDATION_ERROR');
  }
  if (input.annualPercentageRate < 0) {
    throw new AppError(400, 'APR must be >= 0', 'VALIDATION_ERROR');
  }
  if (input.minimumPaymentDueDate < 1 || input.minimumPaymentDueDate > 31) {
    throw new AppError(400, 'Due date must be between 1 and 31', 'VALIDATION_ERROR');
  }
  toNonNegative(input.lastStatementBalance, 'lastStatementBalance');
  toNonNegative(input.annualFeeAmount, 'annualFeeAmount');
  toNonNegative(input.rewardsRate, 'rewardsRate');
  toNonNegative(input.rewardsRedeemedThisYear, 'rewardsRedeemedThisYear');

  if (input.lastVerifiedAt.getTime() > Date.now()) {
    throw new AppError(400, 'lastVerifiedAt must be in the past', 'VALIDATION_ERROR');
  }

  await prisma.accountCreditCardDetails.upsert({
    where: { accountId: id },
    update: {
      creditLimit: input.creditLimit,
      currentUtilization: input.currentUtilization,
      annualPercentageRate: input.annualPercentageRate,
      minimumPaymentDueDate: input.minimumPaymentDueDate,
      lastStatementBalance: input.lastStatementBalance === undefined ? undefined : input.lastStatementBalance,
      lastStatementDate: input.lastStatementDate === undefined ? undefined : input.lastStatementDate,
      hasAnnualFee: input.hasAnnualFee === undefined ? undefined : input.hasAnnualFee,
      annualFeeAmount: input.annualFeeAmount === undefined ? undefined : input.annualFeeAmount,
      rewardsProgram: input.rewardsProgram === undefined ? undefined : input.rewardsProgram,
      rewardsRate: input.rewardsRate === undefined ? undefined : input.rewardsRate,
      rewardsRedeemedThisYear: input.rewardsRedeemedThisYear === undefined ? undefined : input.rewardsRedeemedThisYear,
      issuingBank: input.issuingBank === undefined ? undefined : input.issuingBank,
      cardType: input.cardType === undefined ? undefined : input.cardType,
      verificationSource: input.verificationSource === undefined ? undefined : input.verificationSource,
      lastVerifiedAt: input.lastVerifiedAt,
      notes: input.notes === undefined ? undefined : input.notes,
    },
    create: {
      accountId: id,
      creditLimit: input.creditLimit,
      currentUtilization: input.currentUtilization,
      annualPercentageRate: input.annualPercentageRate,
      minimumPaymentDueDate: input.minimumPaymentDueDate,
      lastStatementBalance: input.lastStatementBalance ?? 0,
      lastStatementDate: input.lastStatementDate ?? null,
      hasAnnualFee: input.hasAnnualFee ?? false,
      annualFeeAmount: input.annualFeeAmount ?? null,
      rewardsProgram: input.rewardsProgram ?? null,
      rewardsRate: input.rewardsRate ?? null,
      rewardsRedeemedThisYear: input.rewardsRedeemedThisYear ?? null,
      issuingBank: input.issuingBank ?? null,
      cardType: input.cardType ?? null,
      verificationSource: input.verificationSource ?? 'USER_ENTERED',
      lastVerifiedAt: input.lastVerifiedAt,
      notes: input.notes ?? null,
    },
  });

  return getAccountCreditCardDetails(id);
}
