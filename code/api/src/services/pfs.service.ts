import { prisma } from '../lib/prisma';
import openai, { getMissingAzureOpenAIConfig } from '../lib/openai';
import { isExpenseTransaction } from '../lib/expense-transactions';
import { decimalToNumber } from '../lib/types';
import { buildPFSPrompt } from '../prompts/pfs';
import { ReportType, type Prisma } from '@prisma/client';

const ASSET_ACCOUNT_TYPES = new Set(['CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER']);
const LIABILITY_ACCOUNT_TYPES = new Set(['CREDIT_CARD', 'LOAN', 'MORTGAGE']);

interface CPACategoryEntry {
  category: string;
  value: number;
}

interface BalanceSheet {
  assets: Array<CPACategoryEntry & { percentOfTotal: number }>;
  liabilities: Array<CPACategoryEntry & { percentOfTotal: number }>;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

interface FinancialRatios {
  dtiRatio: number;
  liquidityRatio: number;
  savingsRate: number;
  debtToAssetRatio: number;
}

interface HistoricalSnapshot {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

interface LiabilityDetail {
  name: string;
  balance: number;
  type: string;
}

export function mapAccountTypeToCPACategory(accountType: string): string {
  switch (accountType) {
    case 'CHECKING':
    case 'SAVINGS':
      return 'Cash & Equivalents';
    case 'INVESTMENT':
      return 'Marketable Securities';
    case 'CREDIT_CARD':
      return 'Short-Term Liabilities';
    case 'LOAN':
      return 'Long-Term Liabilities';
    case 'MORTGAGE':
      return 'Real Estate Liabilities';
    default:
      return 'Other Assets';
  }
}

export function mapAssetTypeToCPACategory(assetType: string): string {
  switch (assetType) {
    case 'REAL_ESTATE':
      return 'Real Estate (Equity)';
    case 'STOCK':
      return 'Marketable Securities';
    case 'AUTOMOBILE':
      return 'Personal Property';
    default:
      return 'Other Assets';
  }
}

export function buildBalanceSheet(
  accounts: Array<{ type: string; balance: number; name: string }>,
  manualAssets: Array<{ type: string; currentValue: number; name: string }>,
): BalanceSheet {
  const assetCategories = new Map<string, number>();
  const liabilityCategories = new Map<string, number>();

  for (const account of accounts) {
    const category = mapAccountTypeToCPACategory(account.type);
    if (ASSET_ACCOUNT_TYPES.has(account.type)) {
      assetCategories.set(category, (assetCategories.get(category) || 0) + account.balance);
    } else if (LIABILITY_ACCOUNT_TYPES.has(account.type)) {
      liabilityCategories.set(category, (liabilityCategories.get(category) || 0) + Math.abs(account.balance));
    }
  }

  for (const asset of manualAssets) {
    const category = mapAssetTypeToCPACategory(asset.type);
    assetCategories.set(category, (assetCategories.get(category) || 0) + asset.currentValue);
  }

  const totalAssets = Array.from(assetCategories.values()).reduce((sum, v) => sum + v, 0);
  const totalLiabilities = Array.from(liabilityCategories.values()).reduce((sum, v) => sum + v, 0);

  const assets = Array.from(assetCategories.entries())
    .map(([category, value]) => ({
      category,
      value: Math.round(value * 100) / 100,
      percentOfTotal: totalAssets > 0 ? Math.round((value / totalAssets) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const liabilities = Array.from(liabilityCategories.entries())
    .map(([category, value]) => ({
      category,
      value: Math.round(value * 100) / 100,
      percentOfTotal: totalLiabilities > 0 ? Math.round((value / totalLiabilities) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    assets,
    liabilities,
    totalAssets: Math.round(totalAssets * 100) / 100,
    totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    netWorth: Math.round((totalAssets - totalLiabilities) * 100) / 100,
  };
}

export function calculateFinancialRatios(
  balanceSheet: BalanceSheet,
  monthlyIncome: number,
  monthlyExpenses: number,
): FinancialRatios {
  const monthlyDebtPayments = balanceSheet.totalLiabilities > 0
    ? balanceSheet.liabilities.reduce((sum, l) => sum + l.value, 0) / 12
    : 0;

  const cashEquivalents = balanceSheet.assets.find(a => a.category === 'Cash & Equivalents');
  const liquidAssets = cashEquivalents?.value || 0;

  return {
    dtiRatio: monthlyIncome > 0
      ? Math.round((monthlyDebtPayments / monthlyIncome) * 1000) / 1000
      : 0,
    liquidityRatio: monthlyExpenses > 0
      ? Math.round((liquidAssets / monthlyExpenses) * 100) / 100
      : 0,
    savingsRate: monthlyIncome > 0
      ? Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 1000) / 1000
      : 0,
    debtToAssetRatio: balanceSheet.totalAssets > 0
      ? Math.round((balanceSheet.totalLiabilities / balanceSheet.totalAssets) * 1000) / 1000
      : 0,
  };
}

export function buildAssetAllocation(
  balanceSheet: BalanceSheet,
): Array<{ category: string; value: number; percentage: number }> {
  const totalAssets = balanceSheet.totalAssets;
  if (totalAssets <= 0) return [];

  return balanceSheet.assets.map(a => ({
    category: a.category,
    value: a.value,
    percentage: Math.round((a.value / totalAssets) * 1000) / 10,
  }));
}

export async function generatePFS(options: { overwriteExisting?: boolean } = {}): Promise<any> {
  const missingConfig = getMissingAzureOpenAIConfig();
  if (missingConfig.length > 0) {
    throw new Error(`Missing Azure OpenAI config: ${missingConfig.join(', ')}`);
  }

  const now = new Date();
  const overwriteExisting = options.overwriteExisting === true;
  const periodStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const existing = await prisma.report.findFirst({
    where: { type: ReportType.PERSONAL_FINANCIAL_STATEMENT, period: periodStr },
    orderBy: { generatedAt: 'desc' },
  });
  if (existing && !overwriteExisting) {
    return existing;
  }

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  // Aggregate data in parallel
  const [accounts, manualAssets, snapshots, monthlyTransactions] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true } }),
    prisma.asset.findMany(),
    prisma.netWorthSnapshot.findMany({
      where: { date: { gte: sixMonthsAgo } },
      orderBy: { date: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { posted: { gte: startOfMonth } },
      include: { category: { select: { name: true, parent: { select: { name: true } } } } },
    }),
  ]);

  // Map to plain number objects
  const mappedAccounts = accounts.map(a => ({
    name: a.name,
    type: a.type,
    balance: decimalToNumber(a.balance),
  }));

  const mappedAssets = manualAssets.map(a => ({
    name: a.name,
    type: a.type,
    currentValue: decimalToNumber(a.currentValue),
  }));

  // Build balance sheet
  const balanceSheet = buildBalanceSheet(mappedAccounts, mappedAssets);

  // Calculate monthly income/expenses
  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  for (const t of monthlyTransactions) {
    const amt = decimalToNumber(t.amount);
    if (amt > 0) monthlyIncome += amt;
    else if (isExpenseTransaction({ amount: amt, category: t.category })) monthlyExpenses += Math.abs(amt);
  }

  // Calculate ratios
  const ratios = calculateFinancialRatios(balanceSheet, monthlyIncome, monthlyExpenses);

  // Build asset allocation
  const assetAllocation = buildAssetAllocation(balanceSheet);

  // Historical snapshots
  const historicalSnapshots: HistoricalSnapshot[] = snapshots.map(s => ({
    date: s.date.toISOString().split('T')[0],
    totalAssets: decimalToNumber(s.totalAssets),
    totalLiabilities: decimalToNumber(s.totalLiabilities),
    netWorth: decimalToNumber(s.netWorth),
  }));

  // Net worth change from earliest snapshot
  let netWorthChange = { amount: 0, percentage: 0, comparedTo: '' };
  if (historicalSnapshots.length >= 2) {
    const oldest = historicalSnapshots[0];
    const current = balanceSheet.netWorth;
    const change = current - oldest.netWorth;
    netWorthChange = {
      amount: Math.round(change * 100) / 100,
      percentage: oldest.netWorth === 0
        ? 0
        : Math.round((change / Math.abs(oldest.netWorth)) * 1000) / 10,
      comparedTo: oldest.date,
    };
  }

  // Liability details for debt strategy
  const liabilityDetails: LiabilityDetail[] = accounts
    .filter(a => LIABILITY_ACCOUNT_TYPES.has(a.type))
    .map(a => ({
      name: a.name,
      balance: Math.abs(decimalToNumber(a.balance)),
      type: a.type,
    }));

  // Build LLM prompt with pre-calculated data
  const prompt = buildPFSPrompt({
    balanceSheet,
    ratios,
    assetAllocation,
    historicalSnapshots,
    liabilityDetails,
    monthlyIncome,
    monthlyExpenses,
  });

  // Call LLM for CPA narrative
  const response = await openai.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT!,
    messages: [{ role: 'user', content: prompt }],
    temperature: process.env.AZURE_OPENAI_TEMPERATURE ? Number(process.env.AZURE_OPENAI_TEMPERATURE) : 1,
    response_format: { type: 'json_object' },
  });

  const llmContent = response.choices[0]?.message?.content;
  if (!llmContent) {
    throw new Error('No content in LLM response');
  }

  const narrative = JSON.parse(llmContent);

  // Assemble full PFS content
  const pfsContent = {
    reportDate: now.toISOString().split('T')[0],
    periodCovered: periodStr,

    // Page 1: Executive Summary
    netWorth: balanceSheet.netWorth,
    netWorthChange,
    totalAssets: balanceSheet.totalAssets,
    totalLiabilities: balanceSheet.totalLiabilities,
    assetAllocation,

    // Page 2: Statement of Financial Condition
    assets: balanceSheet.assets,
    liabilities: balanceSheet.liabilities,

    // Page 3: CPA Narrative (from LLM)
    trendAnalysis: narrative.trendAnalysis || '',
    taxSensitivityAnalysis: narrative.taxSensitivityAnalysis || '',
    solvencyBenchmarking: {
      ...ratios,
      analysis: narrative.solvencyAnalysis || '',
    },
    debtStrategy: {
      method: narrative.debtStrategy?.method || 'N/A',
      analysis: narrative.debtStrategy?.analysis || '',
      priorityOrder: narrative.debtStrategy?.priorityOrder || [],
    },
    assetRebalancing: {
      warnings: narrative.assetRebalancing?.warnings || [],
      suggestions: narrative.assetRebalancing?.suggestions || [],
    },
    overallInsight: narrative.overallInsight || '',
  };

  if (existing && overwriteExisting) {
    return prisma.report.update({
      where: { id: existing.id },
      data: {
        title: `Personal Financial Statement - ${periodStr}`,
        content: pfsContent as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
    });
  }

  // Store as Report
  const report = await prisma.report.create({
    data: {
      title: `Personal Financial Statement - ${periodStr}`,
      type: ReportType.PERSONAL_FINANCIAL_STATEMENT,
      content: pfsContent as unknown as Prisma.InputJsonValue,
      period: periodStr,
    },
  });

  return report;
}
