import prisma from '../lib/prisma';
import openai, {
  getMissingOpenAIConfig,
  getOpenAIModel,
  getOpenAITemperature,
  isOpenAIModelNotFoundError,
} from '../lib/openai';
import { buildMonthlyReportPrompt } from '../prompts/report';
import { isAssetType, isLiabilityType } from '../lib/account-types';

function decimalToNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

export async function generateMonthlyReport(): Promise<void> {
  const missingConfig = getMissingOpenAIConfig();
  if (missingConfig.length > 0) {
    console.warn(`[Report] Skipping: missing OpenAI config (${missingConfig.join(', ')})`);
    return;
  }

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const period = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

  console.log(`[Report] Generating monthly report for ${period}...`);

  // Check if report already exists
  const existing = await prisma.report.findFirst({
    where: { period, type: 'MONTHLY_SUMMARY' },
  });
  if (existing) {
    console.log(`[Report] Report for ${period} already exists, skipping`);
    return;
  }

  // Gather data
  const transactions = await prisma.transaction.findMany({
    where: { posted: { gte: lastMonth, lte: endOfLastMonth } },
    include: { category: true },
  });

  let totalIncome = 0;
  let totalExpenses = 0;
  const categorySpending = new Map<string, number>();

  for (const t of transactions) {
    const amt = decimalToNumber(t.amount);
    if (amt > 0) totalIncome += amt;
    else {
      totalExpenses += Math.abs(amt);
      const catName = t.category?.name || 'Uncategorized';
      categorySpending.set(catName, (categorySpending.get(catName) || 0) + Math.abs(amt));
    }
  }

  const topCategories = Array.from(categorySpending.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, amount]) => ({ name, amount }));

  const accounts = await prisma.account.findMany({ where: { isActive: true } });
  const accountSummaries = accounts.map(a => ({
    name: a.name,
    balance: decimalToNumber(a.balance),
    type: a.type,
  }));

  const prompt = buildMonthlyReportPrompt({
    period,
    totalIncome,
    totalExpenses,
    netSavings: totalIncome - totalExpenses,
    topCategories,
    accountSummaries,
    transactionCount: transactions.length,
  });

  try {
    const response = await openai.chat.completions.create({
      model: getOpenAIModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: getOpenAITemperature(),
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[Report] No content in LLM response');
      return;
    }

    const reportContent = JSON.parse(content);

    await prisma.report.create({
      data: {
        title: reportContent.title || `Monthly Report - ${period}`,
        type: 'MONTHLY_SUMMARY',
        content: reportContent,
        period,
      },
    });

    console.log(`[Report] Monthly report for ${period} generated successfully`);
  } catch (err) {
    if (isOpenAIModelNotFoundError(err)) {
      console.error(
        `[Report] OpenAI model not found: "${getOpenAIModel()}". ` +
        'Set OPENAI_MODEL to your exact provider model name.'
      );
    }
    console.error('[Report] Failed to generate report:', err);
  }
}

export async function takeNetWorthSnapshot(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`[Snapshot] Taking net worth snapshot for ${today.toISOString().split('T')[0]}...`);

  const accounts = await prisma.account.findMany({ where: { isActive: true } });

  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const a of accounts) {
    const bal = decimalToNumber(a.balance);
    if (isAssetType(a.type)) totalAssets += bal;
    else if (isLiabilityType(a.type)) totalLiabilities += Math.abs(bal);

    const netWorth = isAssetType(a.type) ? bal : -Math.abs(bal);
    await prisma.accountNetWorthSnapshot.upsert({
      where: {
        accountId_date: {
          accountId: a.id,
          date: today,
        },
      },
      update: {
        accountType: a.type,
        balance: bal,
        netWorth,
      },
      create: {
        accountId: a.id,
        date: today,
        accountType: a.type,
        balance: bal,
        netWorth,
      },
    });
  }

  // Include manual assets (real estate, etc.)
  const manualAssetTotal = await prisma.asset.aggregate({
    _sum: { currentValue: true },
  });
  totalAssets += decimalToNumber(manualAssetTotal._sum.currentValue);

  await prisma.netWorthSnapshot.upsert({
    where: { date: today },
    update: {
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    },
    create: {
      date: today,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    },
  });

  console.log(`[Snapshot] Net worth: $${(totalAssets - totalLiabilities).toFixed(2)} (Assets: $${totalAssets.toFixed(2)}, Liabilities: $${totalLiabilities.toFixed(2)})`);
}
