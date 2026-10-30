/**
 * Deterministic, versioned transaction normalization shared by every ingestion
 * path (Plaid sync, SimpleFin import, reconciliation and replay).
 *
 * Rules (see docs/plaid-implementation-plan.md section 5):
 *  - Money is exact decimal arithmetic; Doughray inflows are positive and
 *    outflows negative, so provider amounts are negated (`amount = -provider`).
 *  - Precision beyond the database's DECIMAL(15,2) is rejected (quarantined),
 *    never silently lossy-rounded.
 *  - Dates are date-only bank calendar days; no timezone day shifts.
 *  - Readable text keeps case, meaningful numbers, accents and Unicode; only
 *    unicode form, control characters, whitespace and length are normalized.
 *  - Matching keys are conservative and built from ORIGINAL validated fields —
 *    never from the lossy normalizePayee() output or a display string.
 */

export const NORMALIZATION_VERSION = 1;

/** Limit identifying details in text sent to an external categorization model. */
export function sanitizeAiText(value: string): string {
  return value.normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d[ -]?){7,}\b/g, '[number]')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Scale used for exact money comparisons: 4 decimal digits (cents plus headroom). */
const MONEY_SCALE = 4;
const MAX_DB_DECIMALS = 2;
/** DECIMAL(15,2) supports 13 integer digits. */
const MAX_INTEGER_DIGITS = 13;

export type NormalizationFailureReason =
  | 'AMOUNT_PRECISION_UNSUPPORTED'
  | 'AMOUNT_RANGE_UNSUPPORTED'
  | 'AMOUNT_INVALID'
  | 'DATE_INVALID'
  | 'CURRENCY_INVALID'
  | 'IDENTITY_INVALID'
  | 'TEXT_INVALID';

export type NormalizedStringRule = 'description' | 'payee' | 'memo';

export class NormalizationError extends Error {
  readonly reason: NormalizationFailureReason;
  readonly ruleVersion: number;

  constructor(reason: NormalizationFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.ruleVersion = NORMALIZATION_VERSION;
  }
}

