import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    report: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    asset: {
      aggregate: vi.fn(),
    },
    accountNetWorthSnapshot: {
      upsert: vi.fn(),
    },
    netWorthSnapshot: {
      upsert: vi.fn(),
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

const { openAiConfigMock } = vi.hoisted(() => ({
  openAiConfigMock: {
    getMissingOpenAIConfig: vi.fn(),
    getOpenAIModel: vi.fn().mockReturnValue('gpt-4o-mini'),
    getOpenAITemperature: vi.fn().mockReturnValue(1),
  },
}));

const { reportPromptMock } = vi.hoisted(() => ({
  reportPromptMock: {
    buildMonthlyReportPrompt: vi.fn().mockReturnValue('prompt'),
  },
}));

vi.mock('../lib/prisma', () => ({ default: prismaMock }));
vi.mock('../lib/openai', () => ({ default: openAiMock, ...openAiConfigMock }));
vi.mock('../prompts/report', () => reportPromptMock);

import { generateMonthlyReport, takeNetWorthSnapshot } from './generate-reports';

describe('worker generate-reports job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips monthly report generation when OpenAI config is missing', async () => {
    openAiConfigMock.getMissingOpenAIConfig.mockReturnValue(['OPENAI_API_KEY']);

    await generateMonthlyReport();

    expect(prismaMock.report.findFirst).not.toHaveBeenCalled();
  });

  it('generates a monthly report when config and data are available', async () => {
    openAiConfigMock.getMissingOpenAIConfig.mockReturnValue([]);
    prismaMock.report.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany.mockResolvedValue([
      { amount: new Decimal('1000'), category: null },
      { amount: new Decimal('-250'), category: { name: 'Food' } },
    ]);
    prismaMock.account.findMany.mockResolvedValue([
      { name: 'Checking', balance: new Decimal('5000'), type: 'CHECKING' },
    ]);
    openAiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ title: 'Monthly Summary', highlights: [] }) } }],
    });

    await generateMonthlyReport();

    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Monthly Summary',
          type: 'MONTHLY_SUMMARY',
        }),
      }),
    );
  });

  it('captures account and manual asset values in net worth snapshots', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      { id: 'a1', type: 'CHECKING', balance: new Decimal('1500') },
      { id: 'a2', type: 'CREDIT_CARD', balance: new Decimal('-300') },
    ]);
    prismaMock.asset.aggregate.mockResolvedValue({ _sum: { currentValue: new Decimal('700') } });

    await takeNetWorthSnapshot();

    expect(prismaMock.accountNetWorthSnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.netWorthSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          totalAssets: 2200,
          totalLiabilities: 300,
          netWorth: 1900,
        }),
      }),
    );
  });
});
