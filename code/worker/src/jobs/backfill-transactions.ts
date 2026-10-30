import prisma from '../lib/prisma';
import { fetchAccounts, fetchTransactionsForAccount } from '../lib/simplefin';

const WINDOW_DAYS = 90;

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function shiftDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

async function markSkippedAccountsComplete(skippedAccounts: Array<{ id: string; name: string }>): Promise<void> {
  if (skippedAccounts.length === 0) return;

  console.log(
    `[Backfill] Marking ${skippedAccounts.length} non-SimpleFin account(s) as complete: ${skippedAccounts
      .map((account) => account.name)
      .join(', ')}`,
  );
  await prisma.account.updateMany({
    where: { id: { in: skippedAccounts.map((account) => account.id) }, ingestionState: 'ACTIVE',
      accountSources: { none: { status: 'ACTIVE', connection: { provider: 'PLAID' } } } },
    data: {
      backfillCursor: null,
      backfillComplete: true,
      backfillUpdatedAt: new Date(),
    },
  });
}

async function backfillSingleAccount(account: {
  id: string;
  externalId: string;
  name: string;
  backfillCursor: Date | null;
}): Promise<void> {
  const windowEnd = account.backfillCursor ?? new Date();
  const windowStart = shiftDays(windowEnd, -(WINDOW_DAYS - 1));
  const startDate = toIsoDate(windowStart);
  const endDate = toIsoDate(windowEnd);

  console.log(`[Backfill] ${account.name}: ${startDate} -> ${endDate}`);
  const result = fetchTransactionsForAccount(account.externalId, startDate, endDate);

  if (!result.ok || !result.transactions) {
    throw new Error(result.error?.message || `Failed to backfill account ${account.name}`);
  }
  if (result.errors?.length) {
    console.warn(`[Backfill] ${account.name} warnings: ${result.errors.join(' | ')}`);
  }

  const accountTransactions = result.transactions.filter((tx) => tx.accountId === account.externalId);
  const nextCursor = shiftDays(windowStart, -1);
  const isExhausted = accountTransactions.length === 0 || nextCursor.getUTCFullYear() < 1970;
  const applied = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
    const current = await db.account.findUnique({ where: { id: account.id }, select: {
      ingestionState: true, accountSources: { where: { status: 'ACTIVE', connection: { provider: 'PLAID' } }, select: { id: true } },
    } });
    if (!current || current.ingestionState !== 'ACTIVE' || current.accountSources.length > 0) return false;
    for (const tx of accountTransactions) {
    await db.transaction.upsert({
      where: { externalId: tx.id },
      update: {
        amount: Number.parseFloat(tx.amount),
        description: tx.description,
        payee: tx.payee || null,
        memo: tx.memo || null,
      },
      create: {
        externalId: tx.id,
        accountId: account.id,
        posted: new Date(tx.posted * 1000),
        amount: Number.parseFloat(tx.amount),
        description: tx.description,
        payee: tx.payee || null,
        memo: tx.memo || null,
      },
    });
    }

  await db.account.update({
    where: { id: account.id },
    data: {
      backfillCursor: isExhausted ? null : nextCursor,
      backfillComplete: isExhausted,
      backfillUpdatedAt: new Date(),
    },
  });
  return true;
  }, { timeout: 120000 });
  if (!applied) return;

  if (isExhausted) {
    console.log(`[Backfill] ${account.name}: complete`);
  } else {
    console.log(
      `[Backfill] ${account.name}: imported ${accountTransactions.length}, next window ends ${toIsoDate(nextCursor)}`,
    );
  }
}

export async function backfillTransactions(): Promise<void> {
  console.log('[Backfill] Starting account backfill run...');

  const pendingAccounts = await prisma.account.findMany({
    where: { isActive: true, backfillComplete: false, ingestionState: 'ACTIVE',
      accountSources: { none: { status: 'ACTIVE', connection: { provider: 'PLAID' } } } },
    select: {
      id: true,
      externalId: true,
      name: true,
      backfillCursor: true,
    },
  });

  if (pendingAccounts.length === 0) {
    console.log('[Backfill] No accounts pending backfill');
    return;
  }

  const simpleFinAccounts = fetchAccounts();
  if (!simpleFinAccounts.ok || !simpleFinAccounts.accounts) {
    throw new Error(simpleFinAccounts.error?.message || 'Failed to fetch SimpleFin accounts');
  }
  const simpleFinAccountIds = new Set(simpleFinAccounts.accounts.map((account) => account.id));

  const accounts = pendingAccounts.filter((account) => simpleFinAccountIds.has(account.externalId));
  const skippedAccounts = pendingAccounts.filter((account) => !simpleFinAccountIds.has(account.externalId));

  await markSkippedAccountsComplete(skippedAccounts);

  if (accounts.length === 0) {
    console.log('[Backfill] No SimpleFin accounts pending backfill');
    return;
  }

  for (const account of accounts) {
    await backfillSingleAccount(account);
  }

  console.log('[Backfill] Account backfill run complete');
}
