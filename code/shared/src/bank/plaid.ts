import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type AccountBase,
  type LinkTokenCreateRequest,
  type PlaidError,
  type RemovedTransaction,
  type Transaction,
  type TransactionsSyncResponse,
} from 'plaid';
import {
  BankProviderErrorKind,
  bankProviderError,
  type BankProviderError,
  type NormalizedTransactionChange,
  type ProviderAccountSnapshot,
  type ProviderCapabilities,
  type ProviderExchangeResult,
  type ProviderLinkTokenResult,
  type ProviderSyncPage,
  type ProviderTransactionFacts,
  type PlaidRecordEvidence,
  type PlaidRecordRepair,
} from './types';
import { createHash } from 'node:crypto';
import {
  convertInflowPositive,
  convertBalanceForAccountClass,
  mapProviderAccountType,
  normalizeText,
  validateCurrency,
  validateDateOnly,
  dateOnlyToUtcStorage,
  NormalizationError,
  NORMALIZATION_VERSION,
  QuarantinedProviderRecord,
} from './normalization';
import type { PlaidEnvName, PlaidSettings } from './config';

/**
 * Plaid adapter for the Transactions product. Server-only: holds client
 * credentials; must never be imported from browser code.
 *
 * Cursors are opaque provider strings and are never normalized or defaulted
 * (in particular, the adapter never initializes a cursor with `now`).
 */

const APP_CLIENT_NAME = 'Doughray';
const SYNC_PAGE_COUNT = 500;

export interface PlaidProviderDeps {
  settings: PlaidSettings;
  /** Injectable clock for tests. */
  now?: () => Date;
}

interface RawPlaidError {
  error_type?: string;
  error_code?: string | null;
  error_message?: string | null;
  request_id?: string | null;
}

export interface PlaidWebhookVerificationKeyResponse {
  key: {
    kid: string;
    kty: string;
    alg: string;
    use?: string;
    /** RSA fields */
    n?: string;
    e?: string;
    /** EC P-256 fields (webhook verification uses ES256) */
    crv?: string;
    x?: string;
    y?: string;
    expired_at?: number | null;
  };
}

export class PlaidProvider {
  private readonly settings: PlaidSettings;
  private readonly now: () => Date;
  private cachedClient: PlaidApi | null = null;

  constructor(deps: PlaidProviderDeps) {
    this.settings = deps.settings;
    this.now = deps.now ?? (() => new Date());
    if (this.settings.clientId === null || this.settings.secret === null || this.settings.env === null) {
      throw new Error('PlaidProvider requires PLAID_CLIENT_ID, PLAID_CLIENT_SECRET and a valid PLAID_ENV.');
    }
  }

  get environment(): PlaidEnvName {
    return this.settings.env as PlaidEnvName;
  }

