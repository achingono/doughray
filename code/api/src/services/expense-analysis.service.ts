import { ReportType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import openai, { getMissingAzureOpenAIConfig } from '../lib/openai';
import { isExpenseTransaction } from '../lib/expense-transactions';
import { decimalToNumber } from '../lib/types';
import { normalizePayee } from '../lib/normalize-payee';
import { buildExpenseAnalysisPrompt } from '../prompts/expense-analysis';

export { normalizePayee } from '../lib/normalize-payee';

type Cadence = 'weekly' | 'monthly' | 'annual';
type Confidence = 'low' | 'medium' | 'high';

interface ExpenseTransaction {
  posted: Date;
  amount: number;
  description: string;
  payee?: string | null;
  memo?: string | null;
  category?: { name: string; parent?: { name: string } | null } | null;
}

interface RecurringMerchant {
  merchant: string;
  cadence: Cadence;
  monthlyCost: number;
  annualCost: number;
  confidence: number;
  transactionCount: number;
}

interface SubscriptionCandidate {
  merchant: string;
  monthlyCost: number;
  annualCost: number;
  confidence: number;
  rationale: string;
}

interface NegotiationCandidate {
  merchant: string;
  averageMonthlySpend: number;
  estimatedMonthlySavings: number;
  rationale: string;
}

interface SavingsOpportunity {
  title: string;
  description: string;
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  confidence: Confidence;
}

interface ExpenseAnalysisSummary {
  periodCovered: string;
  totalExpenses: number;
  transactionCount: number;
  essentialVsDiscretionary: {
    essential: number;
    discretionary: number;
    essentialRatio: number;
    discretionaryRatio: number;
  };
  topRecurringMerchants: RecurringMerchant[];
  subscriptionCandidates: SubscriptionCandidate[];
  insuranceOptimization: {
    monthlyAverage: number;
    premiumTrendPercent: number;
    providerCount: number;
  };
  negotiationCandidates: NegotiationCandidate[];
  savingsOpportunities: SavingsOpportunity[];
  dataQuality: 'sufficient' | 'insufficient';
}

const INSURANCE_HINTS = ['insurance', 'insur', 'assurance', 'allstate', 'geico', 'statefarm', 'intact', 'belair', 'aviva'];
const NEGOTIABLE_HINTS = ['internet', 'mobile', 'wireless', 'telecom', 'phone', 'utility', 'hydro', 'electric', 'cable'];

const DISCRETIONARY_CATEGORY_HINTS = [
  'entertainment', 'dining', 'restaurants', 'shopping', 'travel', 'subscriptions', 'fun', 'coffee',
];
const ESSENTIAL_CATEGORY_HINTS = [
  'rent', 'mortgage', 'insurance', 'groceries', 'utilities', 'transportation', 'health', 'medical',
];

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

function merchantLabel(raw: string): string {
  return normalizePayee(raw).split(' ').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function classifyEssentialDiscretionary(tx: ExpenseTransaction): 'essential' | 'discretionary' {
  const category = tx.category?.name.toLowerCase() ?? '';
  const text = `${tx.payee ?? ''} ${tx.description} ${tx.memo ?? ''}`.toLowerCase();
  if (ESSENTIAL_CATEGORY_HINTS.some((hint) => category.includes(hint) || text.includes(hint))) return 'essential';
  if (DISCRETIONARY_CATEGORY_HINTS.some((hint) => category.includes(hint) || text.includes(hint))) return 'discretionary';
  return Math.abs(tx.amount) >= 250 ? 'essential' : 'discretionary';
}

function classifyCadence(intervalDays: number[]): Cadence | null {
  if (intervalDays.length === 0) return null;
  const monthlyHits = intervalDays.filter((d) => d >= 25 && d <= 35).length;
  const weeklyHits = intervalDays.filter((d) => d >= 6 && d <= 8).length;
  const annualHits = intervalDays.filter((d) => d >= 350 && d <= 380).length;
  const best = Math.max(monthlyHits, weeklyHits, annualHits);
  if (best === 0) return null;
  if (best === monthlyHits) return 'monthly';
  if (best === weeklyHits) return 'weekly';
  return 'annual';
}

function cadenceToMonthlyAmount(cadence: Cadence, amount: number): number {
  if (cadence === 'weekly') return amount * 52 / 12;
  if (cadence === 'annual') return amount / 12;
  return amount;
}

function matchingCadenceIntervals(cadence: Cadence, intervals: number[]): number {
  if (cadence === 'monthly') return intervals.filter((d) => d >= 25 && d <= 35).length;
  if (cadence === 'weekly') return intervals.filter((d) => d >= 6 && d <= 8).length;
  return intervals.filter((d) => d >= 350 && d <= 380).length;
}

function detectRecurringMerchants(expenses: ExpenseTransaction[]): RecurringMerchant[] {
  const byMerchant = new Map<string, ExpenseTransaction[]>();
  for (const tx of expenses) {
    const merchant = normalizePayee(tx.payee || tx.description);
    const existing = byMerchant.get(merchant) ?? [];
    existing.push(tx);
    byMerchant.set(merchant, existing);
  }

  const recurring: RecurringMerchant[] = [];
  for (const [merchant, txs] of byMerchant.entries()) {
    if (txs.length < 3) continue;
    const ordered = [...txs].sort((a, b) => a.posted.getTime() - b.posted.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < ordered.length; i += 1) intervals.push(diffDays(ordered[i].posted, ordered[i - 1].posted));
    const cadence = classifyCadence(intervals);
    if (!cadence) continue;
    const avgAmount = ordered.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) / ordered.length;
    const matching = matchingCadenceIntervals(cadence, intervals);
    const confidence = intervals.length > 0 ? matching / intervals.length : 0;
    recurring.push({
      merchant: merchantLabel(merchant),
      cadence,
      monthlyCost: Math.round(cadenceToMonthlyAmount(cadence, avgAmount) * 100) / 100,
      annualCost: Math.round(cadenceToMonthlyAmount(cadence, avgAmount) * 12 * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      transactionCount: ordered.length,
    });
  }

  return recurring.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

function buildSubscriptionCandidates(recurring: RecurringMerchant[]): SubscriptionCandidate[] {
  return recurring
    .filter((item) => item.cadence === 'monthly' && item.monthlyCost >= 5 && item.monthlyCost <= 200)
    .filter((item) => !INSURANCE_HINTS.some((hint) => item.merchant.toLowerCase().includes(hint)))
    .slice(0, 12)
    .map((item) => ({
      merchant: item.merchant,
      monthlyCost: item.monthlyCost,
      annualCost: item.annualCost,
      confidence: item.confidence,
      rationale: item.monthlyCost >= 40
        ? 'High monthly recurring cost; consider cancellation or plan downgrade.'
        : 'Recurring charge worth periodic value audit or service consolidation.',
    }));
}

function buildInsuranceOptimization(expenses: ExpenseTransaction[]): ExpenseAnalysisSummary['insuranceOptimization'] {
  const insuranceExpenses = expenses.filter((tx) => {
    const content = `${tx.category?.name ?? ''} ${tx.payee ?? ''} ${tx.description}`.toLowerCase();
    return INSURANCE_HINTS.some((hint) => content.includes(hint));
  });
  if (insuranceExpenses.length === 0) {
    return { monthlyAverage: 0, premiumTrendPercent: 0, providerCount: 0 };
  }

  const monthlyTotals = new Map<string, number>();
  const providers = new Set<string>();
  for (const tx of insuranceExpenses) {
    const key = toMonthKey(tx.posted);
    monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + Math.abs(tx.amount));
    providers.add(normalizePayee(tx.payee || tx.description));
  }
  const months = Array.from(monthlyTotals.keys()).sort((a, b) => a.localeCompare(b));
  const values = months.map((month) => monthlyTotals.get(month) ?? 0);
  const monthlyAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = values.slice(0, Math.max(1, Math.floor(values.length / 2))).reduce((sum, value) => sum + value, 0)
    / Math.max(1, Math.floor(values.length / 2));
  const secondWindow = values.slice(Math.floor(values.length / 2));
  const second = secondWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, secondWindow.length);
  const premiumTrendPercent = first > 0 ? ((second - first) / first) * 100 : 0;

  return {
    monthlyAverage: Math.round(monthlyAverage * 100) / 100,
    premiumTrendPercent: Math.round(premiumTrendPercent * 10) / 10,
    providerCount: providers.size,
  };
}

function buildNegotiationCandidates(expenses: ExpenseTransaction[], recurring: RecurringMerchant[]): NegotiationCandidate[] {
  const recurringByMerchant = new Map(recurring.map((item) => [normalizePayee(item.merchant), item]));
  const candidates: NegotiationCandidate[] = [];

  for (const tx of expenses) {
    const merchantKey = normalizePayee(tx.payee || tx.description);
    const haystack = `${tx.payee ?? ''} ${tx.description} ${tx.category?.name ?? ''}`.toLowerCase();
    if (!NEGOTIABLE_HINTS.some((hint) => haystack.includes(hint))) continue;
    const recurringItem = recurringByMerchant.get(merchantKey);
    const monthlySpend = recurringItem?.monthlyCost ?? Math.abs(tx.amount);
    const estimatedMonthlySavings = Math.round(monthlySpend * 0.1 * 100) / 100;
    candidates.push({
      merchant: merchantLabel(merchantKey),
      averageMonthlySpend: Math.round(monthlySpend * 100) / 100,
      estimatedMonthlySavings,
      rationale: 'Comparable providers often offer lower rates with plan changes or retention discounts.',
    });
  }

  const dedup = new Map<string, NegotiationCandidate>();
  for (const candidate of candidates) {
    const prev = dedup.get(candidate.merchant);
    if (!prev || candidate.averageMonthlySpend > prev.averageMonthlySpend) dedup.set(candidate.merchant, candidate);
  }

  return Array.from(dedup.values())
    .sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings)
    .slice(0, 8);
}

