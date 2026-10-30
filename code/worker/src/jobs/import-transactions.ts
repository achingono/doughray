import prisma from '../lib/prisma';
import { fetchAccounts, fetchTransactions, SFAccount } from '../lib/simplefin';

function inferAccountType(account: SFAccount): string {
  const name = account.name.toLowerCase();
  const balance = Number.parseFloat(account.balance);

  if (name.includes('credit') || name.includes('visa') || name.includes('mastercard')) return 'CREDIT_CARD';
  if (name.includes('saving')) return 'SAVINGS';
  if (name.includes('invest') || name.includes('brokerage') || name.includes('rrsp') || name.includes('tfsa')) return 'INVESTMENT';
  if (name.includes('mortgage')) return 'MORTGAGE';
  if (name.includes('loan') || name.includes('loc') || name.includes('line of credit')) return 'LOAN';
  if (name.includes('checking') || name.includes('chequing')) return 'CHECKING';
  if (balance < 0) return 'CREDIT_CARD';

  return 'CHECKING';
}

export async function importTransactions(): Promise<{ accountCount: number; transactionCount: number }> {
  console.log('[Import] Starting transaction import...');

  // Get the last successful sync to determine start date
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: 'SUCCESS' },
    orderBy: { startedAt: 'desc' },
  });
  const existingTransactionCount = await prisma.transaction.count();

  const defaultBackfillStart = new Date();
  defaultBackfillStart.setUTCDate(defaultBackfillStart.getUTCDate() - 90);

  const shouldBackfill = !lastSync || existingTransactionCount === 0;
  const startDate = shouldBackfill
    ? defaultBackfillStart.toISOString().split('T')[0] // SimpleFin caps to 90 days anyway
    : new Date(lastSync.startedAt.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 1 day overlap

  const syncLog = await prisma.syncLog.create({
    data: { status: 'RUNNING' },
  });

  try {
    const accountResult = fetchAccounts();
    if (!accountResult.ok || !accountResult.accounts) {
      throw new Error(accountResult.error?.message || 'Failed to fetch accounts');
    }

    const transactionResult = fetchTransactions(startDate);
    if (!transactionResult.ok || !transactionResult.transactions) {
      throw new Error(transactionResult.error?.message || 'Failed to fetch transactions');
    }
    if (transactionResult.errors?.length) {
      console.warn(`[Import] SimpleFin returned warnings: ${transactionResult.errors.join(' | ')}`);
    }

    let totalTransactions = 0;
    let totalAccounts = 0;
    for (const sfAccount of accountResult.accounts) {
      // Account mapping/cutover takes the same row lock. The old provider can
      // never publish after the account has entered migration or Plaid authority.
      const count = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE "externalId" = ${sfAccount.id} FOR UPDATE`;
        const existing = await tx.account.findUnique({ where: { externalId: sfAccount.id }, select: {
          id: true, ingestionState: true, accountSources: { where: { status: 'ACTIVE', connection: { provider: 'PLAID' } }, select: { id: true } },
        } });
        if (existing && (existing.ingestionState !== 'ACTIVE' || existing.accountSources.length > 0)) return null;
        const account = await tx.account.upsert({
          where: { externalId: sfAccount.id },
          update: {
            name: sfAccount.name, balance: Number.parseFloat(sfAccount.balance),
            availableBalance: sfAccount['available-balance'] ? Number.parseFloat(sfAccount['available-balance']) : null,
            balanceDate: new Date(sfAccount['balance-date'] * 1000), institution: sfAccount.org?.name || null,
            institutionDomain: sfAccount.org?.domain || null,
          },
          create: {
            externalId: sfAccount.id, name: sfAccount.name, currency: sfAccount.currency,
            type: inferAccountType(sfAccount) as any, balance: Number.parseFloat(sfAccount.balance),
            availableBalance: sfAccount['available-balance'] ? Number.parseFloat(sfAccount['available-balance']) : null,
            balanceDate: new Date(sfAccount['balance-date'] * 1000), institution: sfAccount.org?.name || null,
            institutionDomain: sfAccount.org?.domain || null,
          }, select: { id: true },
        });
        let imported = 0;
        for (const sfTx of transactionResult.transactions!.filter((item) => item.accountId === sfAccount.id)) {
          await tx.transaction.upsert({
            where: { externalId: sfTx.id },
            update: { amount: Number.parseFloat(sfTx.amount), description: sfTx.description, payee: sfTx.payee || null, memo: sfTx.memo || null },
            create: { externalId: sfTx.id, accountId: account.id, posted: new Date(sfTx.posted * 1000),
              amount: Number.parseFloat(sfTx.amount), description: sfTx.description, payee: sfTx.payee || null, memo: sfTx.memo || null },
          });
          imported++;
        }
        return imported;
      }, { timeout: 120000 });
      if (count !== null) { totalAccounts++; totalTransactions += count; }
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'SUCCESS',
        accountCount: totalAccounts,
        transactionCount: totalTransactions,
        completedAt: new Date(),
      },
    });

    console.log(`[Import] Imported ${accountResult.accounts.length} accounts, ${totalTransactions} transactions`);
    return { accountCount: totalAccounts, transactionCount: totalTransactions };
  } catch (err) {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'FAILED',
        errorMessage: String(err),
        completedAt: new Date(),
      },
    });
    console.error('[Import] Failed:', err);
    throw err;
  }
}