  private client(): PlaidApi {
    if (this.cachedClient === null) {
      const configuration = new Configuration({
        basePath: PlaidEnvironments[this.settings.env as keyof typeof PlaidEnvironments],
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': this.settings.clientId,
            'PLAID-SECRET': this.settings.secret,
            'Plaid-Version': this.settings.apiVersion,
          },
        },
      });
      this.cachedClient = new PlaidApi(configuration);
    }
    return this.cachedClient;
  }

  private wrapError(operation: string, failure: unknown): BankProviderError {
    if (failure instanceof NormalizationError) throw failure;
    type AxiosLike = { response?: { status?: number; data?: RawPlaidError } };
    const asAxios = failure as AxiosLike;
    const rawError: RawPlaidError | undefined = asAxios?.response?.data;
    const status = asAxios?.response?.status;

    if (rawError && (typeof rawError.error_code === 'string' || typeof rawError.error_type === 'string')) {
      const code = typeof rawError.error_code === 'string' && /^[A-Z0-9_]{1,100}$/.test(rawError.error_code) ? rawError.error_code : null;
      const request = typeof rawError.request_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(rawError.request_id) ? rawError.request_id : null;
      const errorType = typeof rawError.error_type === 'string' && /^[A-Z0-9_]{1,100}$/.test(rawError.error_type) ? rawError.error_type : 'PLAID_ERROR';
      const message = `${operation}: ${errorType} ${code ?? 'UNKNOWN'}`;
      switch (code) {
        case 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION':
          return bankProviderError(BankProviderErrorKind.MUTATION_DURING_PAGINATION, code, message, request);
        case 'PRODUCT_NOT_READY':
          return bankProviderError(BankProviderErrorKind.NOT_READY, code, message, request);
        case 'RATE_LIMIT_ENABLED':
          return bankProviderError(BankProviderErrorKind.RATE_LIMIT, code, message, request);
        case 'ITEM_LOGIN_REQUIRED':
        case 'INVALID_CREDENTIALS':
        case 'INVALID_ACCESS_TOKEN':
        case 'ITEM_NOT_FOUND':
          return bankProviderError(BankProviderErrorKind.AUTH_REQUIRED, code, message, request);
        case 'USER_CONSENT_REVOKED':
          return bankProviderError(BankProviderErrorKind.CONSENT_REVOKED, code, message, request);
        default:
          break;
      }
      switch (rawError.error_type) {
        case 'RATE_LIMIT':
          return bankProviderError(BankProviderErrorKind.RATE_LIMIT, code, message, request);
        case 'SERVER_ERROR':
        case 'PLANNED_ERROR':
          return bankProviderError(BankProviderErrorKind.TRANSIENT, code, message, request);
        default:
          return bankProviderError(BankProviderErrorKind.INVALID_REQUEST, code, message, request);
      }
    }

    if (status !== undefined) {
      if (status === 429) {
        return bankProviderError(BankProviderErrorKind.RATE_LIMIT, 'HTTP_429', `${operation}: rate limited`, null);
      }
      if (status >= 500) {
        return bankProviderError(
          BankProviderErrorKind.TRANSIENT,
          `HTTP_${status}`,
          `${operation}: provider returned ${status}`,
          null,
        );
      }
    }
    // Network failures without a provider response are transient.
    return bankProviderError(BankProviderErrorKind.TRANSIENT, 'NETWORK', `${operation}: network failure`, null);
  }

  // ------------------------------------------------------------------
  // Link flows
  // ------------------------------------------------------------------

  async createLinkToken(input: {
    ownerLabel: string;
    updateAccessToken?: string | null;
    linkSessionId?: string | null;
  }): Promise<ProviderLinkTokenResult> {
    try {
      const request: LinkTokenCreateRequest = {
        client_name: APP_CLIENT_NAME,
        language: 'en',
        country_codes: this.settings.countryCodes as LinkTokenCreateRequest['country_codes'],
        user: { client_user_id: input.ownerLabel.slice(0, 128) },
        products: input.updateAccessToken ? undefined : (['transactions'] as LinkTokenCreateRequest['products']),
        transactions: input.updateAccessToken
          ? { days_requested: this.settings.transactionsDaysRequested }
          : { days_requested: this.settings.transactionsDaysRequested },
        webhook: this.settings.webhookUrl ?? undefined,
        redirect_uri: this.settings.redirectUri ?? undefined,
        access_token: input.updateAccessToken ?? undefined,
      };
      const response = await this.client().linkTokenCreate(request);
      return {
        linkToken: response.data.link_token,
        expiresAt: response.data.expiration ? new Date(response.data.expiration) : null,
        requestId: response.data.request_id ?? null,
      };
    } catch (failure) {
      throw this.wrapError('linkTokenCreate', failure);
    }
  }

  async exchangePublicToken(publicToken: string): Promise<ProviderExchangeResult> {
    try {
      const response = await this.client().itemPublicTokenExchange({ public_token: publicToken });
      return {
        externalItemId: response.data.item_id,
        accessToken: response.data.access_token,
        requestId: response.data.request_id ?? null,
      };
    } catch (failure) {
      throw this.wrapError('itemPublicTokenExchange', failure);
    }
  }

  // ------------------------------------------------------------------
  // Accounts & balances
  // ------------------------------------------------------------------

  async listAccounts(accessToken: string, excludedAccountIds: string[] = []): Promise<ProviderAccountSnapshot[]> {
    try {
      const response = await this.client().accountsGet({ access_token: accessToken });
      const excluded = new Set(excludedAccountIds);
      return response.data.accounts.filter((account) => !excluded.has(account.account_id)).map((account) => mapPlaidAccount(account, this.now));
    } catch (failure) {
      throw this.wrapError('accountsGet', failure);
    }
  }

  // ------------------------------------------------------------------
  // Transactions sync
  // ------------------------------------------------------------------

  /** One `/transactions/sync` page. Callers drive pagination until hasMore=false. */
  async syncPage(input: { accessToken: string; cursor: string | null; count?: number; repairs?: PlaidRecordRepair[]; excludedAccountIds?: string[] }): Promise<ProviderSyncPage> {
    try {
      const response = await this.client().transactionsSync({
        access_token: input.accessToken,
        cursor: input.cursor ?? undefined,
        count: input.count ?? SYNC_PAGE_COUNT,
        options: { include_personal_finance_category: true },
      });
      return mapSyncResponse(response.data as TransactionsSyncResponse, input.repairs ?? [], new Set(input.excludedAccountIds ?? []));
    } catch (failure) {
      throw this.wrapError('transactionsSync', failure);
    }
  }

  // ------------------------------------------------------------------
  // Item lifecycle
  // ------------------------------------------------------------------

  async removeItem(accessToken: string): Promise<{ removed: boolean; requestId: string | null }> {
    try {
      // A successful /item/remove call means the Item (and its tokens) are gone.
      const response = await this.client().itemRemove({ access_token: accessToken });
      return { removed: true, requestId: response.data.request_id ?? null };
    } catch (failure) {
      throw this.wrapError('itemRemove', failure);
    }
  }

  async refreshTransactions(accessToken: string): Promise<{ refreshed: boolean; requestId: string | null; tooSoon: boolean }> {
    try {
      const response = await this.client().transactionsRefresh({ access_token: accessToken });
      return { refreshed: true, requestId: response.data.request_id ?? null, tooSoon: false };
    } catch (failure) {
      const error = this.wrapError('transactionsRefresh', failure);
      if (error.kind === BankProviderErrorKind.RATE_LIMIT) {
        // Plaid reports refresh throttling; surface as "unsupported now".
        return { refreshed: false, requestId: error.requestId, tooSoon: true };
      }
      throw error;
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      canFetchInventory: true,
      canRefresh: this.settings.refreshEnabled,
      reportsHistoryReadiness: true,
    };
  }

  /** Enable the public webhook endpoint for an Item that linked before webhook was configured. */
  async updateWebhook(accessToken: string, webhookUrl: string): Promise<{ webhook: string | null; requestId: string | null }> {
    try {
      const response = await this.client().itemWebhookUpdate({ access_token: accessToken, webhook: webhookUrl });
      return { webhook: response.data.item.webhook ?? null, requestId: response.data.request_id ?? null };
    } catch (failure) {
      throw this.wrapError('itemWebhookUpdate', failure);
    }
  }

  async getWebhookVerificationKey(keyId: string): Promise<PlaidWebhookVerificationKeyResponse> {
    try {
      const response = await this.client().webhookVerificationKeyGet({ key_id: keyId });
      return response.data as unknown as PlaidWebhookVerificationKeyResponse;
    } catch (failure) {
      throw this.wrapError('webhookVerificationKeyGet', failure);
    }
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapPlaidAccount(account: AccountBase, now: () => Date): ProviderAccountSnapshot {
  const mapping = mapProviderAccountType(account.type, account.subtype ?? null);
  const providerCurrencyRaw = account.balances?.iso_currency_code ?? account.balances?.unofficial_currency_code ?? null;
  let currency: string | null = null;
  try {
    currency = validateCurrency(providerCurrencyRaw);
  } catch {
    // Keep account currency unknown marker; upstream must resolve via mapped account.
    currency = null;
  }

  const current = account.balances?.current ?? null;
  const available = account.balances?.available ?? null;
  const formatBalance = (value: number | null): string | null => {
    if (value === null) return null;
    try { return convertBalanceForAccountClass(trimNumberToDecimalString(value), mapping.accountType); }
    catch (error) { if (error instanceof NormalizationError) return null; throw error; }
  };
  const currentBalance = formatBalance(current);
  let availableBalance: string | null = null;
  if (available !== null) {
    try { availableBalance = trimNumberToDecimalString(available); }
    catch (error) { if (!(error instanceof NormalizationError)) throw error; }
  }

  const observedAt = account.balances?.last_updated_datetime
    ? new Date(account.balances.last_updated_datetime)
    : now();

  return {
    externalAccountId: account.account_id,
    name: normalizeText(account.name ?? 'Unnamed account', 'description').slice(0, 120),
    officialName: account.official_name ? normalizeText(account.official_name, 'payee') : null,
    mask: account.mask ?? null,
    rawType: account.type ?? null,
    rawSubtype: account.subtype ?? null,
    currency,
    currentBalance,
    // Available credit is buying power, not a liability balance.
    availableBalance,
    balanceObservedAt: observedAt,
    /** Balances optional per institution; `current === null` means unavailable. */
    unavailable: currentBalance === null,
  };
}

/**
 * Plaid returns JS numbers for amounts. To stay in exact-decimal land we serialize
 * to a plain decimal string with at most 2 fractional digits, rejecting any value
 * that would need rounding (unsupported precision → normalization error upstream).
 */
function trimNumberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new NormalizationError('AMOUNT_INVALID', 'amount or balance is not a finite number');
  }
  const exact = value.toFixed(2);
  // Guard against binary-float drift: only accept when the shortest round-trip
  // representation matches the 2dp form (i.e. the number really is 2dp).
  const shortest = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(shortest) && shortest !== Number(value.toFixed(2)).toString()) {
    throw new NormalizationError('AMOUNT_PRECISION_UNSUPPORTED', 'amount has unsupported precision');
  }
  return exact;
}

