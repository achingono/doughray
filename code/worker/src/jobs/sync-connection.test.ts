import { describe, expect, it, vi } from 'vitest';
import { BankProviderErrorKind, bankProviderError, type ProviderSyncPage } from '@doughray/shared';
import { fetchCompleteUpdate } from './sync-connection';

describe('Plaid update pagination', () => {
  it('restarts the entire update from the original cursor after mutation', async () => {
    const page = (nextCursor: string, hasMore: boolean): ProviderSyncPage => ({
      changes: [], nextCursor, hasMore, accountsSnapshot: null, transactionsUpdateStatus: 'INITIAL_UPDATE_COMPLETE',
    });
    const syncPage = vi.fn().mockResolvedValueOnce(page('partial', true))
      .mockRejectedValueOnce(bankProviderError(BankProviderErrorKind.MUTATION_DURING_PAGINATION, 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', 'retry'))
      .mockResolvedValueOnce(page('fresh', true)).mockResolvedValueOnce(page('final', false));
    const result = await fetchCompleteUpdate({ syncPage }, 'fixture', 'start');
    expect(syncPage.mock.calls.map(([input]) => input.cursor)).toEqual(['start', 'partial', 'start', 'fresh']);
    expect(result.cursor).toBe('final');
  });
});
