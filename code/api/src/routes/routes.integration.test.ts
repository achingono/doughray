import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error-handler';
import accountRoutes from './accounts';
import assetRoutes from './assets';
import budgetRoutes from './budgets';
import categoryRuleRoutes from './category-rules';
import categoryRoutes from './categories';
import dashboardRoutes from './dashboard';
import goalRoutes from './goals';
import holdingRoutes from './holdings';
import reportRoutes from './reports';
import syncRoutes from './sync';
import transactionRoutes from './transactions';

const { accountServiceMock } = vi.hoisted(() => ({
  accountServiceMock: {
    getAllAccounts: vi.fn(),
    getAccountById: vi.fn(),
    updateAccountBalance: vi.fn(),
    updateImportedAccountInstitution: vi.fn(),
    upsertAccountLoanDetails: vi.fn(),
    getAccountRegisteredDetails: vi.fn(),
    upsertAccountRegisteredDetails: vi.fn(),
    getAccountCreditCardDetails: vi.fn(),
    upsertAccountCreditCardDetails: vi.fn(),
  },
}));
const { transactionServiceMock } = vi.hoisted(() => ({
  transactionServiceMock: {
    getTransactions: vi.fn(),
    getTransactionFilterCategories: vi.fn(),
    updateTransactionCategory: vi.fn(),
  },
}));
const { importServiceMock } = vi.hoisted(() => ({
  importServiceMock: {
    importTransactionsFromFile: vi.fn(),
  },
}));
const { recategorizationServiceMock } = vi.hoisted(() => ({
  recategorizationServiceMock: {
    getRecategorizePreview: vi.fn(),
    recategorizeTransaction: vi.fn(),
  },
}));
const { categoryRuleServiceMock } = vi.hoisted(() => ({
  categoryRuleServiceMock: {
    listCategoryRules: vi.fn(),
    deleteCategoryRule: vi.fn(),
    applyCategoryRulesToTransactions: vi.fn(),
  },
}));
const { dashboardServiceMock } = vi.hoisted(() => ({
  dashboardServiceMock: {
    getDashboardSummary: vi.fn(),
    getTrends: vi.fn(),
    getSpendingByCategory: vi.fn(),
  },
}));
const { holdingsServiceMock } = vi.hoisted(() => ({
  holdingsServiceMock: {
    getHoldings: vi.fn(),
    getHoldingsHistory: vi.fn(),
  },
}));
const { budgetServiceMock } = vi.hoisted(() => ({
  budgetServiceMock: {
    getBudgets: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
  },
}));
const { categoryServiceMock } = vi.hoisted(() => ({
  categoryServiceMock: {
    getCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
  },
}));
const { reportServiceMock } = vi.hoisted(() => ({
  reportServiceMock: {
    getReports: vi.fn(),
    getReportById: vi.fn(),
    deleteReportById: vi.fn(),
  },
}));
const { pfsServiceMock } = vi.hoisted(() => ({
  pfsServiceMock: {
    generatePFS: vi.fn(),
  },
}));
const { expenseAnalysisServiceMock } = vi.hoisted(() => ({
  expenseAnalysisServiceMock: {
    generateExpenseAnalysis: vi.fn(),
  },
}));
const { syncServiceMock } = vi.hoisted(() => ({
  syncServiceMock: {
    getLatestSync: vi.fn(),
    getSyncHistory: vi.fn(),
    triggerSync: vi.fn(),
  },
}));
const { assetServiceMock } = vi.hoisted(() => ({
  assetServiceMock: {
    getAssets: vi.fn(),
    getAssetById: vi.fn(),
    createAsset: vi.fn(),
    updateAsset: vi.fn(),
    deleteAsset: vi.fn(),
    addValuation: vi.fn(),
  },
}));
const { goalServiceMock } = vi.hoisted(() => ({
  goalServiceMock: {
    getGoals: vi.fn(),
    getGoalById: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    updateGoalStatus: vi.fn(),
    deleteGoal: vi.fn(),
  },
}));