function recordEvidence(tx: Transaction, changeType: 'ADDED' | 'MODIFIED'): PlaidRecordEvidence {
  // Only fields required for normalization and review are retained; do not
  // persist the full Plaid response or any access credentials.
  const clip = (value: unknown) => typeof value === 'string' ? value.slice(0, 2048) : value ?? null;
  const original = { account_id: tx.account_id ?? null, transaction_id: tx.transaction_id ?? null, amount: tx.amount ?? null,
    date: tx.date ?? null, authorized_date: tx.authorized_date ?? null, name: tx.name ?? null, merchant_name: tx.merchant_name ?? null,
    original_description: tx.original_description ?? null, pending: tx.pending ?? null, pending_transaction_id: tx.pending_transaction_id ?? null,
    iso_currency_code: tx.iso_currency_code ?? null, unofficial_currency_code: tx.unofficial_currency_code ?? null,
    personal_finance_category: tx.personal_finance_category ? {
      primary: tx.personal_finance_category.primary ?? null, detailed: tx.personal_finance_category.detailed ?? null,
      confidence_level: tx.personal_finance_category.confidence_level ?? null,
    } : null };
  const record = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, clip(value)]));
  const fingerprint = createHash('sha256').update(JSON.stringify({ changeType, record: original })).digest('hex');
  return { fingerprint, changeType, record };
}

