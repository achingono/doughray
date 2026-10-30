import { prisma } from '../lib/prisma';
import { normalizePayee } from '../lib/normalize-payee';
import { AppError } from '../middleware/error-handler';

export type RecategorizeScope = 'single-instance' | 'all-past' | 'all-future' | 'all-past-and-future';

interface BaseTransaction {
  id: string;
  accountId: string;
  posted: Date;
  description: string;
  payee: string | null;
  categoryId: string | null;
  isReviewed: boolean;
  categoryRuleId: string | null;
}

export interface RecategorizePreview {
  normalizedPayee: string;
  scope: RecategorizeScope;
  eligiblePastCount: number;
  sample: Array<{ id: string; posted: Date; amount: number; description: string; payee: string | null; categoryId: string | null }>;
  existingRule: { id: string; categoryId: string; accountId: string | null } | null;
}

export interface RecategorizeResult {
  transactionId: string;
  categoryId: string;
  scope: RecategorizeScope;
  normalizedPayee: string;
  appliedPastCount: number;
  futureRule: { id: string; categoryId: string; accountId: string | null } | null;
}

function isManualOverride(transaction: { isReviewed: boolean; categoryRuleId: string | null }): boolean {
  return transaction.isReviewed && transaction.categoryRuleId === null;
}

async function ensureLeafCategory(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, children: { select: { id: true }, take: 1 } },
  });
  if (!category) {
    throw new AppError(404, 'Category not found', 'NOT_FOUND');
  }
  if (category.children.length > 0) {
    throw new AppError(400, 'Select a leaf category', 'VALIDATION_ERROR');
  }
}

async function getTargetTransaction(id: string): Promise<BaseTransaction> {
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    select: {
      id: true,
      accountId: true,
      posted: true,
      description: true,
      payee: true,
      categoryId: true,
      isReviewed: true,
      categoryRuleId: true,
    },
  });

  if (!transaction) {
    throw new AppError(404, 'Transaction not found', 'NOT_FOUND');
  }

  return transaction;
}

async function findMatchingPastTransactions(target: BaseTransaction, normalizedPayee: string) {
  const candidates = await prisma.transaction.findMany({
    where: {
      status: 'POSTED',
      accountId: target.accountId,
      posted: { lte: target.posted },
    },
    select: {
      id: true,
      posted: true,
      amount: true,
      description: true,
      payee: true,
      categoryId: true,
      isReviewed: true,
      categoryRuleId: true,
    },
    orderBy: { posted: 'desc' },
  });

  return candidates.filter((candidate) => {
    const key = normalizePayee(candidate.payee || candidate.description);
    if (key !== normalizedPayee) return false;
    if (candidate.id === target.id) return true;
    if (isManualOverride(candidate)) return false;
    return true;
  });
}

export async function getRecategorizePreview(transactionId: string, scope: RecategorizeScope): Promise<RecategorizePreview> {
  const target = await getTargetTransaction(transactionId);
  const normalizedPayee = normalizePayee(target.payee || target.description);
  if (normalizedPayee === 'unknown-merchant') {
    throw new AppError(400, 'Cannot apply recurring scope to unidentifiable payee', 'VALIDATION_ERROR');
  }

  const [existingRule, matchingPast] = await Promise.all([
    prisma.categoryRule.findUnique({
      where: {
        normalizedPayee_accountId: {
          normalizedPayee,
          accountId: target.accountId,
        },
      },
      select: { id: true, categoryId: true, accountId: true },
    }),
    scope === 'single-instance' || scope === 'all-future'
      ? Promise.resolve([])
      : findMatchingPastTransactions(target, normalizedPayee),
  ]);

  return {
    normalizedPayee,
    scope,
    eligiblePastCount: matchingPast.length,
    sample: matchingPast.slice(0, 5).map((tx) => ({
      id: tx.id,
      posted: tx.posted,
      amount: Number(tx.amount),
      description: tx.description,
      payee: tx.payee,
      categoryId: tx.categoryId,
    })),
    existingRule,
  };
}

export async function recategorizeTransaction(
  transactionId: string,
  categoryId: string,
  scope: RecategorizeScope,
): Promise<RecategorizeResult> {
  await ensureLeafCategory(categoryId);
  const target = await getTargetTransaction(transactionId);
  const normalizedPayee = normalizePayee(target.payee || target.description);

  if (normalizedPayee === 'unknown-merchant' && scope !== 'single-instance') {
    throw new AppError(400, 'Cannot apply recurring scope to unidentifiable payee', 'VALIDATION_ERROR');
  }

  const includePast = scope === 'all-past' || scope === 'all-past-and-future';
  const includeFuture = scope === 'all-future' || scope === 'all-past-and-future';

  let matchingPast: Array<{ id: string; isReviewed: boolean; categoryRuleId: string | null }> = [];
  if (includePast) {
    const rows = await findMatchingPastTransactions(target, normalizedPayee);
    matchingPast = rows.map((row) => ({
      id: row.id,
      isReviewed: row.isReviewed,
      categoryRuleId: row.categoryRuleId,
    }));
  }

  const futureRule = await prisma.$transaction(async (tx) => {
    const createdRule = includeFuture
      ? await tx.categoryRule.upsert({
          where: {
            normalizedPayee_accountId: {
              normalizedPayee,
              accountId: target.accountId,
            },
          },
          update: {
            categoryId,
            sourceTransactionId: target.id,
          },
          create: {
            normalizedPayee,
            categoryId,
            accountId: target.accountId,
            sourceTransactionId: target.id,
          },
          select: { id: true, categoryId: true, accountId: true },
        })
      : null;

    const targetUpdate = {
      categoryId,
      isReviewed: true,
      categoryRuleId: createdRule?.id ?? null,
    };

    await tx.transaction.update({
      where: { id: target.id },
      data: targetUpdate,
    });

    if (matchingPast.length > 0) {
      const eligiblePastIds = matchingPast
        .filter((row) => row.id === target.id || !isManualOverride(row))
        .map((row) => row.id)
        .filter((id) => id !== target.id);

      if (eligiblePastIds.length > 0) {
        await tx.transaction.updateMany({
          where: { id: { in: eligiblePastIds } },
          data: {
            categoryId,
            isReviewed: true,
            categoryRuleId: createdRule?.id ?? null,
          },
        });
      }
    }

    return createdRule;
  });

  return {
    transactionId: target.id,
    categoryId,
    scope,
    normalizedPayee,
    appliedPastCount: matchingPast.filter((row) => row.id !== target.id && !isManualOverride(row)).length,
    futureRule,
  };
}

