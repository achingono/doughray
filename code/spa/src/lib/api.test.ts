import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('api client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns JSON data for successful requests', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data: [{ id: 'a1' }] }),
    });

    const result = await api.getAccounts();

    expect(fetchMock).toHaveBeenCalledWith('/api/accounts', expect.any(Object));
    expect(result).toEqual({ data: [{ id: 'a1' }] });
  });

  it('throws API error message for non-ok responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: vi.fn().mockResolvedValue({ error: { message: 'Validation error' } }),
    });

    await expect(api.getAccounts()).rejects.toThrow('Validation error');
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: vi.fn(),
    });

    await expect(api.deleteAsset('asset-1')).resolves.toBeUndefined();
  });

  it('serializes query params for endpoint helpers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data: [] }),
    });

    await api.getDashboardSummary('acc-1');
    await api.getTransactions({ search: 'coffee', page: 2, limit: 10 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dashboard/summary?accountId=acc-1',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/transactions?search=coffee&page=2&limit=10',
      expect.any(Object),
    );
  });

  it('submits transaction imports as multipart form data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({ data: { importedCount: 1 } }),
    });

    const file = new File(['Date,Amount,Description\n2026-01-01,10,Deposit\n'], 'import.csv', { type: 'text/csv' });

    await api.importTransactions({
      file,
      accountId: 'acc-1',
      format: 'csv',
    });

    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/transactions/import');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.headers as Headers).get('Content-Type')).toBeNull();
    expect((options.body as FormData).get('file')).toBe(file);
    expect((options.body as FormData).get('accountId')).toBe('acc-1');
    expect((options.body as FormData).get('format')).toBe('csv');
  });

  it('patches account balances as JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          id: 'acc-1',
          balance: 1250.55,
          availableBalance: 1200.1,
          balanceDate: '2026-04-13T00:00:00.000Z',
        },
      }),
    });

    await api.updateAccountBalance('acc-1', {
      balance: 1250.55,
      availableBalance: 1200.1,
      balanceDate: '2026-04-13',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/acc-1/balance',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          balance: 1250.55,
          availableBalance: 1200.1,
          balanceDate: '2026-04-13',
        }),
      }),
    );
  });

  it('patches imported account institution as JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          id: 'acc-1',
          institution: 'Excel Import',
        },
      }),
    });

    await api.updateAccountInstitution('acc-1', {
      institution: 'Excel Import',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/acc-1/institution',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          institution: 'Excel Import',
        }),
      }),
    );
  });

  it('patches account loan details as JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          id: 'acc-1',
          loanDetails: {
            loanType: 'MORTGAGE',
            interestType: 'FIXED',
            interestRateAnnual: 5.05,
          },
        },
      }),
    });

    await api.updateAccountLoanDetails('acc-1', {
      loanType: 'MORTGAGE',
      interestType: 'FIXED',
      interestRateAnnual: 5.05,
      source: 'USER_ENTERED',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/acc-1/loan-details',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          loanType: 'MORTGAGE',
          interestType: 'FIXED',
          interestRateAnnual: 5.05,
          source: 'USER_ENTERED',
        }),
      }),
    );
  });

  it('gets and patches account registered details as JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: { accountId: 'acc-1', registrationType: 'RRSP' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: { accountId: 'acc-1', registrationType: 'RRSP' } }),
      });

    await api.getAccountRegisteredDetails('acc-1');
    await api.updateAccountRegisteredDetails('acc-1', {
      registrationType: 'RRSP',
      totalContributionRoom: 42000,
      contributedThisYear: 6000,
      unusedCarryforward: 36000,
      verificationSource: 'CRA_NOTICE_OF_ASSESSMENT',
      lastVerifiedAt: '2026-03-15T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/accounts/acc-1/registered-details',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/accounts/acc-1/registered-details',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          registrationType: 'RRSP',
          totalContributionRoom: 42000,
          contributedThisYear: 6000,
          unusedCarryforward: 36000,
          verificationSource: 'CRA_NOTICE_OF_ASSESSMENT',
          lastVerifiedAt: '2026-03-15T00:00:00.000Z',
        }),
      }),
    );
  });

  it('gets and patches account credit card details as JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: { accountId: 'acc-1', creditLimit: 5000 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: { accountId: 'acc-1', creditLimit: 5000 } }),
      });

    await api.getAccountCreditCardDetails('acc-1');
    await api.updateAccountCreditCardDetails('acc-1', {
      creditLimit: 5000,
      currentUtilization: 45.5,
      annualPercentageRate: 19.99,
      minimumPaymentDueDate: 21,
      verificationSource: 'INSTITUTION_STATEMENT',
      lastVerifiedAt: '2026-04-15T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/accounts/acc-1/credit-card-details',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/accounts/acc-1/credit-card-details',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          creditLimit: 5000,
          currentUtilization: 45.5,
          annualPercentageRate: 19.99,
          minimumPaymentDueDate: 21,
          verificationSource: 'INSTITUTION_STATEMENT',
          lastVerifiedAt: '2026-04-15T00:00:00.000Z',
        }),
      }),
    );
  });

  it('posts expense analysis report generation', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({ data: { id: 'r-exp', type: 'SPENDING_ANALYSIS' } }),
    });

    await api.generateExpenseAnalysis({ overwriteExisting: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/expense-analysis',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ overwriteExisting: true }),
      }),
    );
  });

  it('supports report deletion and PFS overwrite generation', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({ data: { id: 'r-pfs', type: 'PERSONAL_FINANCIAL_STATEMENT' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: vi.fn(),
      });

    await api.generatePFS({ overwriteExisting: true });
    await api.deleteReport('r-pfs');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/reports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ overwriteExisting: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/reports/r-pfs',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('supports transaction recategorization and previews', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data: { transactionId: 't1' } }),
    });

    await api.getRecategorizePreview('t1', 'all-past');
    await api.recategorizeTransaction('t1', 'c1', 'all-future');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/transactions/t1/recategorize-preview?scope=all-past',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/transactions/t1/recategorize',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ categoryId: 'c1', scope: 'all-future' }),
      }),
    );
  });

  it('lists and deletes category rules', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: vi.fn(),
      });

    await api.getCategoryRules(1, 20);
    await api.deleteCategoryRule('rule-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/category-rules?page=1&limit=20',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/category-rules/rule-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('creates and updates categories', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({ data: { id: 'c1', name: 'Subscriptions' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: { id: 'c1', name: 'Streaming' } }),
      });

    await api.createCategory({ name: 'Subscriptions' });
    await api.updateCategory('c1', { name: 'Streaming' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/categories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Subscriptions' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/categories/c1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Streaming' }),
      }),
    );
  });
});