vi.mock('../services/account.service', () => accountServiceMock);
vi.mock('../services/transaction.service', () => transactionServiceMock);
vi.mock('../services/transaction-import.service', () => importServiceMock);
vi.mock('../services/recategorization.service', () => recategorizationServiceMock);
vi.mock('../services/category-rule.service', () => categoryRuleServiceMock);
vi.mock('../services/dashboard.service', () => dashboardServiceMock);
vi.mock('../services/holding.service', () => holdingsServiceMock);
vi.mock('../services/budget.service', () => budgetServiceMock);
vi.mock('../services/category.service', () => categoryServiceMock);
vi.mock('../services/report.service', () => reportServiceMock);
vi.mock('../services/pfs.service', () => pfsServiceMock);
vi.mock('../services/expense-analysis.service', () => expenseAnalysisServiceMock);
vi.mock('../services/sync.service', () => syncServiceMock);
vi.mock('../services/asset.service', () => assetServiceMock);
vi.mock('../services/goal.service', () => goalServiceMock);

const app = express();
app.use(express.json());
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/holdings', holdingRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/category-rules', categoryRuleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/goals', goalRoutes);
app.use(errorHandler);

describe('API route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles account routes including not found', async () => {
    accountServiceMock.getAllAccounts.mockResolvedValue([{ id: 'a1' }]);
    accountServiceMock.getAccountById.mockResolvedValueOnce({ id: 'a1' }).mockResolvedValueOnce(null);
    accountServiceMock.updateAccountBalance.mockResolvedValueOnce({ id: 'a1', balance: 100 }).mockResolvedValueOnce(null);
    accountServiceMock.updateImportedAccountInstitution.mockResolvedValueOnce({ id: 'a1', institution: 'Excel Import' }).mockResolvedValueOnce(null);
    accountServiceMock.upsertAccountLoanDetails.mockResolvedValueOnce({
      id: 'a1',
      loanDetails: { loanType: 'MORTGAGE', source: 'USER_ENTERED' },
    }).mockResolvedValueOnce(null);
    accountServiceMock.getAccountRegisteredDetails.mockResolvedValueOnce({
      accountId: 'a1',
      registrationType: 'RRSP',
      annualContributionLimit: 31560,
      totalContributionRoom: 42000,
      contributedThisYear: 6000,
      unusedCarryforward: 36000,
      staleness: {
        isDaysOld: 40,
        isStale: false,
        warningMessage: null,
      },
    }).mockResolvedValueOnce(null);
    accountServiceMock.upsertAccountRegisteredDetails.mockResolvedValueOnce({
      accountId: 'a1',
      registrationType: 'RRSP',
      totalContributionRoom: 42000,
      contributedThisYear: 6000,
      unusedCarryforward: 36000,
      staleness: {
        isDaysOld: 40,
        isStale: false,
        warningMessage: null,
      },
    }).mockResolvedValueOnce(null);
    accountServiceMock.getAccountCreditCardDetails.mockResolvedValueOnce({
      accountId: 'a1',
      creditLimit: 5000,
      currentUtilization: 45.5,
      annualPercentageRate: 19.99,
      minimumPaymentDueDate: 21,
      utilization: {
        isHigh: true,
        warningMessage: 'Credit utilization at 45.5%. Maintaining above 30% utilization may impact credit score.',
      },
    }).mockResolvedValueOnce(null);
    accountServiceMock.upsertAccountCreditCardDetails.mockResolvedValueOnce({
      accountId: 'a1',
      creditLimit: 5000,
      currentUtilization: 45.5,
      annualPercentageRate: 19.99,
      minimumPaymentDueDate: 21,
      utilization: {
        isHigh: true,
        warningMessage: 'Credit utilization at 45.5%. Maintaining above 30% utilization may impact credit score.',
      },
    }).mockResolvedValueOnce(null);

    await request(app).get('/api/accounts').expect(200).expect({ data: [{ id: 'a1' }] });
    await request(app).get('/api/accounts/a1').expect(200).expect({ data: { id: 'a1' } });
    await request(app).patch('/api/accounts/a1/balance').send({ balance: 100, availableBalance: null, balanceDate: '2026-04-14T00:00:00.000Z' }).expect(200).expect({ data: { id: 'a1', balance: 100 } });
    await request(app).patch('/api/accounts/a1/institution').send({ institution: 'Excel Import' }).expect(200).expect({ data: { id: 'a1', institution: 'Excel Import' } });
    await request(app)
      .patch('/api/accounts/a1/loan-details')
      .send({ loanType: 'MORTGAGE', interestRateAnnual: 5.05, source: 'USER_ENTERED' })
      .expect(200)
      .expect({ data: { id: 'a1', loanDetails: { loanType: 'MORTGAGE', source: 'USER_ENTERED' } } });
    await request(app).get('/api/accounts/a1/registered-details').expect(200);
    await request(app)
      .patch('/api/accounts/a1/registered-details')
      .send({
        registrationType: 'RRSP',
        annualContributionLimit: 31560,
        totalContributionRoom: 42000,
        contributedThisYear: 6000,
        unusedCarryforward: 36000,
        verificationSource: 'CRA_NOTICE_OF_ASSESSMENT',
        lastVerifiedAt: '2026-03-15T00:00:00.000Z',
      })
      .expect(200);
    await request(app).get('/api/accounts/a1/credit-card-details').expect(200);
    await request(app)
      .patch('/api/accounts/a1/credit-card-details')
      .send({
        creditLimit: 5000,
        currentUtilization: 45.5,
        annualPercentageRate: 19.99,
        minimumPaymentDueDate: 21,
        verificationSource: 'INSTITUTION_STATEMENT',
        lastVerifiedAt: '2026-04-15T00:00:00.000Z',
      })
      .expect(200);
    await request(app).patch('/api/accounts/a1/balance').send({}).expect(400);
    await request(app).patch('/api/accounts/a1/institution').send({ institution: '' }).expect(400);
    await request(app)
      .patch('/api/accounts/a1/loan-details')
      .send({ loanType: 'MORTGAGE', termStartDate: '2027-08-01T00:00:00.000Z', termMaturityDate: '2024-08-01T00:00:00.000Z' })
      .expect(400);
    await request(app)
      .patch('/api/accounts/a1/registered-details')
      .send({
        registrationType: 'RESP',
        beneficiaryName: 'Emma',
        totalContributionRoom: 5000,
        contributedThisYear: 2000,
        unusedCarryforward: 0,
        verificationSource: 'USER_ENTERED',
        lastVerifiedAt: '2026-04-20T00:00:00.000Z',
      })
      .expect(400);
    await request(app)
      .patch('/api/accounts/a1/credit-card-details')
      .send({
        creditLimit: 5000,
        currentUtilization: 105,
        annualPercentageRate: 19.99,
        minimumPaymentDueDate: 21,
        verificationSource: 'INSTITUTION_STATEMENT',
        lastVerifiedAt: '2026-04-15T00:00:00.000Z',
      })
      .expect(400);
    await request(app).patch('/api/accounts/missing/balance').send({ balance: 100 }).expect(404);
    await request(app).patch('/api/accounts/missing/institution').send({ institution: 'Any' }).expect(404);
    await request(app).patch('/api/accounts/missing/loan-details').send({ loanType: 'MORTGAGE' }).expect(404);
    await request(app).get('/api/accounts/missing/registered-details').expect(404);
    await request(app).patch('/api/accounts/missing/registered-details').send({ registrationType: 'RRSP', lastVerifiedAt: '2026-03-15T00:00:00.000Z' }).expect(404);
    await request(app).get('/api/accounts/missing/credit-card-details').expect(404);
    await request(app)
      .patch('/api/accounts/missing/credit-card-details')
      .send({
        creditLimit: 5000,
        currentUtilization: 45.5,
        annualPercentageRate: 19.99,
        minimumPaymentDueDate: 21,
        lastVerifiedAt: '2026-04-15T00:00:00.000Z',
      })
      .expect(404);
    await request(app).get('/api/accounts/missing').expect(404);
  });

  it('handles transaction routes with filters and patch validation', async () => {
    transactionServiceMock.getTransactions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
    transactionServiceMock.getTransactionFilterCategories.mockResolvedValue([{ id: 'c1' }]);
    transactionServiceMock.updateTransactionCategory.mockResolvedValue({ id: 't1', categoryId: 'c1' });
    recategorizationServiceMock.getRecategorizePreview.mockResolvedValue({
      normalizedPayee: 'netflix com',
      scope: 'all-past',
      eligiblePastCount: 3,
      sample: [],
      existingRule: null,
    });
    recategorizationServiceMock.recategorizeTransaction.mockResolvedValue({
      transactionId: 't1',
      categoryId: 'c1',
      scope: 'all-past-and-future',
      normalizedPayee: 'netflix com',
      appliedPastCount: 3,
      futureRule: { id: 'r1', categoryId: 'c1', accountId: 'a1' },
    });
    importServiceMock.importTransactionsFromFile.mockResolvedValue({
      format: 'csv',
      parsedCount: 2,
      importedCount: 1,
      skippedCount: 1,
      account: { id: 'a1', name: 'Imported', created: true },
      accounts: [{ id: 'a1', name: 'Imported', created: true }],
      categorizationTriggered: true,
    });

    await request(app).get('/api/transactions?search=coffee&page=1&limit=25').expect(200);
    await request(app).get('/api/transactions/filter-categories?search=coffee').expect(200).expect({ data: [{ id: 'c1' }] });
    await request(app).patch('/api/transactions/t1').send({ categoryId: 'c1' }).expect(200);
    await request(app).patch('/api/transactions/t1').send({}).expect(400);
    await request(app).get('/api/transactions/t1/recategorize-preview?scope=all-past').expect(200);
    await request(app)
      .post('/api/transactions/t1/recategorize')
      .send({ categoryId: 'c1', scope: 'all-past-and-future' })
      .expect(200);
    await request(app)
      .post('/api/transactions/t1/recategorize')
      .send({ categoryId: 'c1', scope: 'invalid' })
      .expect(400);

    await request(app)
      .post('/api/transactions/import')
      .field('accountName', 'Imported Account')
      .attach('file', Buffer.from('Date,Amount,Description\n2026-01-01,10,Paycheck\n'), 'import.csv')
      .expect(201)
      .expect({
        data: {
          format: 'csv',
          parsedCount: 2,
          importedCount: 1,
          skippedCount: 1,
          account: { id: 'a1', name: 'Imported', created: true },
          accounts: [{ id: 'a1', name: 'Imported', created: true }],
          categorizationTriggered: true,
        },
      });
    expect(importServiceMock.importTransactionsFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'import.csv',
        accountId: undefined,
        newAccount: expect.objectContaining({
          name: 'Imported Account',
        }),
      }),
    );

    await request(app)
      .post('/api/transactions/import')
      .field('accountId', 'a1')
      .field('format', 'CSV')
      .attach('file', Buffer.from('Date,Amount,Description\n2026-01-01,10,Paycheck\n'), 'import.csv')
      .expect(201);
    expect(importServiceMock.importTransactionsFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'import.csv',
        accountId: 'a1',
        format: 'csv',
        newAccount: undefined,
      }),
    );

    await request(app)
      .post('/api/transactions/import')
      .expect(400);

    importServiceMock.importTransactionsFromFile.mockResolvedValueOnce({
      format: 'xlsx',
      parsedCount: 3,
      importedCount: 3,
      skippedCount: 0,
      account: undefined,
      accounts: [
        { id: 'a2', name: 'RRSP 52516897 USD', created: true },
        { id: 'a3', name: 'RESP 52600518 CAD', created: false },
      ],
      categorizationTriggered: true,
    });

    await request(app)
      .post('/api/transactions/import')
      .field('format', 'xlsx')
      .attach('file', Buffer.from('xlsx-binary'), 'activities.xlsx')
      .expect(201)
      .expect({
        data: {
          format: 'xlsx',
          parsedCount: 3,
          importedCount: 3,
          skippedCount: 0,
          accounts: [
            { id: 'a2', name: 'RRSP 52516897 USD', created: true },
            { id: 'a3', name: 'RESP 52600518 CAD', created: false },
          ],
          categorizationTriggered: true,
        },
      });
    expect(importServiceMock.importTransactionsFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'activities.xlsx',
        format: 'xlsx',
        accountId: undefined,
        newAccount: undefined,
      }),
    );

    await request(app)
      .post('/api/transactions/import')
      .field('accountName', 'Imported Account')
      .attach('file', Buffer.alloc(15 * 1024 * 1024 + 1, 1), 'too-large.csv')
      .expect(400);
  });

  it('handles category rule routes', async () => {
    categoryRuleServiceMock.listCategoryRules.mockResolvedValue({
      data: [{ id: 'rule1' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    categoryRuleServiceMock.deleteCategoryRule.mockResolvedValue(undefined);

    await request(app).get('/api/category-rules?page=1&limit=20').expect(200);
    await request(app).delete('/api/category-rules/rule1').expect(204);
  });

  it('handles dashboard and holdings routes', async () => {
    dashboardServiceMock.getDashboardSummary.mockResolvedValue({ netWorth: 1 });
    dashboardServiceMock.getTrends.mockResolvedValue([{ date: '2026-01-01', value: 10 }]);
    dashboardServiceMock.getSpendingByCategory.mockResolvedValue([{ total: 40 }]);
    holdingsServiceMock.getHoldings.mockResolvedValue({ netWorth: 5 });
    holdingsServiceMock.getHoldingsHistory.mockResolvedValue([{ date: '2026-01-01', value: 5 }]);

    await request(app).get('/api/dashboard/summary').expect(200).expect({ data: { netWorth: 1 } });
    await request(app).get('/api/dashboard/trends?period=6').expect(200);
    await request(app).get('/api/dashboard/spending-by-category').expect(200);
    await request(app).get('/api/holdings').expect(200).expect({ data: { netWorth: 5 } });
    await request(app).get('/api/holdings/history?period=12').expect(200);
  });

  it('handles budget, category, report and sync routes', async () => {
    budgetServiceMock.getBudgets.mockResolvedValue([{ id: 'b1' }]);
    budgetServiceMock.createBudget.mockResolvedValue({ id: 'b1' });
    budgetServiceMock.updateBudget.mockResolvedValue({ id: 'b1' });
    budgetServiceMock.deleteBudget.mockResolvedValue(undefined);
    categoryServiceMock.getCategories.mockResolvedValue([{ id: 'c1' }]);
    categoryServiceMock.createCategory.mockResolvedValue({ id: 'c2' });
    categoryServiceMock.updateCategory.mockResolvedValue({ id: 'c2', name: 'Trips' });
    reportServiceMock.getReports.mockResolvedValue({ data: [{ id: 'r1' }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } });
    reportServiceMock.getReportById.mockResolvedValueOnce({ id: 'r1' }).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'r1' });
    reportServiceMock.deleteReportById.mockResolvedValue(undefined);
    pfsServiceMock.generatePFS.mockResolvedValue({ id: 'pfs1', type: 'PERSONAL_FINANCIAL_STATEMENT' });
    expenseAnalysisServiceMock.generateExpenseAnalysis.mockResolvedValue({ id: 'sea1', type: 'SPENDING_ANALYSIS' });
    syncServiceMock.getLatestSync.mockResolvedValue({ id: 's1' });
    syncServiceMock.getSyncHistory.mockResolvedValue([{ id: 's1' }]);
    syncServiceMock.triggerSync.mockResolvedValue({ id: 's2', status: 'RUNNING' });

    await request(app).get('/api/budgets').expect(200);
    await request(app)
      .post('/api/budgets')
      .send({ categoryId: 'c1', amount: 100, period: 'MONTHLY', startDate: '2026-01-01' })
      .expect(201);
    await request(app).post('/api/budgets').send({ amount: -5 }).expect(400);
    await request(app).put('/api/budgets/b1').send({ amount: 120 }).expect(200);
    await request(app).delete('/api/budgets/b1').expect(204);

    await request(app).get('/api/categories').expect(200).expect({ data: [{ id: 'c1' }] });
    await request(app).post('/api/categories').send({ name: 'Travel' }).expect(201);
    await request(app).patch('/api/categories/c2').send({ name: 'Trips' }).expect(200);
    await request(app).patch('/api/categories/c2').send({}).expect(400);

    await request(app).get('/api/reports?page=1&limit=10').expect(200);
    await request(app).get('/api/reports/r1').expect(200);
    await request(app).get('/api/reports/missing').expect(404);
    await request(app).post('/api/reports').send({ overwriteExisting: true }).expect(201).expect({ data: { id: 'pfs1', type: 'PERSONAL_FINANCIAL_STATEMENT' } });
    await request(app).post('/api/reports/expense-analysis').send({ overwriteExisting: true }).expect(201).expect({ data: { id: 'sea1', type: 'SPENDING_ANALYSIS' } });
    expect(pfsServiceMock.generatePFS).toHaveBeenCalledWith({ overwriteExisting: true });
    expect(expenseAnalysisServiceMock.generateExpenseAnalysis).toHaveBeenCalledWith({ overwriteExisting: true });
    await request(app).delete('/api/reports/r1').expect(204);
    await request(app).delete('/api/reports/missing').expect(404);

    await request(app).get('/api/sync/status').expect(200).expect({ data: { id: 's1' } });
    await request(app).get('/api/sync/history?limit=5').expect(200).expect({ data: [{ id: 's1' }] });
    await request(app).post('/api/sync/trigger').expect(200);
  });

  it('handles assets and goals routes with validation and not found handling', async () => {
    assetServiceMock.getAssets.mockResolvedValue([{ id: 'asset1' }]);
    assetServiceMock.getAssetById.mockResolvedValueOnce({ id: 'asset1' }).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'asset1' });
    assetServiceMock.createAsset.mockResolvedValue({ id: 'asset1' });
    assetServiceMock.updateAsset.mockResolvedValue({ id: 'asset1' });
    assetServiceMock.deleteAsset.mockResolvedValue(undefined);
    assetServiceMock.addValuation.mockResolvedValue({ id: 'v1' });

    goalServiceMock.getGoals.mockResolvedValue([{ id: 'goal1' }]);
    goalServiceMock.getGoalById.mockResolvedValueOnce({ id: 'goal1' }).mockResolvedValueOnce(null);
    goalServiceMock.createGoal.mockResolvedValue({ id: 'goal1' });
    goalServiceMock.updateGoal.mockResolvedValue({ id: 'goal1' });
    goalServiceMock.updateGoalStatus.mockResolvedValue({ id: 'goal1', status: 'PAUSED' });
    goalServiceMock.deleteGoal.mockResolvedValue(undefined);

    await request(app).get('/api/assets').expect(200);
    await request(app).get('/api/assets/asset1').expect(200);
    await request(app).get('/api/assets/missing').expect(404);
    await request(app)
      .post('/api/assets')
      .send({ name: 'House', purchasePrice: 200000, currentValue: 250000, purchaseDate: '2026-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app).put('/api/assets/asset1').send({ currentValue: 260000 }).expect(200);
    await request(app).delete('/api/assets/asset1').expect(204);
    await request(app).post('/api/assets/asset1/valuations').send({ value: 255000 }).expect(201);

    await request(app).get('/api/goals').expect(200);
    await request(app).get('/api/goals/goal1').expect(200);
    await request(app).get('/api/goals/missing').expect(404);
    await request(app)
      .post('/api/goals')
      .send({ name: 'Emergency', targetAmount: 1000, targetDate: '2026-06-01T00:00:00.000Z' })
      .expect(201);
    await request(app).post('/api/goals').send({ name: '', targetAmount: -1 }).expect(400);
    await request(app).put('/api/goals/goal1').send({ name: 'Emergency Fund' }).expect(200);
    await request(app).patch('/api/goals/goal1/status').send({ status: 'PAUSED' }).expect(200);
    await request(app).delete('/api/goals/goal1').expect(204);
  });
});
