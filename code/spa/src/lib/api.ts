const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!(options?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(error.error?.message || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Dashboard
  getDashboardSummary: (accountId?: string) => {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    const qs = params.toString();
    const querySuffix = qs ? `?${qs}` : '';
    return request<{ data: import('../types').DashboardSummary }>(`/dashboard/summary${querySuffix}`);
  },
  getDashboardTrends: (period: number | string = 'all', accountId?: string) => {
    const params = new URLSearchParams({ period: String(period) });
    if (accountId) params.set('accountId', accountId);
    return request<{ data: import('../types').TrendDataPoint[] }>(`/dashboard/trends?${params}`);
  },
  getSpendingByCategory: (startDate?: string, endDate?: string, accountId?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (accountId) params.set('accountId', accountId);
    return request<{ data: import('../types').SpendingByCategory[] }>(`/dashboard/spending-by-category?${params}`);
  },

  // Accounts
  getAccounts: () => request<{ data: import('../types').Account[] }>('/accounts'),
  getAccount: (id: string) => request<{ data: import('../types').AccountDetail }>(`/accounts/${id}`),
  createAccount: (data: import('../types').CreateLiabilityAccountInput) =>
    request<{ data: import('../types').AccountDetail }>('/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAccountBalance: (id: string, data: {
    balance: number;
    availableBalance?: number | null;
    balanceDate?: string;
  }) => request<{ data: import('../types').AccountDetail }>(`/accounts/${id}/balance`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  updateAccountInstitution: (id: string, data: { institution: string }) =>
    request<{ data: import('../types').AccountDetail }>(`/accounts/${id}/institution`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateAccountLoanDetails: (id: string, data: {
    loanType: import('../types').LoanType;
    originalPrincipal?: number | null;
    currentPrincipal?: number | null;
    interestType?: import('../types').InterestType | null;
    interestRateAnnual?: number | null;
    paymentAmount?: number | null;
    paymentFrequency?: import('../types').PaymentFrequency | null;
    termStartDate?: string | null;
    termMaturityDate?: string | null;
    originalAmortizationMonths?: number | null;
    remainingAmortizationMonths?: number | null;
    renewalDate?: string | null;
    notes?: string | null;
    lastVerifiedAt?: string | null;
    source?: import('../types').LoanDetailSource;
  }) => request<{ data: import('../types').AccountDetail }>(`/accounts/${id}/loan-details`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  getAccountRegisteredDetails: (id: string) =>
    request<{ data: import('../types').RegisteredDetailsResponse }>(`/accounts/${id}/registered-details`),
  updateAccountRegisteredDetails: (id: string, data: {
    registrationType: import('../types').RegistrationType;
    annualContributionLimit?: number;
    totalContributionRoom?: number;
    contributedThisYear?: number;
    unusedCarryforward?: number;
    beneficiaryName?: string | null;
    beneficiaryDateOfBirth?: string | null;
    grantRoomAvailable?: number | null;
    grantsReceived?: number | null;
    subscriptionLimit?: number | null;
    verificationSource?: import('../types').RegistrationVerificationSource;
    lastVerifiedAt: string;
    notes?: string | null;
  }) => request<{ data: import('../types').RegisteredDetailsResponse }>(`/accounts/${id}/registered-details`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  getAccountCreditCardDetails: (id: string) =>
    request<{ data: import('../types').CreditCardDetailsResponse }>(`/accounts/${id}/credit-card-details`),
  updateAccountCreditCardDetails: (id: string, data: {
    creditLimit: number;
    currentUtilization: number;
    annualPercentageRate: number;
    minimumPaymentDueDate: number;
    lastStatementBalance?: number;
    lastStatementDate?: string | null;
    hasAnnualFee?: boolean;
    annualFeeAmount?: number | null;
    rewardsProgram?: import('../types').CreditCardRewardsProgram | null;
    rewardsRate?: number | null;
    rewardsRedeemedThisYear?: number | null;
    issuingBank?: string | null;
    cardType?: import('../types').CreditCardType | null;
    verificationSource?: import('../types').CreditCardVerificationSource;
    lastVerifiedAt: string;
    notes?: string | null;
  }) => request<{ data: import('../types').CreditCardDetailsResponse }>(`/accounts/${id}/credit-card-details`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),

  // Transactions
  getTransactions: (params: {
    accountId?: string;
    categoryId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) searchParams.set(k, String(v)); });
    return request<import('../types').PaginatedResponse<import('../types').Transaction>>(`/transactions?${searchParams}`);
  },
  getTransactionFilterCategories: (params: {
    accountId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  } = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) searchParams.set(k, String(v)); });
    return request<{ data: import('../types').TransactionFilterCategory[] }>(`/transactions/filter-categories?${searchParams}`);
  },
  updateTransactionCategory: (id: string, categoryId: string) =>
    request(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ categoryId }) }),
  getRecategorizePreview: (id: string, scope: import('../types').RecategorizeScope) =>
    request<{ data: import('../types').RecategorizePreview }>(`/transactions/${id}/recategorize-preview?scope=${scope}`),
  recategorizeTransaction: (id: string, categoryId: string, scope: import('../types').RecategorizeScope) =>
    request<{ data: import('../types').RecategorizeResult }>(`/transactions/${id}/recategorize`, {
      method: 'POST',
      body: JSON.stringify({ categoryId, scope }),
    }),
  importTransactions: (input: {
    file: File;
    format?: import('../types').TransactionImportFormat;
    accountId?: string;
    accountName?: string;
    institution?: string;
    currency?: string;
    accountType?: import('../types').AccountType;
    accountBalance?: number;
  }) => {
    const formData = new FormData();
    formData.set('file', input.file);

    if (input.format) formData.set('format', input.format);
    if (input.accountId) formData.set('accountId', input.accountId);
    if (input.accountName) formData.set('accountName', input.accountName);
    if (input.institution) formData.set('institution', input.institution);
    if (input.currency) formData.set('currency', input.currency);
    if (input.accountType) formData.set('accountType', input.accountType);
    if (input.accountBalance !== undefined) formData.set('accountBalance', String(input.accountBalance));

    return request<{ data: import('../types').TransactionImportResult }>('/transactions/import', {
      method: 'POST',
      body: formData,
    });
  },

  // Holdings
  getHoldings: () => request<{ data: import('../types').HoldingsSummary }>('/holdings'),
  getHoldingsHistory: (period: number | string = 'all') => request<{ data: import('../types').TrendDataPoint[] }>(`/holdings/history?period=${period}`),

  // Budgets
  getBudgets: () => request<{ data: import('../types').Budget[] }>('/budgets'),
  createBudget: (data: { categoryId: string; amount: number; period: string; startDate: string; endDate?: string }) =>
    request('/budgets', { method: 'POST', body: JSON.stringify(data) }),
  updateBudget: (id: string, data: any) =>
    request(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBudget: (id: string) =>
    request(`/budgets/${id}`, { method: 'DELETE' }),

  // Categories
  getCategories: () => request<{ data: import('../types').Category[] }>('/categories'),
  getCategoryRules: (page = 1, limit = 20) =>
    request<import('../types').PaginatedResponse<import('../types').CategoryRule>>(`/category-rules?page=${page}&limit=${limit}`),
  deleteCategoryRule: (id: string) => request(`/category-rules/${id}`, { method: 'DELETE' }),
  createCategory: (data: { name: string; icon?: string; color?: string; parentId?: string }) =>
    request<{ data: import('../types').Category }>('/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id: string, data: { name?: string; icon?: string | null; color?: string | null; parentId?: string | null }) =>
    request<{ data: import('../types').Category }>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Reports
  getReports: (page = 1, limit = 10) => request<import('../types').PaginatedResponse<import('../types').Report>>(`/reports?page=${page}&limit=${limit}`),
  getReport: (id: string) => request<{ data: import('../types').Report }>(`/reports/${id}`),
  generatePFS: (options: { overwriteExisting?: boolean } = {}) =>
    request<{ data: import('../types').Report }>('/reports', {
      method: 'POST',
      body: JSON.stringify({ overwriteExisting: options.overwriteExisting === true }),
    }),
  generateExpenseAnalysis: (options: { overwriteExisting?: boolean } = {}) =>
    request<{ data: import('../types').Report }>('/reports/expense-analysis', {
      method: 'POST',
      body: JSON.stringify({ overwriteExisting: options.overwriteExisting === true }),
    }),
  deleteReport: (id: string) => request(`/reports/${id}`, { method: 'DELETE' }),

  // Sync
  getSyncStatus: () => request<{ data: import('../types').SyncStatus | null }>('/sync/status'),
  getSyncHistory: (limit = 10) => request<{ data: import('../types').SyncStatus[] }>(`/sync/history?limit=${limit}`),
  triggerSync: () => request('/sync/trigger', { method: 'POST' }),

  // Assets
  getAssets: () => request<{ data: import('../types').Asset[] }>('/assets'),
  getAsset: (id: string) => request<{ data: import('../types').Asset }>(`/assets/${id}`),
  createAsset: (data: {
    name: string;
    type?: string;
    purchasePrice: number;
    currentValue: number;
    purchaseDate?: string;
    address?: string;
    metadata?: Record<string, any>;
    accountId?: string;
  }) => request<{ data: import('../types').Asset }>('/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id: string, data: any) =>
    request<{ data: import('../types').Asset }>(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAsset: (id: string) => request(`/assets/${id}`, { method: 'DELETE' }),
  addAssetValuation: (id: string, data: { value: number; source?: string }) =>
    request<{ data: import('../types').AssetValuation }>(`/assets/${id}/valuations`, { method: 'POST', body: JSON.stringify(data) }),

  // Goals
  getGoals: (status?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const qs = params.toString();
    const querySuffix = qs ? `?${qs}` : '';
    return request<{ data: import('../types').Goal[] }>(`/goals${querySuffix}`);
  },
  getGoal: (id: string) => request<{ data: import('../types').Goal }>(`/goals/${id}`),
  createGoal: (data: {
    name: string;
    targetAmount: number;
    targetDate?: string;
    icon?: string;
    color?: string;
    notes?: string;
    accountIds?: string[];
  }) => request<{ data: import('../types').Goal }>('/goals', { method: 'POST', body: JSON.stringify(data) }),
  updateGoal: (id: string, data: any) =>
    request<{ data: import('../types').Goal }>(`/goals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateGoalStatus: (id: string, status: string) =>
    request<{ data: import('../types').Goal }>(`/goals/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteGoal: (id: string) => request(`/goals/${id}`, { method: 'DELETE' }),
};
