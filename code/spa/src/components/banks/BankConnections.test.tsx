import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bankApi } = vi.hoisted(() => ({ bankApi: {
  bankConnections: vi.fn(), bankAccounts: vi.fn(), getAccounts: vi.fn(), mapBankAccounts: vi.fn(),
  bankReview: vi.fn(), commitBankReview: vi.fn(),
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
    bankApi.bankReview.mockResolvedValue({ data: { batchId: 'batch', cases: [{ id: 'case', accountName: 'Checking', candidates: [{ id: 'candidate', evidence: {
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
});
