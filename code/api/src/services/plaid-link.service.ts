import { Prisma } from '@prisma/client';
import {
  decryptRecoverySecret,
  decryptSecret,
  encryptRecoverySecret,
  encryptSecret,
  mapProviderAccountType,
  lockSyncQueue,
  normalizeText,
  validateCurrency,
  type BankProviderError,
  type EncryptedSecret,
  type ProviderAccountSnapshot,
} from '@doughray/shared';
import { getBankConfig, getBankEncryptionMaterial, getPlaidEnvironment, getPlaidProvider } from '../lib/bank-config';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error-handler';
import {
  bankConnectionNotFoundError,
  getBankConnectionDto,
} from './bank-dto';
import { enqueueSyncJob } from './sync-queue.service';

/**
 * Plaid Link lifecycle: create session-bound link attempts, exchange public
 * tokens idempotently, complete update-mode sessions, apply account mappings,
 * and run the tracked disconnect flow.
 *
 * Recovery design: after a public-token exchange succeeds (status EXCHANGED),
 * the access token is kept encrypted on the attempt until the connection row
 * (with its own encrypted token) is committed (status PERSISTED). A crashed or
 * retried completion resumes from the attempt instead of exchanging twice.
 */

const LINK_ATTEMPT_TTL_MS = 60 * 60 * 1000;
const OWNER_LABEL = 'doughray-owner';

type BankEnvironmentValue = 'SANDBOX' | 'PRODUCTION';
type LinkMode = 'NEW' | 'UPDATE';

function bankEnvironmentFromEnvName(env: 'sandbox' | 'production'): BankEnvironmentValue {
  return env === 'sandbox' ? 'SANDBOX' : 'PRODUCTION';
}

function requireConfiguredEnvironment(): BankEnvironmentValue {
  const env = getPlaidEnvironment();
  if (env === null) {
    throw new AppError(503, 'Plaid linking is not configured on this deployment.', 'PLAID_NOT_CONFIGURED');
  }
  return bankEnvironmentFromEnvName(env);
}

export function isProviderError(err: unknown): err is BankProviderError {
  return err instanceof Error && 'kind' in err && typeof (err as { kind?: unknown }).kind === 'string';
}

function serializeEncrypted(secret: EncryptedSecret): string {
  return JSON.stringify(secret);
}

function parseEncrypted(raw: string | null | undefined): EncryptedSecret | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EncryptedSecret>;
    if (
      typeof parsed.ciphertext === 'string'
      && typeof parsed.nonce === 'string'
      && typeof parsed.authTag === 'string'
    ) {
      return {
        ciphertext: parsed.ciphertext,
        nonce: parsed.nonce,
        authTag: parsed.authTag,
        keyVersion: typeof parsed.keyVersion === 'number' ? parsed.keyVersion : 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connection DTO (thin re-export so routes share one shape)
// ---------------------------------------------------------------------------

export type { BankConnectionDto } from './bank-dto';

// ---------------------------------------------------------------------------
// Token handling (server-only)
// ---------------------------------------------------------------------------

export async function decryptStoredToken(connectionId: string): Promise<string> {
  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      environment: true,
      externalItemId: true,
      tokenCiphertext: true,
      tokenNonce: true,
      tokenAuthTag: true,
      tokenKeyVersion: true,
    },
  });
  if (!connection) {
    throw bankConnectionNotFoundError();
  }
  if (!connection.tokenCiphertext || !connection.tokenNonce || !connection.tokenAuthTag) {
    throw new AppError(409, 'No stored provider token for this connection.', 'TOKEN_MISSING');
  }
  if (connection.environment !== requireConfiguredEnvironment()) {
    throw new AppError(409, 'Connection environment does not match configuration.', 'ENVIRONMENT_MISMATCH');
  }
  const encryption = getBankEncryptionMaterial();
  if (connection.tokenKeyVersion !== encryption.keyVersion) {
    throw new AppError(503, 'The connection encryption key version is unavailable.', 'TOKEN_KEY_VERSION_UNAVAILABLE');
  }
  try {
    return decryptSecret(
      {
        ciphertext: connection.tokenCiphertext,
        nonce: connection.tokenNonce,
        authTag: connection.tokenAuthTag,
        keyVersion: connection.tokenKeyVersion ?? encryption.keyVersion,
      },
      encryption.key,
      { provider: 'PLAID', environment: connection.environment, externalItemId: connection.externalItemId },
    );
  } catch {
    throw new AppError(
      503,
      'Stored provider token could not be decrypted. Verify BANK_TOKEN_ENCRYPTION_KEY and its version.',
      'TOKEN_DECRYPT_FAILED',
    );
  }
}

// ---------------------------------------------------------------------------
// Link attempts
// ---------------------------------------------------------------------------

export interface LinkAttemptInput {
  mode: LinkMode;
  connectionId?: string | null;
  linkSessionId?: string | null;
  /** Owner AuthSession id; associates the attempt with the logged-in session. */
  sessionId: string;
}

