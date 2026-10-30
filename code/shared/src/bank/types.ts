/**
 * Shared bank-provider contract.
 *
 * Provider identifiers are opaque, case-sensitive strings. They must never be
 * normalized, lower-cased or substituted for local Doughray ids.
 */

export type SyncChangeType = 'ADDED' | 'MODIFIED' | 'REMOVED';

/** Provider account snapshot fetched through a server-side accounts call. */
export interface ProviderAccountSnapshot {
  externalAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  /** Raw provider type string (e.g. "depository"). Never inferred from names. */
  rawType: string | null;
  /** Raw provider subtype (e.g. "checking"). */
  rawSubtype: string | null;
  currency: string | null;
  /** Current balance in Doughray representation (inflows positive), scaled decimal string or null when the bank omits it. */
  currentBalance: string | null;
  availableBalance: string | null;
  balanceObservedAt: Date | null;
  /** True when the provider marks an account unavailable (e.g. consent limits). */
  unavailable: boolean;
}

/** One normalized change from a provider sync. */
export interface NormalizedTransactionChange {
  changeType: SyncChangeType;
  externalAccountId: string;
  externalTransactionId: string;
  /** Provider lifecycle status, e.g. "pending" | "posted"; removed changes carry the removal notice. */
  providerStatus: string | null;
  /**
   * Amount in Doughray representation (inflows positive, outflows negative),
   * exact 2-decimal scaled string. For REMOVED changes this is informational.
   */
  amount: string;
  currency: string;
  /** Bank calendar date, date-only form (YYYY-MM-DD). */
  postedDate: string;
  /** Authorization date separately, when the provider reports one. */
  authorizedDate: string | null;
  /** Predecessor id when a posted record references the pending record it replaces. */
  pendingExternalId: string | null;
  sourceRevision: string | null;
  /** Restricted provider facts retained for reconciliation; never logged raw. */
  observedFacts: ProviderTransactionFacts;
  /** Restricted, allowlisted provider evidence used only for quarantine replay. */
  sourceEvidence?: PlaidRecordEvidence;
}

export interface PlaidRecordEvidence {
  fingerprint: string;
  changeType: 'ADDED' | 'MODIFIED';
  record: Record<string, unknown>;
}

export interface PlaidRecordRepair {
  fingerprint: string;
  ruleVersion: number;
  patch: { amount?: number; date?: string; name?: string; iso_currency_code?: string };
}

export interface ProviderTransactionFacts {
  /** Source-era fields kept verbatim for audit/reconciliation. */
  description: string;
  payee: string | null;
  memo: string | null;
  /** Provider amount with provider sign convention preserved. */
  providerAmount: string;
  merchantName: string | null;
  pendingTransactionId: string | null;
  categoryDetail: string | null;
  categoryConfidence: string | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
}

/** Result of one pagination step; the cursor is an opaque provider string. */
export interface ProviderSyncPage {
  changes: NormalizedTransactionChange[];
  nextCursor: string | null;
  hasMore: boolean;
  accountsSnapshot: ProviderAccountSnapshot[] | null;
  transactionsUpdateStatus: string | null;
}

/** Provider metadata about data availability. */
export interface ProviderCapabilities {
  canFetchInventory: boolean;
  canRefresh: boolean;
  /** True when the provider supplies explicit INITIAL/HISTORICAL update states. */
  reportsHistoryReadiness: boolean;
  refreshTooSoon?: boolean;
}

export interface ProviderLinkInitiateInput {
  /** Stable identifier the provider can map back to (Plaid requires legal_name). */
  ownerLabel: string;
  valuelinkSessionId?: string | null;
}

export interface ProviderLinkTokenResult {
  linkToken: string;
  expiresAt: Date | null;
  requestId: string | null;
}

export interface ProviderExchangeResult {
  externalItemId: string;
  accessToken: string;
  /** Provider diagnostic ids, safe to persist. */
  requestId: string | null;
}

export enum BankProviderErrorKind {
  TRANSIENT = 'TRANSIENT',
  RATE_LIMIT = 'RATE_LIMIT',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  CONSENT_REVOKED = 'CONSENT_REVOKED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  MUTATION_DURING_PAGINATION = 'MUTATION_DURING_PAGINATION',
  NOT_READY = 'NOT_READY',
  DISCONNECTED = 'DISCONNECTED',
  UNKNOWN = 'UNKNOWN',
}

/** Serialized error carrying provider diagnostics without tokens. */
export interface BankProviderError extends Error {
  kind: BankProviderErrorKind;
  providerCode: string | null;
  /** Safe, token-free message; suitable for logs and SyncJob rows. */
  safeMessage: string;
  requestId: string | null;
  retriable: boolean;
}

export function bankProviderError(
  kind: BankProviderErrorKind,
  providerCode: string | null,
  safeMessage: string,
  requestId: string | null = null,
): BankProviderError {
  const retriable =
    kind === BankProviderErrorKind.TRANSIENT ||
    kind === BankProviderErrorKind.RATE_LIMIT ||
    kind === BankProviderErrorKind.NOT_READY;
  const error = new Error(safeMessage) as BankProviderError;
  error.kind = kind;
  error.providerCode = providerCode;
  error.safeMessage = safeMessage;
  error.requestId = requestId;
  error.retriable = retriable;
  return error;
}

/** What the provider adapter needs to act on a stored connection. */
export interface ProviderConnectionView {
  /** Opaque local db id; providers never see it. */
  connectionId: string;
  externalItemId: string;
  environment: 'sandbox' | 'production';
  provider: 'SIMPLEFIN' | 'PLAID';
  /** Decrypted access token when the provider stores one. */
  accessToken: string | null;
}