export class QuarantinedProviderRecord extends NormalizationError {
  cursorStart: string | null = null;
  connectionVersion: number | null = null;
  constructor(error: NormalizationError, public evidence: import('./types').PlaidRecordEvidence) {
    super(error.reason, 'Invalid provider record.');
  }
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Parse an exact decimal string into a scaled bigint (scale = MONEY_SCALE). */
export function parseDecimalToScaled(raw: string): bigint {
  const text = (raw ?? '').trim();
  if (!text) {
    throw new NormalizationError('AMOUNT_INVALID', 'amount is empty');
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new NormalizationError('AMOUNT_INVALID', `amount "${truncateForLog(raw)}" is not a decimal number`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = match[2];
  const fraction = match[3] ?? '';

  if (fraction.length > MAX_DB_DECIMALS) {
    throw new NormalizationError(
      'AMOUNT_PRECISION_UNSUPPORTED',
      `amount "${truncateForLog(raw)}" has ${fraction.length} decimal places; the ledger stores 2`,
    );
  }
  if (integerPart.length > MAX_INTEGER_DIGITS) {
    throw new NormalizationError(
      'AMOUNT_RANGE_UNSUPPORTED',
      `amount "${truncateForLog(raw)}" exceeds DECIMAL(15,2) range`,
    );
  }

  const paddedFraction = fraction.padEnd(MONEY_SCALE, '0');
  return sign * (BigInt(integerPart) * BigInt(10 ** MONEY_SCALE) + BigInt(paddedFraction || '0'));
}

/** Encode a scaled bigint back to an exact 2-decimal string safe for DECIMAL(15,2). */
export function formatScaledToString(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / BigInt(10 ** MONEY_SCALE);
  const cents = (abs % BigInt(10 ** MONEY_SCALE)) / BigInt(10 ** (MONEY_SCALE - 2));
  const sign = negative ? '-' : '';
  return `${sign}${whole}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Convert a provider amount into the Doughray representation.
 * Plaid treats outflows as POSITIVE amounts. SimpleFin uses the ledger sign.
 * Doughray: inflow positive, outflow negative. Therefore `amount = -provider`.
 */
export function convertInflowPositive(providerAmount: string): string {
  const scaled = parseDecimalToScaled(providerAmount);
  return formatScaledToString(-scaled);
}

/** Identity-safe comparisons must use scaled bigint, never float rounding. */
export function scaledEquals(a: string, b: string): boolean {
  return parseDecimalToScaled(a) === parseDecimalToScaled(b);
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export function validateCurrency(code: string | null | undefined): string {
  if (typeof code !== 'string' || !/^[A-Za-z]{3}$/.test(code.trim())) {
    throw new NormalizationError('CURRENCY_INVALID', 'currency must be a 3-letter ISO code');
  }
  return code.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Dates (date-only bank calendar day; no timezone day shifts)
// ---------------------------------------------------------------------------

/** Validate a provider calendar date (YYYY-MM-DD). Null-tolerant for optional fields. */
export function validateDateOnly(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    throw new NormalizationError('DATE_INVALID', `date "${truncateForLog(raw)}" is not a YYYY-MM-DD calendar date`);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new NormalizationError('DATE_INVALID', `date "${raw}" has an out-of-range month/day`);
  }
  // Reject real calendar impossibilities (e.g. 2024-02-31).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new NormalizationError('DATE_INVALID', `date "${raw}" is not a valid calendar date`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Storage bridge for the legacy `posted` timestamps: date-only values map to
 * UTC midnight so the calendar day is preserved in any timezone observer,
 * including across Toronto DST boundaries. Never shift by local timezone.
 */
export function dateOnlyToUtcStorage(dateOnly: string): Date {
  const validated = validateDateOnly(dateOnly);
  if (validated === null) {
    throw new NormalizationError('DATE_INVALID', 'date is required');
  }
  return new Date(`${validated}T00:00:00.000Z`);
}

/** Bridge a legacy stored timestamp back to a date-only string using UTC. */
export function utcStorageToDateOnly(storage: Date): string {
  return storage.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const MAX_TEXT_LENGTH = 512;

export function normalizeText(raw: string | null | undefined, field: NormalizedStringRule): string {
  if (raw === undefined) {
    throw new NormalizationError('TEXT_INVALID', `${field} is required`);
  }
  if (raw === null) {
    return field === 'description' ? '' : '';
  }
  let message = raw
    // Normalize unicode representations but preserve case, digits and accents.
    .normalize('NFKC')
    // Strip control characters (including C1) while keeping regular whitespace.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (message.length > MAX_TEXT_LENGTH) {
    message = message.slice(0, MAX_TEXT_LENGTH);
  }
  if (field === 'description' && message.length === 0) {
    throw new NormalizationError('TEXT_INVALID', 'description must not be empty after normalization');
  }
  return message;
}

// ---------------------------------------------------------------------------
// Conservative matching keys (identity matters; never lossy normalizePayee()).
// ---------------------------------------------------------------------------

/**
 * Merchant-class key from an ORIGINAL validated text value: lowercase, Unicode
 * folded, punctuation collapsed — but meaningful numbers, caseless accents and
 * numeric tokens survive. No digit deletion.
 */
export function buildMerchantKey(rawText: string | null): string | null {
  if (typeof rawText !== 'string') return null;
  const folded = rawText
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (folded.length === 0) return null;
  return folded.replace(/\s+/g, '+');
}

/**
 * Exact-evidence matching key for cross-source reconciliation:
 * identical purchases within the same account and currency share the key only
 * when date, amount and merchant key all match exactly; multiplicity is
 * resolved by one-to-one assignment, never by collapsing keys.
 */
export function buildExactEvidenceKey(input: {
  accountId: string;
  postedDate: string;
  amount: string;
  currency: string;
  merchantKey: string | null;
}): string {
  return [
    normalizeKeyPart(input.accountId),
    normalizeKeyPart(input.postedDate),
    normalizeKeyPart(parseDecimalToScaled(input.amount).toString()),
    normalizeKeyPart(input.currency),
    normalizeKeyPart(input.merchantKey ?? ''),
  ].join('|');
}

function normalizeKeyPart(part: string): string {
  return part.trim().length === 0 ? '-' : part.trim();
}

/** Suggested cross-provider match window (calendar days). */
export const MIGRATION_DATE_TOLERANCE_DAYS = 3;

export function calendarDayDistance(a: string, b: string): number {
  const da = validateDateOnly(a);
  const db = validateDateOnly(b);
  if (da === null || db === null) throw new NormalizationError('DATE_INVALID', 'dates required for distance');
  return Math.abs(Math.round((Date.parse(`${da}T00:00:00.000Z`) - Date.parse(`${db}T00:00:00.000Z`)) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Account mapping
// ---------------------------------------------------------------------------

export interface ProviderTypeMapping {
  accountType: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN' | 'MORTGAGE' | 'OTHER';
  /** Plastic / depository / loan subclass label safe for display. */
  providerSubtype: string | null;
}

/**
 * Explicit Plaid type/subtype mapping. Unknown values become OTHER and must be
 * reviewed — never inferred from names.
 */
export function mapProviderAccountType(type: string | null, subtype: string | null): ProviderTypeMapping {
  const t = (type ?? '').toLowerCase();
  const s = (subtype ?? '').toLowerCase();

  switch (t) {
    case 'depository':
      switch (s) {
        case 'checking':
          return { accountType: 'CHECKING', providerSubtype: s };
        case 'savings':
          return { accountType: 'SAVINGS', providerSubtype: s };
        default:
          return { accountType: 'OTHER', providerSubtype: s === '' ? null : s };
      }
    case 'credit':
      return { accountType: 'CREDIT_CARD', providerSubtype: s === '' ? null : s };
    case 'loan':
      switch (s) {
        case 'mortgage':
          return { accountType: 'MORTGAGE', providerSubtype: s };
        default:
          return { accountType: 'LOAN', providerSubtype: s === '' ? null : s };
      }
    case 'investment':
      switch (s) {
        case 'brokerage':
          return { accountType: 'INVESTMENT', providerSubtype: s };
        case '401k':
        case 'ira':
        case 'hsa':
          return { accountType: 'INVESTMENT', providerSubtype: s };
        default:
          return { accountType: 'INVESTMENT', providerSubtype: s === '' ? 'other' : s };
      }
    default:
      // Unknown type → OTHER with review; no name-based debt inference.
      return { accountType: 'OTHER', providerSubtype: s === '' ? null : s };
  }
}

/**
 * Balance conversion per account class:
 *  - deposit accounts keep the provider (Doughray-positive) sign, including
 *    overdrafts;
 *  - credit / loan debt must become Doughray's negative-liability representation;
 *  - a negative provider liability balance represents an overpayment.
 */
export function convertBalanceForAccountClass(
  providerBalance: string,
  accountType: ProviderTypeMapping['accountType'],
): string {
  switch (accountType) {
    case 'CREDIT_CARD':
    case 'LOAN':
    case 'MORTGAGE':
      // Provider: positive balance = debt. Doughray: negative balance = debt.
      return convertInflowPositive(providerBalance);
    default:
      return formatScaledToString(parseDecimalToScaled(providerBalance));
  }
}

function truncateForLog(value: string): string {
  return value.length > 32 ? `${value.slice(0, 29)}…` : value;
}
