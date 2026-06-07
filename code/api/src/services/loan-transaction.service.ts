import { prisma } from '../lib/prisma';
import { decimalToNumber } from '../lib/types';
import { AppError } from '../middleware/error-handler';

export enum LoanTransactionRuleType {
  CATEGORY = 'CATEGORY',
  PAYEE = 'PAYEE',
}

const EXCLUDED_SOURCE_ACCOUNT_TYPES = ['LOAN', 'MORTGAGE'] as const;


// Workaround: Cast prisma to any for new models until Prisma client is regenerated
const db = prisma as any;

export interface LoanTransactionRuleInput {
  accountId: string;
  ruleType: LoanTransactionRuleType;
  categoryId?: string | null;
  normalizedPayee?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface LoanTransactionRuleOutput {
  id: string;
  accountId: string;
  ruleType: LoanTransactionRuleType;
  categoryId: string | null;
  normalizedPayee: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanTransactionOutput {
  id: string;
  ruleId: string;
  sourceTransactionId: string;
  linkedAccountId: string;
  amount: number;
  posted: Date;
  description: string;
  createdAt: Date;
  sourceTransaction: {
    id: string;
    description: string;
    payee: string | null;
    amount: number;
    posted: Date;
    account: { id: string; name: string };
    category: { id: string; name: string; icon: string | null; color: string | null } | null;
  };
}

function mapRule(rule: any): LoanTransactionRuleOutput {
  return {
    id: rule.id,
    accountId: rule.accountId,
    ruleType: rule.ruleType,
    categoryId: rule.categoryId,
    normalizedPayee: rule.normalizedPayee,
    description: rule.description,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function mapLoanTransaction(tx: any): LoanTransactionOutput {
  return {
    id: tx.id,
    ruleId: tx.ruleId,
    sourceTransactionId: tx.sourceTransactionId,
    linkedAccountId: tx.linkedAccountId,
    amount: decimalToNumber(tx.amount),
    posted: tx.posted,
    description: tx.description,
    createdAt: tx.createdAt,
    sourceTransaction: {
      id: tx.sourceTransaction.id,
      description: tx.sourceTransaction.description,
      payee: tx.sourceTransaction.payee,
      amount: decimalToNumber(tx.sourceTransaction.amount),
      posted: tx.sourceTransaction.posted,
      account: {
        id: tx.sourceTransaction.account.id,
        name: tx.sourceTransaction.account.name,
      },
      category: tx.sourceTransaction.category
        ? {
            id: tx.sourceTransaction.category.id,
            name: tx.sourceTransaction.category.name,
            icon: tx.sourceTransaction.category.icon,
            color: tx.sourceTransaction.category.color,
          }
        : null,
    },
  };
}

export async function getRulesForAccount(accountId: string): Promise<LoanTransactionRuleOutput[]> {
  const rules = await db.loanTransactionRule.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
  });
  return rules.map(mapRule);
}

export async function createRule(input: LoanTransactionRuleInput): Promise<LoanTransactionRuleOutput> {
  const account = await db.account.findUnique({
    where: { id: input.accountId },
    select: { id: true, type: true },
  });

  if (!account) {
    throw new AppError(404, 'Account not found', 'NOT_FOUND');
  }

  if (account.type !== 'LOAN' && account.type !== 'MORTGAGE') {
    throw new AppError(400, 'Loan transaction rules can only be created for LOAN or MORTGAGE accounts', 'VALIDATION_ERROR');
  }

  if (input.ruleType === 'CATEGORY' && !input.categoryId) {
    throw new AppError(400, 'categoryId is required for CATEGORY rule type', 'VALIDATION_ERROR');
  }

  if (input.ruleType === 'PAYEE' && !input.normalizedPayee) {
    throw new AppError(400, 'normalizedPayee is required for PAYEE rule type', 'VALIDATION_ERROR');
  }

  const rule = await db.loanTransactionRule.create({
    data: {
      accountId: input.accountId,
      ruleType: input.ruleType,
      categoryId: input.categoryId ?? null,
      normalizedPayee: input.normalizedPayee ?? null,
      description: input.description ?? null,
    },
  });

  return mapRule(rule);
}

export async function updateRule(ruleId: string, input: Partial<LoanTransactionRuleInput>): Promise<LoanTransactionRuleOutput> {
  const existing = await db.loanTransactionRule.findUnique({
    where: { id: ruleId },
  });

  if (!existing) {
    throw new AppError(404, 'Rule not found', 'NOT_FOUND');
  }

  const effectiveRuleType = input.ruleType ?? existing.ruleType;
  const effectiveCategoryId = input.categoryId !== undefined ? input.categoryId : existing.categoryId;
  const effectiveNormalizedPayee = input.normalizedPayee !== undefined ? input.normalizedPayee : existing.normalizedPayee;

  const updateData: any = {};
  if (input.ruleType !== undefined) updateData.ruleType = input.ruleType;
  if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;
  if (input.normalizedPayee !== undefined) updateData.normalizedPayee = input.normalizedPayee;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  if (effectiveRuleType === LoanTransactionRuleType.CATEGORY && !effectiveCategoryId) {
    throw new AppError(400, 'categoryId is required for CATEGORY rule type', 'VALIDATION_ERROR');
  }

  if (effectiveRuleType === LoanTransactionRuleType.PAYEE && !effectiveNormalizedPayee) {
    throw new AppError(400, 'normalizedPayee is required for PAYEE rule type', 'VALIDATION_ERROR');
  }

  const rule = await db.loanTransactionRule.update({
    where: { id: ruleId },
    data: updateData,
  });

  return mapRule(rule);
}

export async function deleteRule(ruleId: string): Promise<void> {
  const existing = await db.loanTransactionRule.findUnique({
    where: { id: ruleId },
    select: { id: true },
  });

  if (!existing) {
    throw new AppError(404, 'Rule not found', 'NOT_FOUND');
  }

  await db.loanTransactionRule.delete({
    where: { id: ruleId },
  });
}

export async function getTransactionsForAccount(accountId: string): Promise<LoanTransactionOutput[]> {
  const transactions = await db.loanTransaction.findMany({
    where: { linkedAccountId: accountId },
    include: {
      sourceTransaction: {
        include: {
          account: { select: { id: true, name: true } },
          category: { select: { id: true, name: true, icon: true, color: true } },
        },
      },
    },
    orderBy: { posted: 'desc' },
  });

  return transactions.map(mapLoanTransaction);
}

export async function runTrackingForAccount(accountId: string): Promise<number> {
  const rules = await db.loanTransactionRule.findMany({
    where: { accountId, isActive: true },
    include: { category: true },
  });

  if (rules.length === 0) {
    return 0;
  }

  const whereClauses: any[] = [];

  for (const rule of rules) {
    if (rule.ruleType === 'CATEGORY' && rule.categoryId) {
      whereClauses.push({
        AND: [
          { account: { type: { notIn: EXCLUDED_SOURCE_ACCOUNT_TYPES } } },
          { categoryId: rule.categoryId },
        ],
      });
    } else if (rule.ruleType === 'PAYEE' && rule.normalizedPayee) {
      whereClauses.push({
        AND: [
          { account: { type: { notIn: EXCLUDED_SOURCE_ACCOUNT_TYPES } } },
          {
            OR: [
              { description: { contains: rule.normalizedPayee, mode: 'insensitive' } },
              { payee: { contains: rule.normalizedPayee, mode: 'insensitive' } },
            ],
          },
        ],
      });
    }
  }

  if (whereClauses.length === 0) {
    return 0;
  }

  const sourceAccounts = await db.account.findMany({
    where: { type: { notIn: EXCLUDED_SOURCE_ACCOUNT_TYPES }, isActive: true },
    select: { id: true },
  });
  const sourceAccountIds = sourceAccounts.map((a: any) => a.id);

  const candidateTransactions = await db.transaction.findMany({
    where: {
      accountId: { in: sourceAccountIds },
      OR: whereClauses,
    },
    orderBy: { posted: 'desc' },
  });

  const existingTransactions = await db.loanTransaction.findMany({
    where: { linkedAccountId: accountId },
    select: { sourceTransactionId: true },
  });
  const existingTxIds = new Set(existingTransactions.map((t: any) => t.sourceTransactionId));

  let createdCount = 0;

  for (const tx of candidateTransactions) {
    if (existingTxIds.has(tx.id)) {
      continue;
    }

    const matchingRule = rules.find((r: any) =>
      r.ruleType === LoanTransactionRuleType.CATEGORY
        ? r.categoryId === tx.categoryId
        : r.normalizedPayee &&
          (tx.description.toLowerCase().includes(r.normalizedPayee.toLowerCase()) ||
            (tx.payee && tx.payee.toLowerCase().includes(r.normalizedPayee.toLowerCase())))
    );

    if (!matchingRule) {
      continue;
    }

    await db.loanTransaction.create({
      data: {
        ruleId: matchingRule.id,
        sourceTransactionId: tx.id,
        linkedAccountId: accountId,
        amount: tx.amount,
        posted: tx.posted,
        description: tx.description,
      },
    });
    createdCount++;
  }

  return createdCount;
}

export async function runTrackingForAllAccounts(): Promise<Record<string, number>> {
  const loanAccounts = await db.account.findMany({
    where: { type: { in: ['LOAN', 'MORTGAGE'] }, isActive: true },
    select: { id: true },
  });

  const results: Record<string, number> = {};

  for (const account of loanAccounts) {
    results[account.id] = await runTrackingForAccount(account.id);
  }

  return results;
}