function confidenceForAmount(amount: number): Confidence {
  if (amount >= 100) return 'high';
  if (amount >= 30) return 'medium';
  return 'low';
}

function buildSavingsOpportunities(
  subscriptions: SubscriptionCandidate[],
  negotiation: NegotiationCandidate[],
  insurance: ExpenseAnalysisSummary['insuranceOptimization'],
): SavingsOpportunity[] {
  const opportunities: SavingsOpportunity[] = [];
  for (const sub of subscriptions.slice(0, 5)) {
    const monthly = Math.round(sub.monthlyCost * 0.5 * 100) / 100;
    opportunities.push({
      title: `Optimize ${sub.merchant} subscription`,
      description: 'Review usage and downgrade, merge, or cancel if low value.',
      estimatedMonthlySavings: monthly,
      estimatedAnnualSavings: Math.round(monthly * 12 * 100) / 100,
      confidence: confidenceForAmount(monthly),
    });
  }

  for (const candidate of negotiation.slice(0, 3)) {
    opportunities.push({
      title: `Negotiate ${candidate.merchant} bill`,
      description: candidate.rationale,
      estimatedMonthlySavings: candidate.estimatedMonthlySavings,
      estimatedAnnualSavings: Math.round(candidate.estimatedMonthlySavings * 12 * 100) / 100,
      confidence: confidenceForAmount(candidate.estimatedMonthlySavings),
    });
  }

  if (insurance.monthlyAverage > 0) {
    const monthly = Math.round(insurance.monthlyAverage * 0.15 * 100) / 100;
    opportunities.push({
      title: 'Shop around insurance premiums',
      description: 'Request quotes from competing providers and leverage current policy details for comparison.',
      estimatedMonthlySavings: monthly,
      estimatedAnnualSavings: Math.round(monthly * 12 * 100) / 100,
      confidence: confidenceForAmount(monthly),
    });
  }

  const rankedOpportunities = [...opportunities].sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);
  return rankedOpportunities.slice(0, 10);
}

