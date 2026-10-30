import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaidApi, type Transaction } from 'plaid';
import { BankProviderErrorKind, PlaidProvider, convertBalanceForAccountClass, mapPlaidTransaction, mapProviderAccountType, sanitizeAiText } from '@doughray/shared';

const provider = () => new PlaidProvider({ settings: {
  clientId: 'fixture', secret: 'fixture', env: 'sandbox', countryCodes: ['CA'], redirectUri: null,
  webhookUrl: null, transactionsDaysRequested: 365, apiVersion: '2020-09-14', refreshEnabled: false,
  connectionLimit: 10, connectionLimitEnforced: true,
} });

afterEach(() => vi.restoreAllMocks());

describe('Plaid financial data contract', () => {
  it('preserves deposit signs and reverses debt and overpayments exactly once', async () => {
    vi.spyOn(PlaidApi.prototype, 'accountsGet').mockResolvedValue({ data: { accounts: [
      { account_id: 'a', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: -100, available: 25, iso_currency_code: 'CAD' } },
      { account_id: 'b', name: 'Card', type: 'credit', subtype: 'credit card', balances: { current: 100, available: 900, iso_currency_code: 'CAD' } },
      { account_id: 'c', name: 'Unknown', type: 'depository', subtype: 'checking', balances: { current: 0, available: null, iso_currency_code: null, unofficial_currency_code: null } },
    ] } } as never);
    const accounts = await provider().listAccounts('fixture');
    expect(accounts.map((a) => [a.currentBalance, a.availableBalance, a.currency])).toEqual([
      ['-100.00', '25.00', 'CAD'], ['-100.00', '900.00', 'CAD'], ['0.00', null, null],
    ]);
    expect(convertBalanceForAccountClass('-100', 'CREDIT_CARD')).toBe('100.00');
    expect(mapProviderAccountType('loan', 'auto').accountType).toBe('LOAN');
    expect(mapProviderAccountType('loan', 'mortgage').accountType).toBe('MORTGAGE');
  });

  it('rejects missing amounts instead of inventing a zero transaction', () => {
    expect(() => mapPlaidTransaction({ transaction_id: 't', account_id: 'a', date: '2026-10-29' } as Transaction, 'ADDED'))
      .toThrow('transaction is missing a valid amount');
  });

  it('keeps usable account inventory when a balance exceeds ledger precision', async () => {
    vi.spyOn(PlaidApi.prototype, 'accountsGet').mockResolvedValue({ data: { accounts: [
      { account_id: 'a', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 25, available: 15.123, iso_currency_code: 'CAD' } },
      { account_id: 'b', name: 'Investment', type: 'investment', subtype: '401k', balances: { current: 123.4567, available: null, iso_currency_code: 'CAD' } },
    ] } } as never);
    const accounts = await provider().listAccounts('fixture');
    expect(accounts.map((account) => [account.currentBalance, account.availableBalance, account.unavailable])).toEqual([
      ['25.00', null, false], [null, null, true],
    ]);
  });

  it('classifies actual Plaid pagination errors and retains request IDs', async () => {
    vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockRejectedValue({ response: { status: 400, data: {
      error_type: 'TRANSACTIONS_ERROR', error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', request_id: 'req-1',
    } } });
    await expect(provider().syncPage({ accessToken: 'fixture', cursor: null })).rejects.toMatchObject({
      kind: BankProviderErrorKind.MUTATION_DURING_PAGINATION, requestId: 'req-1',
    });
  });

  it('returns Plaid history readiness with the sync page', async () => {
    vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue({ data: {
      added: [], modified: [], removed: [], accounts: [], has_more: false, next_cursor: '',
      transactions_update_status: 'NOT_READY',
    } } as never);
    await expect(provider().syncPage({ accessToken: 'fixture', cursor: null })).resolves.toMatchObject({ transactionsUpdateStatus: 'NOT_READY' });
  });

  it('skips paused accounts before normalizing their records', async () => {
    vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue({ data: {
      added: [{ account_id: 'paused', transaction_id: 'bad', amount: null }], modified: [], removed: [],
      accounts: [], has_more: false, next_cursor: 'after',
    } } as never);
    await expect(provider().syncPage({ accessToken: 'fixture', cursor: null, excludedAccountIds: ['paused'] }))
      .resolves.toMatchObject({ changes: [], nextCursor: 'after' });
  });

  it('redacts common identifiers from model-bound descriptions', () => {
    const sanitized = sanitizeAiText('Café 42 · account 123456789 · jane@example.com');
    expect(sanitized).toContain('Café 42');
    expect(sanitized).not.toContain('123456789');
    expect(sanitized).not.toContain('jane@example.com');
  });
});
