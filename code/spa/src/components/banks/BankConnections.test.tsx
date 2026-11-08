import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bankApi } = vi.hoisted(() => ({ bankApi: {
  bankConnections: vi.fn(), bankAccounts: vi.fn(), getAccounts: vi.fn(), mapBankAccounts: vi.fn(),
  bankReview: vi.fn(), commitBankReview: vi.fn(), saveBankReviewDraft: vi.fn(), bankQuarantine: vi.fn(), replayBankQuarantine: vi.fn(),
  searchBankMatches: vi.fn(), includeBankMatch: vi.fn(),
} }));
vi.mock('@/lib/api', () => ({ api: bankApi }));
vi.mock('react-plaid-link', () => ({ usePlaidLink: () => ({ open: vi.fn(), ready: false, error: null }) }));
import { BankConnections } from './BankConnections';

describe('bank connection review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bankApi.bankConnections.mockResolvedValue({ data: { connections: [{ id: 'connection', provider: 'PLAID',
      institutionName: 'Fixture Bank', status: 'HEALTHY', pausedAt: null, accounts: [] }],
      config: { plaid: { configured: true }, issues: [] } } });
    bankApi.bankAccounts.mockResolvedValue({ data: { accounts: [{ externalAccountId: 'bank-account', name: 'Chequing',
      currency: 'CAD', mask: '1234', mappedAccountSourceId: null }] } });
    bankApi.getAccounts.mockResolvedValue({ data: [{ id: 'existing', name: 'Existing checking', currency: 'CAD', type: 'CHECKING' }] });
    bankApi.mapBankAccounts.mockResolvedValue({ data: {} });
  });

  it('maps a provider account to the selected existing account', async () => {
    const user = userEvent.setup();
    render(<BankConnections />);
    await user.click(await screen.findByRole('button', { name: 'Accounts' }));
    await user.selectOptions(await screen.findByLabelText('Mapping for Chequing'), 'existing');
    await user.click(screen.getByRole('button', { name: 'Save account mappings' }));
    await waitFor(() => expect(bankApi.mapBankAccounts).toHaveBeenCalledWith('connection', [
      { externalAccountId: 'bank-account', action: 'MAP', accountId: 'existing' },
    ]));
  });

  it('requires an explicit transaction decision before cutover', async () => {
    bankApi.bankReview.mockResolvedValue({ data: { batchId: 'batch', draftVersion: 0, cases: [{ id: 'case', accountName: 'Checking', draft: [], candidates: [{ id: 'candidate', evidence: {
      change: { postedDate: '2026-10-29', amount: '-12.34', currency: 'CAD', observedFacts: { description: 'Merchant', payee: null } },
      candidates: [{ id: 'existing-tx', posted: '2026-10-29T00:00:00.000Z', amount: '-12.34', description: 'Existing merchant', payee: null }],
    } }] }] } });
    bankApi.commitBankReview.mockResolvedValue({ data: { approved: 1 } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<BankConnections />);
    await user.click(await screen.findByRole('button', { name: 'Review history' }));
    const approve = await screen.findByRole('button', { name: 'Approve and switch' });
    expect(approve).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Match for Merchant 2026-10-29'), 'existing-tx');
    await user.click(approve);
    await waitFor(() => expect(bankApi.commitBankReview).toHaveBeenCalledWith('connection', 'batch', [
      { candidateId: 'candidate', action: 'SAME_TRANSACTION', transactionId: 'existing-tx' },
    ]));
    vi.restoreAllMocks();
  });

  it('restores and saves an unfinished review without switching providers', async () => {
    bankApi.bankReview.mockResolvedValue({ data: { batchId: 'batch', draftVersion: 3, cases: [{ id: 'case', accountName: 'Checking',
      draft: [{ candidateId: 'candidate', action: 'NEW_TRANSACTION', transactionId: null }], candidates: [{ id: 'candidate', evidence: {
        change: { postedDate: '2026-10-29', amount: '-12.34', currency: 'CAD', observedFacts: { description: 'Merchant', payee: null } },
        candidates: [],
      } }] }] } });
    bankApi.saveBankReviewDraft.mockResolvedValue({ data: { draftVersion: 4 } });
    const user = userEvent.setup();
    render(<BankConnections />);
    await user.click(await screen.findByRole('button', { name: 'Review history' }));
    expect(await screen.findByLabelText('Match for Merchant 2026-10-29')).toHaveValue('new');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(bankApi.saveBankReviewDraft).toHaveBeenCalledWith('connection', 'batch', 3,
      [{ candidateId: 'candidate', action: 'NEW_TRANSACTION' }]));
    expect(bankApi.commitBankReview).not.toHaveBeenCalled();
  });

  it('searches for an older transaction and saves the selected match in a draft', async () => {
    bankApi.bankReview.mockResolvedValue({ data: { batchId: 'batch', draftVersion: 1, cases: [{ id: 'case', accountName: 'Checking',
      draft: [], candidates: [{ id: 'candidate', evidence: { change: { postedDate: '2026-10-29', amount: '-12.34', currency: 'CAD',
        observedFacts: { description: 'Merchant', payee: null } }, candidates: [] } }] }] } });
    const older = { id: 'older', posted: '2026-08-01T00:00:00.000Z', amount: '-12.34', description: 'Old merchant', payee: null,
      updatedAt: '2026-10-30T00:00:00.000Z' };
    bankApi.searchBankMatches.mockResolvedValue({ data: { matches: [older], page: 1, hasMore: false } });
    bankApi.includeBankMatch.mockResolvedValue({ data: { ...older, searched: true } });
    bankApi.saveBankReviewDraft.mockResolvedValue({ data: { draftVersion: 2 } });
    const user = userEvent.setup();
    render(<BankConnections />);
    await user.click(await screen.findByRole('button', { name: 'Review history' }));
    await user.type(await screen.findByLabelText('Search older matches for Merchant 2026-10-29'), 'Old');
    await user.click(screen.getByRole('button', { name: 'Search matches' }));
    await user.click(await screen.findByRole('button', { name: 'Use match' }));
    expect(await screen.findByLabelText('Match for Merchant 2026-10-29')).toHaveValue('older');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(bankApi.saveBankReviewDraft).toHaveBeenCalledWith('connection', 'batch', 1,
      [{ candidateId: 'candidate', action: 'SAME_TRANSACTION', transactionId: 'older' }]));
  });

  it('queues a reviewed repair for a quarantined transaction', async () => {
    bankApi.bankQuarantine.mockResolvedValue({ data: [{ id: 'issue', status: 'OPEN', reason: 'AMOUNT_INVALID',
      record: { name: 'Shop', date: '2026-10-29', amount: null, iso_currency_code: 'CAD' } }] });
    bankApi.replayBankQuarantine.mockResolvedValue({ data: { jobId: 'job' } });
    const user = userEvent.setup();
    render(<BankConnections />);
    await user.click(await screen.findByRole('button', { name: 'Sync issues' }));
    await user.type(await screen.findByLabelText('Corrected amount'), '12.34');
    await user.click(screen.getByRole('button', { name: 'Retry sync' }));
    await waitFor(() => expect(bankApi.replayBankQuarantine).toHaveBeenCalledWith('connection', 'issue', { amount: 12.34 }));
  });
});
