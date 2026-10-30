import type * as prisma from '@prisma/client';

/**
 * Bank-provider configuration for Doughray.
 *
 * Secrets are never returned by these helpers: every summary output contains
 * only presence/configuration booleans so it is safe to log or serve.
 */

export type PlaidEnvName = 'sandbox' | 'production';

export interface PlaidSettings {
  clientId: string | null;
  secret: string | null;
  env: PlaidEnvName | null;
  countryCodes: string[];
  redirectUri: string | null;
  webhookUrl: string | null;
  transactionsDaysRequested: number;
  apiVersion: string;
  refreshEnabled: boolean;
  connectionLimit: number | null;
  connectionLimitEnforced: boolean;
}

export interface BankEncryptionSettings {
  keyMaterial: Buffer | null;
  keyVersion: number;
  hasKey: boolean;
}

export interface BankConfigSettings {
  plaid: PlaidSettings;
  encryption: BankEncryptionSettings;
}

export interface BankConfigStatus {
  plaid: {
    configured: boolean;
    env: PlaidEnvName | null;
    countryCodes: string[];
    redirectUriConfigured: boolean;
    webhookUrlConfigured: boolean;
    transactionsDaysRequested: number;
    refreshEnabled: boolean;
    connectionLimit: number | null;
    connectionLimitEnforced: boolean;
  };
  encryptionReady: boolean;
  issues: string[];
}

const VALID_ENVS: readonly PlaidEnvName[] = ['sandbox', 'production'];

function readEnvValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function parseCountryCodes(raw: string | null): string[] {
  if (!raw) return ['CA', 'US'];
  const codes = raw
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return codes.length > 0 ? [...new Set(codes)] : ['CA', 'US'];
}

function parseEncryptionKey(raw: string | null): Buffer | null {
  if (!raw) return null;
  try {
    // Support base64, base64url and hex encodings for the 32-byte key.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      const hex = Buffer.from(raw, 'hex');
      return hex.length === 32 ? hex : null;
    }
    const buf = Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function loadBankConfig(env: NodeJS.ProcessEnv = process.env): BankConfigSettings {
  const envName = readEnvValue(env, 'PLAID_ENV');
  const plaidEnv = envName !== null && (VALID_ENVS as readonly string[]).includes(envName) ? (envName as PlaidEnvName) : null;

  const clientSecret = readEnvValue(env, 'PLAID_CLIENT_SECRET');

  const plaid: PlaidSettings = {
    clientId: readEnvValue(env, 'PLAID_CLIENT_ID'),
    secret: clientSecret,
    env: plaidEnv,
    countryCodes: parseCountryCodes(readEnvValue(env, 'PLAID_COUNTRY_CODES')),
    redirectUri: readEnvValue(env, 'PLAID_REDIRECT_URI'),
    webhookUrl: readEnvValue(env, 'PLAID_WEBHOOK_URL'),
    transactionsDaysRequested: parsePositiveInt(readEnvValue(env, 'PLAID_TRANSACTIONS_DAYS_REQUESTED'), 365, 1, 730),
    apiVersion: readEnvValue(env, 'PLAID_API_VERSION') ?? '2020-09-14',
    refreshEnabled: (readEnvValue(env, 'PLAID_REFRESH_ENABLED') ?? '').toLowerCase() === 'true',
    connectionLimit: parsePositiveInt(readEnvValue(env, 'PLAID_CONNECTION_LIMIT'), 10, 1, 10_000),
    connectionLimitEnforced: (readEnvValue(env, 'PLAID_MIGRATION_CONNECTION_LIMIT_ENABLED') ?? 'true').toLowerCase() === 'true',
  };

  const encryption: BankEncryptionSettings = {
    keyMaterial: parseEncryptionKey(readEnvValue(env, 'BANK_TOKEN_ENCRYPTION_KEY')),
    keyVersion: parsePositiveInt(readEnvValue(env, 'BANK_TOKEN_ENCRYPTION_KEY_VERSION'), 1, 1, 1_000_000),
    hasKey: parseEncryptionKey(readEnvValue(env, 'BANK_TOKEN_ENCRYPTION_KEY')) !== null,
  };

  return { plaid, encryption };
}

export function validateBankConfig(settings: BankConfigSettings): string[] {
  const issues: string[] = [];
  const plaid = settings.plaid;

  if (plaid.env === null) {
    issues.push('PLAID_ENV must be exactly "sandbox" or "production".');
  }
  if (plaid.clientId === null) {
    issues.push('PLAID_CLIENT_ID is missing.');
  }
  if (plaid.secret === null) {
    issues.push('PLAID_CLIENT_SECRET is missing.');
  }
  if (plaid.countryCodes.length === 0) {
    issues.push('PLAID_COUNTRY_CODES must contain at least one two-letter country code.');
  }
  if (plaid.redirectUri !== null && !/^https:\/\//.test(plaid.redirectUri) && plaid.env === 'production') {
    issues.push('PLAID_REDIRECT_URI must use HTTPS in production.');
  }
  if (plaid.webhookUrl !== null && !/^https:\/\//.test(plaid.webhookUrl) && plaid.env === 'production') {
    issues.push('PLAID_WEBHOOK_URL must use HTTPS in production.');
  }
  if ((plaid.clientId === null || plaid.secret === null || plaid.env === null) && (plaid.clientId !== null || plaid.secret !== null)) {
    issues.push('Linking is disabled: provide all of PLAID_CLIENT_ID, PLAID_CLIENT_SECRET and PLAID_ENV.');
  }

  if (settings.encryption.keyMaterial === null) {
    issues.push('BANK_TOKEN_ENCRYPTION_KEY is missing or not a 32-byte base64/hex key. Plaid linking cannot run.');
  }
  return issues;
}

/** Configuration status without any secret values — safe for logs and API responses. */
export function describeBankConfigStatus(settings: BankConfigSettings, extraIssues: string[] = []): BankConfigStatus {
  const issues = [...validateBankConfig(settings), ...extraIssues];
  const plaidConfigured =
    settings.plaid.clientId !== null && settings.plaid.secret !== null && settings.plaid.env !== null;

  return {
    plaid: {
      configured: plaidConfigured && settings.encryption.keyMaterial !== null,
      env: settings.plaid.env,
      countryCodes: settings.plaid.countryCodes,
      redirectUriConfigured: settings.plaid.redirectUri !== null,
      webhookUrlConfigured: settings.plaid.webhookUrl !== null,
      transactionsDaysRequested: settings.plaid.transactionsDaysRequested,
      refreshEnabled: settings.plaid.refreshEnabled,
      connectionLimit: settings.plaid.connectionLimit,
      connectionLimitEnforced: settings.plaid.connectionLimitEnforced,
    },
    encryptionReady: settings.encryption.keyMaterial !== null,
    issues,
  };
}