export interface LinkAttemptDto {
  attemptId: string;
  mode: LinkMode;
  connectionId: string | null;
  linkToken: string;
  expiresAt: string | null;
  requestId: string | null;
}

/** Deployment-side connection limit guard; not authoritative billing/quota info. */
async function assertWithinConnectionLimit(tx: Prisma.TransactionClient, environment: BankEnvironmentValue): Promise<void> {
  const settings = getBankConfig().plaid;
  if (!settings.connectionLimitEnforced || settings.connectionLimit === null) return;
  const lock = `plaid-connection-limit:${environment}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
  const activeCount = await tx.bankConnection.count({
    where: { provider: 'PLAID', environment, status: { not: 'DISCONNECTED' } },
  });
  const reserved = await tx.linkAttempt.count({ where: { provider: 'PLAID', environment, mode: 'NEW',
    status: { in: ['CREATED', 'EXCHANGED'] }, expiresAt: { gt: new Date() } } });
  if (activeCount + reserved >= settings.connectionLimit) {
    throw new AppError(
      409,
      `The configured Plaid connection limit (${settings.connectionLimit}) has been reached.`,
      'CONNECTION_LIMIT_REACHED',
    );
  }
}

function attemptExpiresAt(linkTokenExpiry: Date): Date {
  const cap = new Date(Date.now() + LINK_ATTEMPT_TTL_MS);
  return linkTokenExpiry.getTime() > cap.getTime() ? cap : linkTokenExpiry;
}

export async function createLinkAttempt(input: LinkAttemptInput): Promise<LinkAttemptDto> {
  const provider = getPlaidProvider();
  const environment = requireConfiguredEnvironment();
  const encryption = getBankEncryptionMaterial();

  if (input.mode === 'UPDATE') {
    const linkTargetConnectionId = input.connectionId;
    if (!linkTargetConnectionId) {
      throw new AppError(400, 'connectionId is required for update-mode link attempts.', 'VALIDATION_ERROR');
    }
    const connection = await prisma.bankConnection.findUnique({ where: { id: linkTargetConnectionId } });
    if (!connection || connection.provider !== 'PLAID') {
      throw bankConnectionNotFoundError();
    }
    if (connection.status === 'DISCONNECTED') {
      throw new AppError(409, 'This connection is disconnected. Link a new connection instead.', 'CONNECTION_DISCONNECTED');
    }
    if (!connection.tokenCiphertext) {
      throw new AppError(409, 'This connection has no stored provider token to update.', 'TOKEN_MISSING');
    }
  }

  const accessToken = input.mode === 'UPDATE'
    ? await decryptStoredToken(input.connectionId as string)
    : null;

  const attempt = await prisma.$transaction(async (tx) => {
    if (input.mode === 'NEW') await assertWithinConnectionLimit(tx, environment);
    return tx.linkAttempt.create({
    data: {
      sessionId: input.sessionId,
      mode: input.mode,
      provider: 'PLAID',
      environment,
      status: 'CREATED',
      expiresAt: new Date(Date.now() + LINK_ATTEMPT_TTL_MS),
      connectionId: input.mode === 'UPDATE' ? input.connectionId ?? null : null,
    },
    });
  });

  try {
    const result = await provider.createLinkToken({
      ownerLabel: OWNER_LABEL,
      updateAccessToken: accessToken,
      linkSessionId: input.linkSessionId ?? null,
    });
    const expiresAt = result.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000);
    const encryptedToken = encryptRecoverySecret(
      result.linkToken,
      encryption.key,
      encryption.keyVersion,
      `link-token:${attempt.id}`,
    );
    await prisma.linkAttempt.update({
      where: { id: attempt.id },
      data: {
        linkToken: serializeEncrypted(encryptedToken),
        linkTokenExpiresAt: expiresAt,
        requestId: result.requestId,
        expiresAt: attemptExpiresAt(expiresAt),
      },
    });
    return {
      attemptId: attempt.id,
      mode: input.mode,
      connectionId: input.mode === 'UPDATE' ? input.connectionId ?? null : null,
      linkToken: result.linkToken,
      expiresAt: expiresAt.toISOString(),
      requestId: result.requestId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Link token creation failed.';
    await prisma.linkAttempt
      .update({ where: { id: attempt.id }, data: { status: 'FAILED', error: message.slice(0, 500) } })
      .catch(() => undefined);
    if (isProviderError(err)) {
      throw new AppError(502, err.safeMessage, 'PLAID_ERROR');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Account mapping suggestions
// ---------------------------------------------------------------------------

export interface ProviderAccountSuggestion {
  externalAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  providerType: string | null;
  providerSubtype: string | null;
  currency: string | null;
  currentBalance: string | null;
  availableBalance: string | null;
  ignored: boolean;
  mappedAccountSourceId: string | null;
  suggestedAccountId: string | null;
  suggestionReason: string | null;
}

function localTypeFromMapping(accountType: string): string {
  switch (accountType) {
    case 'CHECKING': return 'CHECKING';
    case 'SAVINGS': return 'SAVINGS';
    case 'CREDIT_CARD': return 'CREDIT_CARD';
    case 'INVESTMENT': return 'INVESTMENT';
    case 'LOAN': return 'LOAN';
    case 'MORTGAGE': return 'MORTGAGE';
    default: return 'OTHER';
  }
}

interface SuggestionContext {
  externalItemId: string;
  institutionName: string | null;
  localAccounts: Array<{ id: string; name: string; institution: string | null; currency: string; type: string }>;
  existingSources: Array<{ id: string; externalAccountId: string; accountId: string }>;
  ignoredAccountIds?: string[];
}

/**
 * Suggest a local account for each provider account using advisory evidence
 * (institution, account class, currency). Names and masks alone never establish
 * identity — the owner confirms every mapping.
 */
export function suggestionFromSnapshot(
  snapshot: ProviderAccountSnapshot,
  context: SuggestionContext,
): ProviderAccountSuggestion {
  const existing = context.existingSources.find((source) => source.externalAccountId === snapshot.externalAccountId);
  const mappedAccountIds = new Set(
    existing ? [] : context.existingSources.map((source) => source.accountId),
  );
  const mappingType = mapProviderAccountType(snapshot.rawType, snapshot.rawSubtype).accountType;
  const localType = localTypeFromMapping(mappingType);

  const candidates = context.localAccounts
    .filter((account) => !mappedAccountIds.has(account.id))
    .filter((account) => snapshot.currency !== null && account.currency.toUpperCase() === snapshot.currency.toUpperCase())
    .filter((account) => account.type === localType);

  let suggestion: { id: string; reason: string } | null = null;
  const exactInstitution = candidates.find(
    (account) => account.institution !== null && context.institutionName !== null
      && account.institution.toLowerCase() === context.institutionName.toLowerCase(),
  );
  if (exactInstitution) {
    suggestion = { id: exactInstitution.id, reason: 'Institution, type and currency match' };
  } else if (candidates.length === 1) {
    suggestion = { id: candidates[0].id, reason: 'Only local account with matching type and currency' };
  }

  return {
    externalAccountId: snapshot.externalAccountId,
    name: snapshot.name,
    officialName: snapshot.officialName,
    mask: snapshot.mask,
    providerType: snapshot.rawType,
    providerSubtype: snapshot.rawSubtype,
    currency: snapshot.currency,
    currentBalance: snapshot.currentBalance,
    availableBalance: snapshot.availableBalance,
    ignored: context.ignoredAccountIds?.includes(snapshot.externalAccountId) ?? false,
    mappedAccountSourceId: existing?.id ?? null,
    suggestedAccountId: existing?.accountId ?? suggestion?.id ?? null,
    suggestionReason: existing ? 'Existing mapping' : suggestion?.reason ?? null,
  };
}

/** Fetch the authoritative account inventory for a Plaid connection. */
export async function fetchProviderInventory(connectionId: string): Promise<ProviderAccountSnapshot[]> {
  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, provider: true },
  });
  if (!connection) throw bankConnectionNotFoundError();
  if (connection.provider !== 'PLAID') {
    throw new AppError(400, 'Account inventory is only available for Plaid connections.', 'UNSUPPORTED_PROVIDER');
  }
  const provider = getPlaidProvider();
  const token = await decryptStoredToken(connectionId);
  return provider.listAccounts(token);
}

export interface InventorySuggestions {
  connectionId: string;
  environment: string;
  accounts: ProviderAccountSuggestion[];
}

/** Build owner-facing mapping suggestions for a connection's current inventory. */
export async function inventorySuggestions(connectionId: string): Promise<InventorySuggestions> {
  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      provider: true,
      environment: true,
      externalItemId: true,
      institutionName: true,
      status: true,
    },
  });
  if (!connection) throw bankConnectionNotFoundError();
  if (connection.provider !== 'PLAID') {
    throw new AppError(400, 'Account inventory is only available for Plaid connections.', 'UNSUPPORTED_PROVIDER');
  }

  const [snapshot, localAccounts, existingSources, ignoredAccounts] = await Promise.all([
    fetchProviderInventory(connectionId),
    prisma.account.findMany({
      where: { isActive: true },
      select: { id: true, name: true, institution: true, currency: true, type: true },
    }),
    prisma.accountSource.findMany({
      where: { connectionId, status: { not: 'REMOVED' } },
      select: { id: true, externalAccountId: true, accountId: true },
    }),
    prisma.ignoredBankAccount.findMany({ where: { connectionId }, select: { externalAccountId: true } }),
  ]);

  const accounts = snapshot.map((item) =>
    suggestionFromSnapshot(item, {
      externalItemId: connection.externalItemId,
      institutionName: connection.institutionName,
      localAccounts,
      existingSources,
      ignoredAccountIds: ignoredAccounts.map((account) => account.externalAccountId),
    }));

  return { connectionId: connection.id, environment: connection.environment, accounts };
}

// ---------------------------------------------------------------------------
// Initial link completion (idempotent exchange + persistence)
// ---------------------------------------------------------------------------

export interface ExchangeInput {
  attemptId: string;
  publicToken: string;
  sessionId: string;
  /** Link metadata hints only; verified server-side facts come from Plaid. */
  institutionName?: string | null;
  institutionId?: string | null;
}

export interface CompletableLinkResult {
  connection: Awaited<ReturnType<typeof getBankConnectionDto>>;
  accounts: ProviderAccountSuggestion[];
  duplicate: boolean;
}

export async function completeInitialLink(input: ExchangeInput): Promise<CompletableLinkResult> {
  const provider = getPlaidProvider();
  const environment = requireConfiguredEnvironment();
  const encryption = getBankEncryptionMaterial();

  const attempt = await prisma.linkAttempt.findUnique({ where: { id: input.attemptId } });
  if (!attempt || attempt.provider !== 'PLAID') {
    throw new AppError(404, 'Link attempt not found.', 'NOT_FOUND');
  }
  if (attempt.environment !== environment) {
    throw new AppError(409, 'Link attempt environment does not match the configured Plaid environment.', 'ENVIRONMENT_MISMATCH');
  }
  if (attempt.mode !== 'NEW') {
    throw new AppError(409, 'This attempt is an update-mode session. Use the link-complete endpoint.', 'WRONG_ATTEMPT_MODE');
  }
  if (attempt.sessionId !== input.sessionId) {
    throw new AppError(409, 'Link attempt belongs to a different session.', 'ATTEMPT_SESSION_MISMATCH');
  }

  // Idempotent completion: a retry after success returns the connection.
  if (attempt.status === 'PERSISTED' && attempt.connectionId) {
    return {
      connection: await getBankConnectionDto(attempt.connectionId),
      accounts: await fetchConnectionInventorySuggestions(attempt.connectionId),
      duplicate: true,
    };
  }
  if (attempt.status === 'FAILED' || attempt.status === 'CANCELLED') {
    throw new AppError(409, 'Link attempt already ended in a failure. Start a new session.', 'ATTEMPT_CLOSED');
  }
  if (attempt.status === 'CREATED' && attempt.expiresAt.getTime() <= Date.now()) {
    await prisma.linkAttempt
      .update({ where: { id: attempt.id }, data: { status: 'EXPIRED' } })
      .catch(() => undefined);
    throw new AppError(409, 'Link attempt expired. Start a new session.', 'ATTEMPT_EXPIRED');
  }

  let externalItemId: string;
  let accessToken: string;

  if (attempt.status === 'EXCHANGED') {
    // Recovery path: reuse the already-exchanged token instead of exchanging twice.
    const token = decryptRecoverySecret(
      parseEncrypted(attempt.recoveryPublicTokenCiphertext),
      encryption.key,
      `access-token:${attempt.id}`,
    );
    if (!attempt.exchangeSessionId || token === null) {
      throw new AppError(
        409,
        'Link attempt lost its exchange state and cannot be recovered. Start a new session.',
        'EXCHANGE_STATE_LOST',
      );
    }
    externalItemId = attempt.exchangeSessionId;
    accessToken = token;
  } else {
    const exchange = await provider.exchangePublicToken(input.publicToken).catch((err: unknown) => {
      if (isProviderError(err)) throw new AppError(502, err.safeMessage, 'PLAID_ERROR');
      throw err;
    });
    externalItemId = exchange.externalItemId;
    accessToken = exchange.accessToken;

    const duplicate = await prisma.bankConnection.findUnique({
      where: {
        provider_environment_externalItemId: {
          provider: 'PLAID',
          environment,
          externalItemId,
        },
      },
      select: { id: true, status: true },
    });
    if (duplicate && duplicate.status !== 'DISCONNECTED') {
      await prisma.linkAttempt
        .update({
          where: { id: attempt.id },
          data: { status: 'FAILED', error: 'A connection for this bank Item already exists.' },
        })
        .catch(() => undefined);
      throw new AppError(409, 'A connection for this bank Item already exists.', 'DUPLICATE_CONNECTION');
    }

    // Persist the exchanged token encrypted on the attempt before any database
    // failure can strand the Item; a retried completion resumes from this state.
    await prisma.linkAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'EXCHANGED',
        exchangeSessionId: externalItemId,
        institutionName: input.institutionName ? normalizeText(input.institutionName, 'description').slice(0, 120) : null,
        institutionId: input.institutionId ? normalizeText(input.institutionId, 'description').slice(0, 64) : null,
        requestId: exchange.requestId,
        recoveryPublicTokenCiphertext: serializeEncrypted(encryptRecoverySecret(
          accessToken,
          encryption.key,
          encryption.keyVersion,
          `access-token:${attempt.id}`,
        )),
      },
    });
  }

  const secret = encryptSecret(
    accessToken,
    encryption.key,
    encryption.keyVersion,
    { provider: 'PLAID', environment, externalItemId },
  );
  const institutionNameHint = input.institutionName
    ? normalizeText(input.institutionName, 'description').slice(0, 120)
    : null;

  let connectionId: string;
  try {
    connectionId = await prisma.$transaction(async (tx) => {
      const created = await tx.bankConnection.create({
        data: {
          provider: 'PLAID',
          environment,
          externalItemId,
          institutionName: institutionNameHint,
          tokenCiphertext: secret.ciphertext,
          tokenNonce: secret.nonce,
          tokenAuthTag: secret.authTag,
          tokenKeyVersion: secret.keyVersion,
          status: 'HEALTHY',
          transactionsInitialState: 'NOT_READY',
        },
      });
      await tx.linkAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'PERSISTED',
          connectionId: created.id,
          completedAt: new Date(),
          // Temporary exchange state is no longer needed once persisted.
          recoveryPublicTokenCiphertext: null,
        },
      });
      await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId: created.id,
        payload: { reason: 'INITIAL_LINK' } }, tx);
      return created.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Lost a race with a concurrent completion; the winner persists the Item.
      await prisma.linkAttempt
        .update({
          where: { id: attempt.id },
          data: { status: 'FAILED', error: 'A concurrent attempt persisted this Item.' },
        })
        .catch(() => undefined);
      throw new AppError(409, 'A concurrent attempt persisted this Item.', 'DUPLICATE_CONNECTION');
    }
    throw err;
  }

  // Always make an initial sync call after creating the Item, even when the
  // account inventory fetch fails or no data is ready yet.
  const accounts = await fetchConnectionInventorySuggestions(connectionId).catch(() => [] as ProviderAccountSuggestion[]);
  return { connection: await getBankConnectionDto(connectionId), accounts, duplicate: false };
}

async function mappedSourceSuggestions(connectionId: string): Promise<ProviderAccountSuggestion[]> {
  const sources = await prisma.accountSource.findMany({
    where: { connectionId, status: { not: 'REMOVED' } },
    select: {
      id: true,
      externalAccountId: true,
      mask: true,
      officialName: true,
      providerType: true,
      providerSubtype: true,
      currency: true,
      availableBalance: true,
      accountId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return sources.map((source) => {
    const balance = source.availableBalance === null ? null : String(source.availableBalance);
    return {
      externalAccountId: source.externalAccountId,
      name: source.officialName ?? '(provider account)',
      officialName: source.officialName,
      mask: source.mask,
      providerType: source.providerType,
      providerSubtype: source.providerSubtype,
      currency: source.currency,
      currentBalance: balance,
      availableBalance: balance,
      ignored: false,
      mappedAccountSourceId: source.id,
      suggestedAccountId: source.accountId,
      suggestionReason: 'Existing mapping',
    };
  });
}

/** Inventory-based suggestions with failures surfaced as an empty list. */
async function fetchConnectionInventorySuggestions(connectionId: string): Promise<ProviderAccountSuggestion[]> {
  try {
    return (await inventorySuggestions(connectionId)).accounts;
  } catch (err) {
    if (isProviderError(err)) {
      await prisma.bankConnection
        .update({
          where: { id: connectionId },
          data: { healthDetail: `Account inventory pending: ${err.safeMessage.slice(0, 200)}` },
        })
        .catch(() => undefined);
      return [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Account mappings
// ---------------------------------------------------------------------------

export interface MappingInput {
  connectionId: string;
  sessionId: string;
  mappings: Array<{
    externalAccountId: string;
    action: 'MAP' | 'CREATE' | 'IGNORE';
    accountId?: string | null;
    label?: string | null;
    type?: string | null;
  }>;
}

/** Verify provider inventory and commit all account mappings together. */
export async function applyAccountMappings(input: MappingInput): Promise<Awaited<ReturnType<typeof getBankConnectionDto>>> {
  const connection = await prisma.bankConnection.findUnique({ where: { id: input.connectionId } });
  if (!connection || connection.provider !== 'PLAID' || connection.status === 'DISCONNECTED') throw bankConnectionNotFoundError();
  if (connection.environment !== requireConfiguredEnvironment()) throw new AppError(409, 'Connection environment does not match configuration.', 'ENVIRONMENT_MISMATCH');

  const inventory = await fetchProviderInventory(connection.id);
  const byId = new Map(inventory.map((account) => [account.externalAccountId, account]));
  const seen = new Set<string>();
  const localIds = new Set<string>();
  for (const mapping of input.mappings) {
    if (!mapping.externalAccountId || seen.has(mapping.externalAccountId)) throw new AppError(400, 'Every provider account must appear only once.', 'VALIDATION_ERROR');
    seen.add(mapping.externalAccountId);
    if (!byId.has(mapping.externalAccountId)) throw new AppError(409, 'The provider account is not in this connection.', 'ACCOUNT_UNAVAILABLE');
    if (mapping.action === 'MAP') {
      if (!mapping.accountId || localIds.has(mapping.accountId)) throw new AppError(400, 'Select a different local account for each provider account.', 'VALIDATION_ERROR');
      localIds.add(mapping.accountId);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Match the sync worker's job-before-connection lock order and enqueue in
    // this transaction, so a crash cannot leave a mapping without sync work.
    await lockSyncQueue(tx, 'CONNECTION_SYNC', connection.id);
    await tx.$queryRaw`SELECT id FROM "SyncJob" WHERE "connectionId" = ${connection.id}
      AND "jobType" = 'CONNECTION_SYNC' AND status IN ('QUEUED', 'RUNNING') ORDER BY id FOR UPDATE`;
    // Serialize mapping and fence syncs that used the old account inventory.
    const guarded = await tx.bankConnection.updateMany({
      where: { id: connection.id, version: connection.version, status: { not: 'DISCONNECTED' } },
      data: { version: { increment: 1 } },
    });
    if (guarded.count !== 1) throw new AppError(409, 'Connection changed; refresh and try again.', 'CONNECTION_CHANGED');
    const currentConnection = await tx.bankConnection.findUniqueOrThrow({ where: { id: connection.id }, select: { transactionCursor: true } });

    for (const mapping of input.mappings) {
      const snapshot = byId.get(mapping.externalAccountId)!;
      const existing = await tx.accountSource.findUnique({ where: { connectionId_externalAccountId: {
        connectionId: connection.id, externalAccountId: mapping.externalAccountId,
      } } });
      if (mapping.action === 'IGNORE') {
        if (existing) throw new AppError(409, 'A mapped account must be reconciled before it can be excluded.', 'ACCOUNT_ALREADY_MAPPED');
        await tx.ignoredBankAccount.upsert({ where: { connectionId_externalAccountId: { connectionId: connection.id, externalAccountId: mapping.externalAccountId } },
          create: { connectionId: connection.id, externalAccountId: mapping.externalAccountId }, update: {} });
        continue;
      }
      const currency = snapshot.currency;
      if (!currency) throw new AppError(409, 'The bank did not supply a supported currency for this account.', 'CURRENCY_UNAVAILABLE');
      if (existing) {
        if (mapping.action === 'MAP' && mapping.accountId === existing.accountId) continue;
        throw new AppError(409, 'This bank account is already mapped. Use reconciliation to change it.', 'ACCOUNT_ALREADY_MAPPED');
      }
      const ignored = await tx.ignoredBankAccount.findUnique({ where: { connectionId_externalAccountId: {
        connectionId: connection.id, externalAccountId: mapping.externalAccountId,
      } } });
      if (ignored && currentConnection.transactionCursor !== null) {
        throw new AppError(409, 'This account was excluded while sync advanced; its earlier history cannot be recovered from the current cursor. Link it separately and reconcile its history.', 'EXCLUDED_ACCOUNT_HISTORY_UNAVAILABLE');
      }
      await tx.ignoredBankAccount.deleteMany({ where: { connectionId: connection.id, externalAccountId: mapping.externalAccountId } });
      let accountId: string;
      if (mapping.action === 'MAP') {
        const account = await tx.account.findUnique({ where: { id: mapping.accountId! } });
        if (!account) throw new AppError(404, 'Local account not found.', 'NOT_FOUND');
        if (account.currency.toUpperCase() !== currency) throw new AppError(409, 'Account currencies do not match.', 'CURRENCY_MISMATCH');
        // A mapping is a candidate while the legacy ledger remains authoritative.
        const other = await tx.accountSource.findFirst({ where: { accountId: account.id, connection: { provider: 'PLAID' }, status: 'ACTIVE' } });
        if (other) throw new AppError(409, 'Another Plaid account is already mapped here.', 'ACCOUNT_AUTHORITY_CONFLICT');
        accountId = account.id;
      } else {
        if (snapshot.currentBalance === null || snapshot.balanceObservedAt === null) throw new AppError(409, 'The bank did not provide a current balance.', 'BALANCE_UNAVAILABLE');
        const mappedType = mapProviderAccountType(snapshot.rawType, snapshot.rawSubtype).accountType;
        const created = await tx.account.create({ data: {
          externalId: `plaid:${connection.id}:${mapping.externalAccountId}`,
          name: (mapping.label ?? snapshot.name).trim().slice(0, 120) || snapshot.name,
          institution: connection.institutionName, currency, type: prismaAccountType(mappedType),
          balance: snapshot.currentBalance, availableBalance: snapshot.availableBalance,
          balanceDate: snapshot.balanceObservedAt, ingestionState: 'ACTIVE',
        } });
        accountId = created.id;
      }
      const source = await tx.accountSource.create({ data: {
        connectionId: connection.id, accountId, externalAccountId: mapping.externalAccountId,
        mask: snapshot.mask, officialName: snapshot.officialName ?? snapshot.name,
        providerType: snapshot.rawType, providerSubtype: snapshot.rawSubtype, currency,
        status: 'ACTIVE', availableBalance: snapshot.availableBalance, balanceObservedAt: snapshot.balanceObservedAt,
      } });
      if (mapping.action === 'MAP') {
        // Even an empty legacy account requires an explicit cutover; SimpleFin
        // is paused immediately and the staged candidate cannot publish yet.
        await tx.account.update({ where: { id: accountId }, data: { ingestionState: 'MIGRATING', candidateSourceId: source.id } });
      }
    }
    await enqueueSyncJob({ jobType: 'CONNECTION_SYNC', trigger: 'MANUAL', connectionId: connection.id, payload: { reason: 'ACCOUNT_MAPPING' } }, tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return getBankConnectionDto(input.connectionId);
}

function prismaAccountType(accountType: string): 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN' | 'MORTGAGE' | 'OTHER' {
  const allowed = ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'LOAN', 'MORTGAGE', 'OTHER'] as const;
  if (!(allowed as readonly string[]).includes(accountType)) {
    throw new AppError(400, `Unsupported account type ${accountType}.`, 'VALIDATION_ERROR');
  }
  return accountType as (typeof allowed)[number];
}

// ---------------------------------------------------------------------------
// Update-mode completion
// ---------------------------------------------------------------------------

export interface LinkCompleteInput {
  connectionId: string;
  attemptId: string;
  sessionId: string;
  institutionName?: string | null;
}

export interface LinkCompleteResult {
  connection: Awaited<ReturnType<typeof getBankConnectionDto>>;
  newAccounts: ProviderAccountSuggestion[];
  removedSourceCount: number;
}

/** Update-mode completion: refetch health/accounts, fence in-flight work, resync. */
export async function completeUpdateLink(input: LinkCompleteInput): Promise<LinkCompleteResult> {
  const attempt = await prisma.linkAttempt.findUnique({ where: { id: input.attemptId } });
  if (!attempt || attempt.provider !== 'PLAID') {
    throw new AppError(404, 'Link attempt not found.', 'NOT_FOUND');
  }
  if (attempt.mode !== 'UPDATE' || attempt.connectionId !== input.connectionId) {
    throw new AppError(409, 'This attempt is not an update-mode session for this connection.', 'WRONG_ATTEMPT_MODE');
  }
  if (attempt.sessionId !== input.sessionId) {
    throw new AppError(409, 'Link attempt belongs to a different session.', 'ATTEMPT_SESSION_MISMATCH');
  }

  const connection = await prisma.bankConnection.findUnique({ where: { id: input.connectionId } });
  if (!connection || connection.provider !== 'PLAID') {
    throw bankConnectionNotFoundError();
  }
  if (connection.status === 'DISCONNECTED') {
    throw new AppError(409, 'This connection is disconnected. Link a new connection instead.', 'CONNECTION_DISCONNECTED');
  }
  const environment = requireConfiguredEnvironment();
  if (connection.environment !== environment) {
    throw new AppError(409, 'Connection environment does not match the configured Plaid environment.', 'ENVIRONMENT_MISMATCH');
  }

  // Update mode reuses the stored access token; health comes from the provider.
  const token = await decryptStoredToken(connection.id);
  const provider = getPlaidProvider();
  const inventory = await provider.listAccounts(token).catch((err: unknown) => {
    if (isProviderError(err)) {
      throw new AppError(502, err.safeMessage, 'PLAID_ERROR');
    }
    throw err;
  });
  const presentExternalIds = new Set(inventory.map((account) => account.externalAccountId));

  const existingSources = await prisma.accountSource.findMany({
    where: { connectionId: connection.id },
    select: { id: true, externalAccountId: true, status: true },
  });
  let removedSourceCount = 0;
  for (const source of existingSources) {
    if (!presentExternalIds.has(source.externalAccountId) && source.status !== 'REMOVED') {
      // Provider no longer returns this account: keep the row and its history
      // attached, but stop treating it as present.
      await prisma.accountSource.update({ where: { id: source.id }, data: { status: 'REMOVED' } });
      removedSourceCount += 1;
    }
  }

  const institutionNameHint = input.institutionName
    ? normalizeText(input.institutionName, 'description').slice(0, 120)
    : null;
  await prisma.$transaction([
    prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        // Version bump fences in-flight syncs that saw the previous inventory.
        version: { increment: 1 },
        status: 'HEALTHY',
        healthDetail: null,
        institutionName: institutionNameHint ?? connection.institutionName,
      },
    }),
    prisma.linkAttempt.update({
      where: { id: attempt.id },
      data: { status: 'PERSISTED', completedAt: new Date() },
    }),
  ]);

  await enqueueSyncJob({
    jobType: 'CONNECTION_SYNC',
    trigger: 'MANUAL',
    connectionId: connection.id,
    payload: { reason: 'UPDATE_MODE' as const },
  });

  const refreshed = await getBankConnectionDto(connection.id);
  const mappedExternalIds = new Set(refreshed.accounts.map((account) => account.externalAccountId));
  const [localAccounts, existingSourceRows] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      select: { id: true, name: true, institution: true, currency: true, type: true },
    }),
    prisma.accountSource.findMany({
      where: { connectionId: connection.id, status: { not: 'REMOVED' } },
      select: { id: true, externalAccountId: true, accountId: true },
    }),
  ]);
  const newAccounts = inventory
    .filter((account) => !mappedExternalIds.has(account.externalAccountId))
    .map((snapshot) => suggestionFromSnapshot(snapshot, {
      externalItemId: connection.externalItemId,
      institutionName: connection.institutionName,
      localAccounts,
      existingSources: existingSourceRows,
    }));
  return { connection: refreshed, newAccounts, removedSourceCount };
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export interface DisconnectResult {
  connection: Awaited<ReturnType<typeof getBankConnectionDto>>;
  retriable: boolean;
}

/**
 * Tracked disconnect: fence first, call the provider, delete the stored token
 * only after confirmed removal. Local history and audit data are retained;
 * deleting history is a separate explicit action.
 */
export async function disconnectConnection(connectionId: string): Promise<DisconnectResult> {
  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw bankConnectionNotFoundError();
  if (connection.provider !== 'PLAID') {
    throw new AppError(400, 'Disconnect is only supported for Plaid connections.', 'UNSUPPORTED_PROVIDER');
  }
  if (connection.status === 'DISCONNECTED') {
    return { connection: await getBankConnectionDto(connectionId), retriable: false };
  }
  if (!connection.tokenCiphertext || !connection.tokenNonce || !connection.tokenAuthTag) {
    throw new AppError(409, 'No stored provider token for this connection.', 'TOKEN_MISSING');
  }

  // Fencing bump: any in-flight job that loaded the previous version fails its
  // version check at commit and cannot publish after the disconnect.
  await prisma.bankConnection.update({
    where: { id: connectionId, version: connection.version },
    data: { version: { increment: 1 }, pausedAt: new Date() },
  });

  const token = await decryptStoredToken(connectionId);
  const provider = getPlaidProvider();
  try {
    await provider.removeItem(token);
  } catch (err) {
    if (isProviderError(err)) {
      await prisma.bankConnection
        .update({
          where: { id: connectionId },
          data: {
            status: 'ERROR',
            healthDetail: 'Provider removal failed; retry disconnect.',
            lastErrorCode: err.providerCode,
            lastErrorMessage: err.safeMessage.slice(0, 200),
            lastErrorAt: new Date(),
          },
        })
        .catch(() => undefined);
      return { connection: await getBankConnectionDto(connectionId), retriable: true };
    }
    throw err;
  }

  await finalizeDisconnect(connectionId);
  return { connection: await getBankConnectionDto(connectionId), retriable: false };
}

async function finalizeDisconnect(connectionId: string, healthDetail = 'Item removed from provider. Local history retained.'): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sources = await tx.accountSource.findMany({ where: { connectionId, status: 'ACTIVE' },
      select: { id: true, accountId: true, account: { select: { ingestionState: true, candidateSourceId: true } } } });
    await tx.bankConnection.update({
      where: { id: connectionId },
      data: {
        status: 'DISCONNECTED',
        healthDetail,
        // Removing the stored token prevents any further provider calls.
        tokenCiphertext: null,
        tokenNonce: null,
        tokenAuthTag: null,
        tokenKeyVersion: null,
        pausedAt: new Date(),
      },
    });
    // An unapproved migration can safely resume SimpleFin. After cutover, keep
    // ingestion paused: blindly restoring SimpleFin would duplicate Plaid-only rows.
    for (const source of sources) {
      const pendingMigration = source.account.ingestionState === 'MIGRATING' && source.account.candidateSourceId === source.id;
      await tx.account.update({ where: { id: source.accountId }, data: pendingMigration
        ? { ingestionState: 'ACTIVE', candidateSourceId: null }
        : { ingestionState: 'PAUSED' } });
    }
    await tx.accountSource.updateMany({
      where: { connectionId },
      data: { status: 'REMOVED' },
    });
    await tx.reconciliationCase.updateMany({ where: { connectionId, status: 'OPEN' }, data: { status: 'DISCARDED' } });
    await tx.syncBatch.updateMany({ where: { connectionId, status: 'STAGED' }, data: { status: 'DISCARDED', error: 'Connection disconnected.' } });
  });
}