export function analyzeExpenseOptimization(transactions: ExpenseTransaction[], periodCovered: string): ExpenseAnalysisSummary {
  const expenses = transactions.filter((tx) => isExpenseTransaction(tx));
  const totalExpenses = Math.round(expenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) * 100) / 100;
  let essential = 0;
  let discretionary = 0;
  for (const tx of expenses) {
    if (classifyEssentialDiscretionary(tx) === 'essential') essential += Math.abs(tx.amount);
    else discretionary += Math.abs(tx.amount);
  }

  const recurring = detectRecurringMerchants(expenses);
  const subscriptions = buildSubscriptionCandidates(recurring);
  const insurance = buildInsuranceOptimization(expenses);
  const negotiation = buildNegotiationCandidates(expenses, recurring);
  const opportunities = buildSavingsOpportunities(subscriptions, negotiation, insurance);
  const denominator = essential + discretionary;

  return {
    periodCovered,
    totalExpenses,
    transactionCount: expenses.length,
    essentialVsDiscretionary: {
      essential: Math.round(essential * 100) / 100,
      discretionary: Math.round(discretionary * 100) / 100,
      essentialRatio: denominator > 0 ? Math.round((essential / denominator) * 1000) / 1000 : 0,
      discretionaryRatio: denominator > 0 ? Math.round((discretionary / denominator) * 1000) / 1000 : 0,
    },
    topRecurringMerchants: recurring.slice(0, 20),
    subscriptionCandidates: subscriptions,
    insuranceOptimization: insurance,
    negotiationCandidates: negotiation,
    savingsOpportunities: opportunities,
    dataQuality: expenses.length >= 20 ? 'sufficient' : 'insufficient',
  };
}