function mapSyncResponse(response: TransactionsSyncResponse, repairs: PlaidRecordRepair[], excluded: Set<string>): ProviderSyncPage {
  const changes: NormalizedTransactionChange[] = [];
  const map = (tx: Transaction, changeType: 'ADDED' | 'MODIFIED') => {
    const evidence = recordEvidence(tx, changeType);
    const repair = repairs.find((item) => item.fingerprint === evidence.fingerprint && item.ruleVersion === NORMALIZATION_VERSION);
    try {
      return { ...mapPlaidTransaction({ ...tx, ...(repair?.patch ?? {}) }, changeType), sourceEvidence: evidence };
    } catch (error) {
      if (error instanceof NormalizationError) throw new QuarantinedProviderRecord(error, evidence);
      throw error;
    }
  };
  for (const tx of response.added) {
    if (excluded.has(tx.account_id)) continue;
    changes.push(map(tx, 'ADDED'));
  }
  for (const tx of response.modified) {
    if (excluded.has(tx.account_id)) continue;
    changes.push(map(tx, 'MODIFIED'));
  }
  for (const removed of response.removed) {
    if (removed.account_id && excluded.has(removed.account_id)) continue;
    changes.push(mapRemovedTransaction(removed));
  }

  return {
    changes,
    nextCursor: response.next_cursor,
    hasMore: response.has_more,
    transactionsUpdateStatus: response.transactions_update_status ?? null,
    accountsSnapshot: Array.isArray(response.accounts) && response.accounts.length > 0
      ? response.accounts.filter((account) => !excluded.has(account.account_id)).map((account) => mapPlaidAccount(account, () => new Date()))
      : null,
  };
}

