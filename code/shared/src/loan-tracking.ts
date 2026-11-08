import { Prisma } from '@prisma/client';

/** Rebuild derived loan links for changed source transactions in their publication transaction. */
export async function reconcileLoanTransactions(tx: Prisma.TransactionClient, transactionIds: string[], linkedAccountId?: string): Promise<void> {
  const ids = [...new Set(transactionIds)].sort();
  if (!ids.length) return;
  if (ids.length > 1000) {
    for (let offset = 0; offset < ids.length; offset += 1000) {
      await reconcileLoanTransactions(tx, ids.slice(offset, offset + 1000), linkedAccountId);
    }
    return;
  }
  // All callers lock source transactions before deriving links, including the
  // manual tracker, so concurrent category or provider changes cannot win late.
  await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const [transactions, rules, existing] = await Promise.all([
    tx.transaction.findMany({ where: { id: { in: ids } }, include: { account: { select: { type: true, isActive: true } } } }),
    tx.loanTransactionRule.findMany({ where: { isActive: true, ...(linkedAccountId ? { accountId: linkedAccountId } : {}),
      account: { isActive: true, type: { in: ['LOAN', 'MORTGAGE'] } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.loanTransaction.findMany({ where: { sourceTransactionId: { in: ids }, ...(linkedAccountId ? { linkedAccountId } : {}) } }),
  ]);
  const desired = new Map<string, { ruleId: string; sourceTransactionId: string; linkedAccountId: string;
    amount: Prisma.Decimal; posted: Date; description: string }>();
  for (const transaction of transactions) {
    if (transaction.status !== 'POSTED' || !transaction.account.isActive ||
        transaction.account.type === 'LOAN' || transaction.account.type === 'MORTGAGE' || !transaction.amount.lessThan(0)) continue;
    const matching = rules.filter((rule) => rule.ruleType === 'CATEGORY'
      ? !!rule.categoryId && rule.categoryId === transaction.categoryId
      : !!rule.normalizedPayee && [transaction.description, transaction.payee].some((text) => text?.toLowerCase().includes(rule.normalizedPayee!.toLowerCase())));
    const accountIds = [...new Set(matching.map((rule) => rule.accountId))];
    for (const accountId of accountIds) {
      const previous = existing.find((row) => row.sourceTransactionId === transaction.id && row.linkedAccountId === accountId);
      const rule = matching.find((item) => item.accountId === accountId && item.id === previous?.ruleId)
        ?? matching.find((item) => item.accountId === accountId)!;
      desired.set(`${transaction.id}\0${accountId}`, { ruleId: rule.id, sourceTransactionId: transaction.id, linkedAccountId: accountId,
        amount: transaction.amount, posted: transaction.posted, description: transaction.description });
    }
  }
  const obsolete = existing.filter((row) => !desired.has(`${row.sourceTransactionId}\0${row.linkedAccountId}`)).map((row) => row.id);
  if (obsolete.length) await tx.loanTransaction.deleteMany({ where: { id: { in: obsolete } } });
  for (const row of desired.values()) {
    await tx.loanTransaction.upsert({ where: { sourceTransactionId_linkedAccountId: {
      sourceTransactionId: row.sourceTransactionId, linkedAccountId: row.linkedAccountId,
    } }, create: row, update: { ruleId: row.ruleId, amount: row.amount, posted: row.posted, description: row.description } });
  }
}