export async function generateExpenseAnalysis(options: { overwriteExisting?: boolean } = {}): Promise<any> {
  const missingConfig = getMissingAzureOpenAIConfig();
  if (missingConfig.length > 0) {
    throw new Error(`Missing Azure OpenAI config: ${missingConfig.join(', ')}`);
  }

  const now = new Date();
  const overwriteExisting = options.overwriteExisting === true;
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const existing = await prisma.report.findFirst({
    where: { type: ReportType.SPENDING_ANALYSIS, period },
    orderBy: { generatedAt: 'desc' },
  });
  if (existing && !overwriteExisting) return existing;

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const txRows = await prisma.transaction.findMany({
    where: {
      posted: { gte: start, lt: end },
    },
    select: {
      posted: true,
      amount: true,
      description: true,
      payee: true,
      memo: true,
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
  });

  const normalized: ExpenseTransaction[] = txRows.map((tx) => ({
    posted: tx.posted,
    amount: decimalToNumber(tx.amount),
    description: tx.description,
    payee: tx.payee,
    memo: tx.memo,
    category: tx.category ? { name: tx.category.name } : null,
  }));
  const periodCovered = `${start.toISOString().split('T')[0]} to ${new Date(end.getTime() - 86400000).toISOString().split('T')[0]}`;
  const summary = analyzeExpenseOptimization(normalized, periodCovered);

  const prompt = buildExpenseAnalysisPrompt({
    periodCovered: summary.periodCovered,
    totalExpenses: summary.totalExpenses,
    transactionCount: summary.transactionCount,
    essentialVsDiscretionary: summary.essentialVsDiscretionary,
    topRecurringMerchants: summary.topRecurringMerchants.slice(0, 30),
    subscriptionCandidates: summary.subscriptionCandidates.slice(0, 15),
    insuranceOptimization: summary.insuranceOptimization,
    negotiationCandidates: summary.negotiationCandidates.slice(0, 10),
    savingsOpportunities: summary.savingsOpportunities.slice(0, 10),
  });

  const response = await openai.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT!,
    messages: [{ role: 'user', content: prompt }],
    temperature: process.env.AZURE_OPENAI_TEMPERATURE ? Number(process.env.AZURE_OPENAI_TEMPERATURE) : 1,
    response_format: { type: 'json_object' },
  });
  const llmContent = response.choices[0]?.message?.content;
  if (!llmContent) throw new Error('No content in LLM response');
  const insights = JSON.parse(llmContent) as {
    overview?: string;
    subscriptionStrategy?: { analysis?: string; actions?: string[] };
    insuranceStrategy?: { analysis?: string; actions?: string[] };
    negotiationStrategy?: { analysis?: string; actions?: string[] };
    prioritizedActionPlan?: Array<{ priority: number; title: string; why: string; expectedMonthlySavings: number }>;
    overallInsight?: string;
  };

  const content = {
    reportDate: now.toISOString().split('T')[0],
    periodCovered: summary.periodCovered,
    dataQuality: summary.dataQuality,
    totalExpenses: summary.totalExpenses,
    transactionCount: summary.transactionCount,
    essentialVsDiscretionary: summary.essentialVsDiscretionary,
    topRecurringMerchants: summary.topRecurringMerchants,
    subscriptionCandidates: summary.subscriptionCandidates,
    insuranceOptimization: summary.insuranceOptimization,
    negotiationCandidates: summary.negotiationCandidates,
    savingsOpportunities: summary.savingsOpportunities,
    overview: insights.overview ?? '',
    subscriptionStrategy: {
      analysis: insights.subscriptionStrategy?.analysis ?? '',
      actions: insights.subscriptionStrategy?.actions ?? [],
    },
    insuranceStrategy: {
      analysis: insights.insuranceStrategy?.analysis ?? '',
      actions: insights.insuranceStrategy?.actions ?? [],
    },
    negotiationStrategy: {
      analysis: insights.negotiationStrategy?.analysis ?? '',
      actions: insights.negotiationStrategy?.actions ?? [],
    },
    prioritizedActionPlan: insights.prioritizedActionPlan ?? [],
    overallInsight: insights.overallInsight ?? '',
  };

  if (existing && overwriteExisting) {
    return prisma.report.update({
      where: { id: existing.id },
      data: {
        title: `Expense Optimization Analysis - ${period}`,
        content: content as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
    });
  }

  return prisma.report.create({
    data: {
      title: `Expense Optimization Analysis - ${period}`,
      type: ReportType.SPENDING_ANALYSIS,
      content: content as unknown as Prisma.InputJsonValue,
      period,
    },
  });
}