export function mapPlaidTransaction(
  tx: Transaction,
  changeType: 'ADDED' | 'MODIFIED',
): NormalizedTransactionChange {
  if (typeof tx.account_id !== 'string' || !tx.account_id || typeof tx.transaction_id !== 'string' || !tx.transaction_id) {
    throw new NormalizationError('IDENTITY_INVALID', 'transaction is missing a provider identity');
  }
  if (typeof tx.amount !== 'number' || !Number.isFinite(tx.amount)) {
    throw new NormalizationError('AMOUNT_INVALID', 'transaction is missing a valid amount');
  }
  if (!tx.date) throw new NormalizationError('DATE_INVALID', 'transaction is missing its date');
  const facts: ProviderTransactionFacts = {
    description: normalizeText(tx.name ?? '', 'description'),
    payee: tx.merchant_name ? normalizeText(tx.merchant_name, 'payee') : null,
    memo: tx.original_description ? normalizeText(tx.original_description, 'memo') : null,
    // Provider sign preserved verbatim; Doughray conversion happens below.
    providerAmount: trimNumberToDecimalString(tx.amount),
    merchantName: tx.merchant_name ?? null,
    pendingTransactionId: tx.pending_transaction_id ?? null,
    categoryDetail: tx.personal_finance_category?.detailed ?? tx.personal_finance_category?.primary ?? null,
    categoryConfidence: tx.personal_finance_category?.confidence_level ?? null,
    isoCurrencyCode: tx.iso_currency_code ?? null,
    unofficialCurrencyCode: tx.unofficial_currency_code ?? null,
  };

  return {
    changeType,
    externalAccountId: tx.account_id,
    externalTransactionId: tx.transaction_id,
    providerStatus: tx.pending ? 'PENDING' : 'POSTED',
    // Amount re-read once from the exact 2dp form so both fields share precision.
    amount: convertInflowPositive(trimNumberToDecimalString(tx.amount)),
    currency: validateCurrency(tx.iso_currency_code ?? tx.unofficial_currency_code),
    postedDate: validateDateOnly(tx.date) ?? '',
    authorizedDate: validateDateOnly(tx.authorized_date ?? null),
    pendingExternalId: !tx.pending ? tx.pending_transaction_id ?? null : null,
    sourceRevision: null,
    observedFacts: facts,
  };
}

function mapRemovedTransaction(removed: RemovedTransaction): NormalizedTransactionChange {
  return {
    changeType: 'REMOVED',
    externalAccountId: removed.account_id ?? '',
    externalTransactionId: removed.transaction_id,
    providerStatus: 'REMOVED',
    amount: '0.00',
    currency: '',
    // Removal notices carry no transaction metadata; local row already has the date.
    postedDate: '',
    authorizedDate: null,
    pendingExternalId: null,
    sourceRevision: null,
    observedFacts: {
      description: '',
      payee: null,
      memo: null,
      providerAmount: '0.00',
      merchantName: null,
      pendingTransactionId: null,
      categoryDetail: null,
      categoryConfidence: null,
      isoCurrencyCode: null,
      unofficialCurrencyCode: null,
    },
  };
}
