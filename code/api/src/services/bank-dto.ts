import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error-handler';

/**
 * Safe projections for bank models.
 *
 * Token material (ciphertext/nonce/auth tag/key version) is deliberately
 * excluded from the selects so it can never leak through a response. Local
 * account/transaction ids and opaque provider ids are fine to expose.
 */

export const bankConnectionSelection = {
  id: true,
  provider: true,
  environment: true,
  externalItemId: true,
  institutionName: true,
  status: true,
  healthDetail: true,
  consentExpiresAt: true,
  transactionsInitialState: true,
  transactionsHistoryState: true,
  transactionCursorUpdatedAt: true,
  lastSuccessfulSyncAt: true,
  lastErrorAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  pausedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BankConnectionSelect;

const accountSourceSelection = {
  id: true,
  externalAccountId: true,
  mask: true,
  officialName: true,
  providerType: true,
  providerSubtype: true,
  currency: true,
  status: true,
  availableBalance: true,
  balanceObservedAt: true,
  balanceStale: true,
  accountId: true,
  account: { select: { id: true, name: true, institution: true, currency: true, type: true } },
} satisfies Prisma.AccountSourceSelect;

export type BankConnectionWithSources = Prisma.BankConnectionGetPayload<{
  select: typeof bankConnectionSelection & { accountSources: { select: typeof accountSourceSelection } };
}>;

export interface BankAccountSourceDto {
  id: string;
  externalAccountId: string;
  mask: string | null;
  officialName: string | null;
  providerType: string | null;
  providerSubtype: string | null;
  currency: string;
  status: string;
  availableBalance: string | null;
  balanceObservedAt: string | null;
  balanceStale: boolean;
  mappedAccount: { id: string; name: string; institution: string | null; currency: string; type: string } | null;
}

export interface BankConnectionDto {
  id: string;
  provider: string;
  environment: string;
  institutionName: string | null;
  status: string;
  healthDetail: string | null;
  consentExpiresAt: string | null;
  transactionsInitialState: string | null;
  transactionsHistoryState: string | null;
  transactionCursorUpdatedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  pausedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  accounts: BankAccountSourceDto[];
}

export function connectionToDto(connection: Omit<BankConnectionWithSources, 'accountSources'> | BankConnectionWithSources): Omit<BankConnectionDto, 'accounts'> {
  return {
    id: connection.id,
    provider: connection.provider,
    environment: connection.environment,
    institutionName: connection.institutionName,
    status: connection.status,
    healthDetail: connection.healthDetail,
    consentExpiresAt: connection.consentExpiresAt ? connection.consentExpiresAt.toISOString() : null,
    transactionsInitialState: connection.transactionsInitialState,
    transactionsHistoryState: connection.transactionsHistoryState,
    transactionCursorUpdatedAt: connection.transactionCursorUpdatedAt ? connection.transactionCursorUpdatedAt.toISOString() : null,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt ? connection.lastSuccessfulSyncAt.toISOString() : null,
    lastErrorAt: connection.lastErrorAt ? connection.lastErrorAt.toISOString() : null,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    pausedAt: connection.pausedAt ? connection.pausedAt.toISOString() : null,
    version: connection.version,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export function connectionToDtoWithSources(connection: BankConnectionWithSources): BankConnectionDto {
  return {
    ...connectionToDto(connection),
    accounts: connection.accountSources.map((source) => ({
      id: source.id,
      externalAccountId: source.externalAccountId,
      mask: source.mask,
      officialName: source.officialName,
      providerType: source.providerType,
      providerSubtype: source.providerSubtype,
      currency: source.currency,
      status: source.status,
      availableBalance: source.availableBalance === null ? null : String(source.availableBalance),
      balanceObservedAt: source.balanceObservedAt ? source.balanceObservedAt.toISOString() : null,
      balanceStale: source.balanceStale,
      mappedAccount: source.account
        ? {
            id: source.account.id,
            name: source.account.name,
            institution: source.account.institution,
            currency: source.account.currency,
            type: source.account.type,
          }
        : null,
    })),
  };
}

export async function listBankConnections(provider?: 'SIMPLEFIN' | 'PLAID'): Promise<BankConnectionDto[]> {
  const connections = await prisma.bankConnection.findMany({
    where: provider ? { provider } : undefined,
    select: { ...bankConnectionSelection, accountSources: { select: accountSourceSelection, orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  return connections.map((connection) => connectionToDtoWithSources(connection));
}

export async function getBankConnectionRow(connectionId: string): Promise<BankConnectionWithSources> {
  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    select: { ...bankConnectionSelection, accountSources: { select: accountSourceSelection, orderBy: { createdAt: 'asc' } } },
  });
  if (!connection) {
    throw new AppError(404, 'Bank connection not found.', 'NOT_FOUND');
  }
  return connection;
}

export async function getBankConnectionDto(connectionId: string): Promise<BankConnectionDto> {
  return connectionToDtoWithSources(await getBankConnectionRow(connectionId));
}

export function bankConnectionNotFoundError(): AppError {
  return new AppError(404, 'Bank connection not found.', 'NOT_FOUND');
}
