import type { Account, Transaction, TransactionSource } from '@prisma/client';

/** Canonical provider facts; user-owned categories and review state are separate. */
export function transactionFacts(row: Transaction) {
  return { id: row.id, posted: row.posted.toISOString(), amount: row.amount.toString(), description: row.description,
    payee: row.payee, memo: row.memo, status: row.status, authorizedDate: row.authorizedDate?.toISOString() ?? null,
    isoCurrencyCode: row.isoCurrencyCode, replacementTransactionId: row.replacementTransactionId };
}

export function transactionAnnotations(row: Transaction) {
  return { categoryId: row.categoryId, categoryRuleId: row.categoryRuleId, isReviewed: row.isReviewed,
    categoryOwnership: row.categoryOwnership };
}

export function accountFacts(row: Account) {
  return { id: row.id, balance: row.balance.toString(), availableBalance: row.availableBalance?.toString() ?? null,
    balanceDate: row.balanceDate.toISOString() };
}

export function sourceFacts(row: TransactionSource) {
  return { id: row.id, externalTransactionId: row.externalTransactionId, transactionId: row.transactionId, status: row.status,
    pendingExternalId: row.pendingExternalId, pendingTransactionSourceId: row.pendingTransactionSourceId,
    sourceBatchId: row.sourceBatchId, observedFacts: row.observedFacts };
}
