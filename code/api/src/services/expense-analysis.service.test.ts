import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transaction: { findMany: vi.fn() },
    report: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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

import { analyzeExpenseOptimization, generateExpenseAnalysis, normalizePayee } from './expense-analysis.service';

describe('expense-analysis.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes noisy payee strings', () => {
    expect(normalizePayee('INTERAC - Purchase - NETFLIX.COM 1234 TORONTO')).toBe('netflix com toronto');
  });

  it('detects recurring expenses and optimization opportunities', () => {
    const txs = [
      { posted: new Date('2026-01-05'), amount: -15.99, description: 'Netflix', payee: 'NETFLIX.COM', category: { name: 'Subscriptions' } },
      { posted: new Date('2026-02-05'), amount: -15.99, description: 'Netflix', payee: 'NETFLIX.COM', category: { name: 'Subscriptions' } },
      { posted: new Date('2026-03-05'), amount: -15.99, description: 'Netflix', payee: 'NETFLIX.COM', category: { name: 'Subscriptions' } },
      { posted: new Date('2026-04-05'), amount: -15.99, description: 'Netflix', payee: 'NETFLIX.COM', category: { name: 'Subscriptions' } },
      { posted: new Date('2026-03-09'), amount: -180, description: 'Insurance premium', payee: 'Acme Insurance', category: { name: 'Insurance' } },
      { posted: new Date('2026-04-09'), amount: -195, description: 'Insurance premium', payee: 'Acme Insurance', category: { name: 'Insurance' } },
      { posted: new Date('2026-04-01'), amount: -120, description: 'Internet bill', payee: 'FastNet Telecom', category: { name: 'Utilities' } },
      { posted: new Date('2026-04-03'), amount: -500, description: 'Transfer to savings', payee: 'Tangerine', category: { name: 'Transfers', parent: { name: 'Financial' } } },
      { posted: new Date('2026-04-04'), amount: -200, description: 'ETF purchase', payee: 'VFV', category: { name: 'Investments', parent: { name: 'Income' } } },
    ];

    const result = analyzeExpenseOptimization(txs, '2026-01-01 to 2026-06-30');

    expect(result.totalExpenses).toBeGreaterThan(0);
    expect(result.topRecurringMerchants.some((m) => m.merchant.includes('Netflix'))).toBe(true);
    expect(result.subscriptionCandidates.length).toBeGreaterThan(0);
    expect(result.insuranceOptimization.monthlyAverage).toBeGreaterThan(0);
    expect(result.savingsOpportunities.length).toBeGreaterThan(0);
  });

  it('generates and persists expense analysis report', async () => {
    azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue([]);
    prismaMock.report.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        posted: new Date('2026-03-01T00:00:00.000Z'),
        amount: new Decimal('-18.99'),
        description: 'Streaming',
        payee: 'NETFLIX',
        memo: null,
        category: { name: 'Subscriptions' },
      },
      {
        posted: new Date('2026-04-01T00:00:00.000Z'),
        amount: new Decimal('-18.99'),
        description: 'Streaming',
        payee: 'NETFLIX',
        memo: null,
        category: { name: 'Subscriptions' },
      },
      {
        posted: new Date('2026-05-01T00:00:00.000Z'),
        amount: new Decimal('-18.99'),
        description: 'Streaming',
        payee: 'NETFLIX',
        memo: null,
        category: { name: 'Subscriptions' },
      },
      {
        posted: new Date('2026-05-02T00:00:00.000Z'),
        amount: new Decimal('-250'),
        description: 'Transfer to savings',
        payee: 'Tangerine',
        memo: null,
        category: { name: 'Transfers', parent: { name: 'Financial' } },
      },
    ]);
    openAiMock.chat.completions.create.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            overview: 'You have recurring streaming costs.',
            subscriptionStrategy: { analysis: 'Consolidate plans.', actions: ['Cancel duplicates'] },
            insuranceStrategy: { analysis: 'No clear insurance data.', actions: [] },
            negotiationStrategy: { analysis: 'No major negotiables.', actions: [] },
            prioritizedActionPlan: [{ priority: 1, title: 'Review subscriptions', why: 'Immediate savings', expectedMonthlySavings: 9.5 }],
            overallInsight: 'Recurring subscriptions are your best optimization target.',
          }),
        },
      }],
    });
    prismaMock.report.create.mockResolvedValue({ id: 'r-exp', type: 'SPENDING_ANALYSIS' });

    const result = await generateExpenseAnalysis();

    expect(result).toEqual({ id: 'r-exp', type: 'SPENDING_ANALYSIS' });
    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SPENDING_ANALYSIS',
          content: expect.objectContaining({
            reportDate: expect.any(String),
            savingsOpportunities: expect.any(Array),
            overview: 'You have recurring streaming costs.',
          }),
        }),
      }),
    );
  });

  it('throws when Azure config is missing', async () => {
    azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue(['AZURE_OPENAI_ENDPOINT']);

    await expect(generateExpenseAnalysis()).rejects.toThrow('Missing Azure OpenAI config');
    expect(prismaMock.report.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it('returns existing report for current period instead of regenerating', async () => {
    azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue([]);
    prismaMock.report.findFirst.mockResolvedValue({ id: 'existing', type: 'SPENDING_ANALYSIS' });

    const result = await generateExpenseAnalysis();

    expect(result).toEqual({ id: 'existing', type: 'SPENDING_ANALYSIS' });
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
    expect(openAiMock.chat.completions.create).not.toHaveBeenCalled();
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it('overwrites existing report when requested', async () => {
    azureConfigMock.getMissingAzureOpenAIConfig.mockReturnValue([]);
    prismaMock.report.findFirst.mockResolvedValue({ id: 'existing', type: 'SPENDING_ANALYSIS' });
    prismaMock.transaction.findMany.mockResolvedValue([]);
    openAiMock.chat.completions.create.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            overview: '',
            subscriptionStrategy: { analysis: '', actions: [] },
            insuranceStrategy: { analysis: '', actions: [] },
            negotiationStrategy: { analysis: '', actions: [] },
            prioritizedActionPlan: [],
            overallInsight: '',
          }),
        },
      }],
    });
    prismaMock.report.update.mockResolvedValue({ id: 'existing', type: 'SPENDING_ANALYSIS' });

    const result = await generateExpenseAnalysis({ overwriteExisting: true });

    expect(result).toEqual({ id: 'existing', type: 'SPENDING_ANALYSIS' });
    expect(prismaMock.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing' },
        data: expect.objectContaining({
          content: expect.any(Object),
        }),
      }),
    );
  });
});
