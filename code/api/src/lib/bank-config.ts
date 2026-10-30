import {
  loadBankConfig,
  describeBankConfigStatus,
  PlaidProvider,
  type BankConfigSettings,
  type BankConfigStatus,
  type PlaidSettings,
  type PlaidEnvName,
} from '@doughray/shared';
import { AppError } from '../middleware/error-handler';

/**
 * Server-side bank configuration for the API process.
 *
 * Loaded once from the environment. `describeBankConfigStatus()` output is safe
 * to log and serve: it never contains credential values.
 */

let cached: BankConfigSettings | null = null;

export function getBankConfig(): BankConfigSettings {
  if (cached === null) {
    cached = loadBankConfig();
  }
  return cached;
}

export function getBankConfigStatus(): BankConfigStatus {
  return describeBankConfigStatus(getBankConfig());
}

let cachedProvider: PlaidProvider | null = null;

/** Plaid adapter instance; throws a clear 503 when linking is not configured. */
export function getPlaidProvider(): PlaidProvider {
  if (cachedProvider === null) {
    const settings: PlaidSettings = getBankConfig().plaid;
    const configured = settings.clientId !== null && settings.secret !== null && settings.env !== null;
    if (!configured) {
      throw new AppError(503, 'Plaid linking is not configured on this deployment.', 'PLAID_NOT_CONFIGURED');
    }
    cachedProvider = new PlaidProvider({ settings });
  }
  return cachedProvider;
}

export interface BankEncryptionMaterial {
  key: Buffer;
  keyVersion: number;
}

/** Encryption material for token persistence; throws a clear 503 when absent. */
export function getBankEncryptionMaterial(): BankEncryptionMaterial {
  const encryption = getBankConfig().encryption;
  if (encryption.keyMaterial === null) {
    throw new AppError(503, 'Bank token encryption key is not configured.', 'BANK_ENCRYPTION_NOT_CONFIGURED');
  }
  return { key: encryption.keyMaterial, keyVersion: encryption.keyVersion };
}

/** Originating environment name for new connections (null when Plaid is unconfigured). */
export function getPlaidEnvironment(): PlaidEnvName | null {
  return getBankConfig().plaid.env;
}
