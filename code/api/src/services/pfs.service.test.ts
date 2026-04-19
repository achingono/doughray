import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    account: {
      findMany: vi.fn(),
    },
    asset: {
      findMany: vi.fn(),
    },
    netWorthSnapshot: {
      findMany: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
    report: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { openAiMock } = vi.hoisted(() => ({
  openAiMock: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

const { azureConfigMock } = vi.hoisted(() => ({
  azureConfigMock: {
    getMissingAzureOpenAIConfig: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/openai', () => ({ default: openAiMock, ...azureConfigMock }));

import {
  buildBalanceSheet,
  calculateFinancialRatios,
  buildAssetAllocation,
  mapAccountTypeToCPACategory,
  mapAssetTypeToCPACategory,
  generatePFS,
} from './pfs.service';

describe('pfs.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapAccountTypeToCPACategory', () => {
    it('maps checking to Cash & Equivalents', () => {
      expect(mapAccountTypeToCPACategory('CHECKING')).toBe('Cash & Equivalents');
    });

    it('maps savings to Cash & Equivalents', () => {
      expect(mapAccountTypeToCPACategory('SAVINGS')).toBe('Cash & Equivalents');
    });

    it('maps investment to Marketable Securities', () => {
      expect(mapAccountTypeToCPACategory('INVESTMENT')).toBe('Marketable Securities');
    });

    it('maps credit card to Short-Term Liabilities', () => {
      expect(mapAccountTypeToCPACategory('CREDIT_CARD')).toBe('Short-Term Liabilities');
    });

    it('maps loan to Long-Term Liabilities', () => {
      expect(mapAccountTypeToCPACategory('LOAN')).toBe('Long-Term Liabilities');
    });

    it('maps mortgage to Real Estate Liabilities', () => {
      expect(mapAccountTypeToCPACategory('MORTGAGE')).toBe('Real Estate Liabilities');
    });

    it('maps unknown to Other Assets', () => {
      expect(mapAccountTypeToCPACategory('OTHER')).toBe('Other Assets');
    });
  });

  describe('mapAssetTypeToCPACategory', () => {
    it('maps real estate', () => {
      expect(mapAssetTypeToCPACategory('REAL_ESTATE')).toBe('Real Estate (Equity)');
    });

    it('maps stock to Marketable Securities', () => {
      expect(mapAssetTypeToCPACategory('STOCK')).toBe('Marketable Securities');
    });

    it('maps automobile to Personal Property', () => {
      expect(mapAssetTypeToCPACategory('AUTOMOBILE')).toBe('Personal Property');
    });
  });

  describe('buildBalanceSheet', () => {
    it('aggregates accounts and manual assets into CPA categories', () => {
      const accounts = [
        { name: 'Checking', type: 'CHECKING', balance: 10000 },
        { name: 'Savings', type: 'SAVINGS', balance: 15000 },
        { name: 'Brokerage', type: 'INVESTMENT', balance: 50000 },
        { name: 'Visa', type: 'CREDIT_CARD', balance: -2000 },
        { name: 'Student Loan', type: 'LOAN', balance: -30000 },
      ];
      const manualAssets = [
        { name: 'House', type: 'REAL_ESTATE', currentValue: 200000 },
        { name: 'Tesla Stock', type: 'STOCK', currentValue: 10000 },
      ];

      const result = buildBalanceSheet(accounts, manualAssets);

      expect(result.totalAssets).toBe(285000);
      expect(result.totalLiabilities).toBe(32000);
      expect(result.netWorth).toBe(253000);
      expect(result.assets.length).toBeGreaterThan(0);
      expect(result.liabilities.length).toBe(2);

      const cash = result.assets.find(a => a.category === 'Cash & Equivalents');
      expect(cash?.value).toBe(25000);
    });

    it('handles empty inputs', () => {
      const result = buildBalanceSheet([], []);
      expect(result.totalAssets).toBe(0);
      expect(result.totalLiabilities).toBe(0);
      expect(result.netWorth).toBe(0);
    });

    it('calculates correct percentages', () => {
      const accounts = [
        { name: 'Checking', type: 'CHECKING', balance: 25000 },
        { name: 'Brokerage', type: 'INVESTMENT', balance: 75000 },
      ];

      const result = buildBalanceSheet(accounts, []);

      const cash = result.assets.find(a => a.category === 'Cash & Equivalents');
      expect(cash?.percentOfTotal).toBe(25);

      const securities = result.assets.find(a => a.category === 'Marketable Securities');
      expect(securities?.percentOfTotal).toBe(75);
    });
  });

  describe('calculateFinancialRatios', () => {
    it('calculates ratios correctly', () => {
      const balanceSheet = {
        assets: [
          { category: 'Cash & Equivalents', value: 30000, percentOfTotal: 30 },
          { category: 'Marketable Securities', value: 70000, percentOfTotal: 70 },
        ],
        liabilities: [
          { category: 'Short-Term Liabilities', value: 5000, percentOfTotal: 33.3 },
          { category: 'Long-Term Liabilities', value: 10000, percentOfTotal: 66.7 },
        ],
        totalAssets: 100000,
        totalLiabilities: 15000,
        netWorth: 85000,
      };

      const ratios = calculateFinancialRatios(balanceSheet, 8000, 6000);

      expect(ratios.dtiRatio).toBeGreaterThan(0);
      expect(ratios.liquidityRatio).toBe(5); // 30000 / 6000
      expect(ratios.savingsRate).toBe(0.25); // (8000 - 6000) / 8000
      expect(ratios.debtToAssetRatio).toBe(0.15); // 15000 / 100000
    });

    it('handles zero income gracefully', () => {
      const balanceSheet = {
        assets: [],
        liabilities: [],
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
      };

      const ratios = calculateFinancialRatios(balanceSheet, 0, 0);

      expect(ratios.dtiRatio).toBe(0);
      expect(ratios.liquidityRatio).toBe(0);
      expect(ratios.savingsRate).toBe(0);
      expect(ratios.debtToAssetRatio).toBe(0);
    });
  });

  describe('buildAssetAllocation', () => {
    it('returns allocation with percentages', () => {
      const balanceSheet = {
        assets: [
          { category: 'Cash', value: 25000, percentOfTotal: 25 },
          { category: 'Securities', value: 75000, percentOfTotal: 75 },
        ],
        liabilities: [],
        totalAssets: 100000,
        totalLiabilities: 0,
        netWorth: 100000,
      };

      const allocation = buildAssetAllocation(balanceSheet);

      expect(allocation).toHaveLength(2);
      expect(allocation[0].percentage).toBe(25);
      expect(allocation[1].percentage).toBe(75);
    });

    it('returns empty for zero assets', () => {
      const balanceSheet = {
        assets: [],
        liabilities: [],
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
      };

      expect(buildAssetAllocation(balanceSheet)).toEqual([]);
    });
  });

  describe('generatePFS', () => {
    it('throws when Azure config is missing', async () => {
      azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue(['AZURE_OPENAI_ENDPOINT']);

      await expect(generatePFS()).rejects.toThrow('Missing Azure OpenAI config');
    });

    it('generates a full PFS report', async () => {
      azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue([]);
      prismaMock.report.findFirst.mockResolvedValue(null);

      prismaMock.account.findMany.mockResolvedValue([
        { id: 'a1', name: 'Checking', type: 'CHECKING', balance: new Decimal('10000'), isActive: true },
        { id: 'a2', name: 'Credit Card', type: 'CREDIT_CARD', balance: new Decimal('-2000'), isActive: true },
      ]);
      prismaMock.asset.findMany.mockResolvedValue([
        { id: 'as1', name: 'House', type: 'REAL_ESTATE', currentValue: new Decimal('200000') },
      ]);
      prismaMock.netWorthSnapshot.findMany.mockResolvedValue([]);
      prismaMock.transaction.findMany.mockResolvedValue([
        { amount: new Decimal('5000'), category: null },
        { amount: new Decimal('-3000'), category: { name: 'Rent/Mortgage', parent: { name: 'Housing' } } },
        { amount: new Decimal('-500'), category: { name: 'Transfers', parent: { name: 'Financial' } } },
      ]);

      openAiMock.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              trendAnalysis: 'Net worth is stable.',
              taxSensitivityAnalysis: 'Consider tax-advantaged accounts.',
              solvencyAnalysis: 'Ratios are healthy.',
              debtStrategy: { method: 'avalanche', analysis: 'Pay high-rate first.', priorityOrder: [] },
              assetRebalancing: { warnings: [], suggestions: ['Diversify holdings'] },
              overallInsight: 'Strong financial position.',
            }),
          },
        }],
      });

      prismaMock.report.create.mockResolvedValue({ id: 'r1', type: 'PERSONAL_FINANCIAL_STATEMENT' });

      const result = await generatePFS();

      expect(result.id).toBe('r1');
      expect(prismaMock.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PERSONAL_FINANCIAL_STATEMENT',
            content: expect.objectContaining({
              netWorth: 208000,
              totalAssets: 210000,
              totalLiabilities: 2000,
              solvencyBenchmarking: expect.objectContaining({
                liquidityRatio: 3.33,
                savingsRate: 0.4,
              }),
              trendAnalysis: 'Net worth is stable.',
              overallInsight: 'Strong financial position.',
            }),
          }),
        }),
      );
    });

    it('returns existing report for current period unless overwrite is requested', async () => {
      azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue([]);
      prismaMock.report.findFirst.mockResolvedValue({ id: 'existing', type: 'PERSONAL_FINANCIAL_STATEMENT' });

      const result = await generatePFS();

      expect(result).toEqual({ id: 'existing', type: 'PERSONAL_FINANCIAL_STATEMENT' });
      expect(prismaMock.account.findMany).not.toHaveBeenCalled();
      expect(openAiMock.chat.completions.create).not.toHaveBeenCalled();
      expect(prismaMock.report.create).not.toHaveBeenCalled();
    });
  });
});
