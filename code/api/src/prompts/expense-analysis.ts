import { sanitizeAiText } from '@doughray/shared';

interface ExpenseOptimizationPromptData {
  periodCovered: string;
  totalExpenses: number;
  transactionCount: number;
  essentialVsDiscretionary: {
    essential: number;
    discretionary: number;
    essentialRatio: number;
    discretionaryRatio: number;
  };
  topRecurringMerchants: Array<{
    merchant: string;
    monthlyCost: number;
    annualCost: number;
    cadence: 'weekly' | 'monthly' | 'annual';
    confidence: number;
  }>;
  subscriptionCandidates: Array<{
    merchant: string;
    monthlyCost: number;
    annualCost: number;
    confidence: number;
    rationale: string;
  }>;
  insuranceOptimization: {
    monthlyAverage: number;
    premiumTrendPercent: number;
    providerCount: number;
  };
  negotiationCandidates: Array<{
    merchant: string;
    averageMonthlySpend: number;
    estimatedMonthlySavings: number;
    rationale: string;
  }>;
  savingsOpportunities: Array<{
    title: string;
    estimatedMonthlySavings: number;
    estimatedAnnualSavings: number;
    confidence: 'low' | 'medium' | 'high';
  }>;
}

export function buildExpenseAnalysisPrompt(data: ExpenseOptimizationPromptData): string {
  const recurringLines = data.topRecurringMerchants.length > 0
    ? data.topRecurringMerchants
      .map((item) => `  - ${sanitizeAiText(item.merchant)}: $${item.monthlyCost.toFixed(2)}/mo ($${item.annualCost.toFixed(2)}/yr), ${item.cadence}, confidence ${item.confidence.toFixed(2)}`)
      .join('\n')
    : '  - None detected';

  const subscriptionLines = data.subscriptionCandidates.length > 0
    ? data.subscriptionCandidates
      .map((item) => `  - ${sanitizeAiText(item.merchant)}: $${item.monthlyCost.toFixed(2)}/mo ($${item.annualCost.toFixed(2)}/yr), confidence ${item.confidence.toFixed(2)}. ${sanitizeAiText(item.rationale)}`)
      .join('\n')
    : '  - None detected';

  const negotiationLines = data.negotiationCandidates.length > 0
    ? data.negotiationCandidates
      .map((item) => `  - ${sanitizeAiText(item.merchant)}: spend $${item.averageMonthlySpend.toFixed(2)}/mo, est savings $${item.estimatedMonthlySavings.toFixed(2)}/mo. ${sanitizeAiText(item.rationale)}`)
      .join('\n')
    : '  - None detected';

  const opportunityLines = data.savingsOpportunities.length > 0
    ? data.savingsOpportunities
      .map((item) => `  - ${item.title}: est savings $${item.estimatedMonthlySavings.toFixed(2)}/mo ($${item.estimatedAnnualSavings.toFixed(2)}/yr), confidence ${item.confidence}`)
      .join('\n')
    : '  - None detected';

  return `You are a personal finance analyst focused on expense optimization.

All numeric metrics below are pre-calculated. Do not recompute them; interpret and prioritize actions.

=== PERIOD ===
${data.periodCovered}

=== EXPENSE BASELINE ===
Total Expenses: $${data.totalExpenses.toFixed(2)}
Expense Transactions: ${data.transactionCount}
Essential Expenses: $${data.essentialVsDiscretionary.essential.toFixed(2)} (${(data.essentialVsDiscretionary.essentialRatio * 100).toFixed(1)}%)
Discretionary Expenses: $${data.essentialVsDiscretionary.discretionary.toFixed(2)} (${(data.essentialVsDiscretionary.discretionaryRatio * 100).toFixed(1)}%)

=== TOP RECURRING MERCHANTS ===
${recurringLines}

=== SUBSCRIPTION CANDIDATES ===
${subscriptionLines}

=== INSURANCE OPTIMIZATION SIGNAL ===
Monthly Average Insurance Spend: $${data.insuranceOptimization.monthlyAverage.toFixed(2)}
Premium Trend: ${data.insuranceOptimization.premiumTrendPercent.toFixed(1)}%
Distinct Insurance Providers: ${data.insuranceOptimization.providerCount}

=== NEGOTIATION CANDIDATES ===
${negotiationLines}

=== DETERMINISTIC SAVINGS OPPORTUNITIES ===
${opportunityLines}

Output JSON only with this exact structure:
{
  "overview": "2-3 sentence overview of the expense profile and biggest optimization opportunities.",
  "subscriptionStrategy": {
    "analysis": "2-3 sentence interpretation of subscription leakage and consolidation opportunities.",
    "actions": ["Actionable recommendation 1", "Actionable recommendation 2"]
  },
  "insuranceStrategy": {
    "analysis": "2-3 sentence interpretation of insurance spend and whether shopping around is justified.",
    "actions": ["Actionable recommendation 1", "Actionable recommendation 2"]
  },
  "negotiationStrategy": {
    "analysis": "2-3 sentence interpretation of negotiable bills and likely savings.",
    "actions": ["Actionable recommendation 1", "Actionable recommendation 2"]
  },
  "prioritizedActionPlan": [
    { "priority": 1, "title": "Action title", "why": "Why this matters now", "expectedMonthlySavings": 0 }
  ],
  "overallInsight": "3-4 sentence summary with the single most important expense optimization move."
}`;
}
