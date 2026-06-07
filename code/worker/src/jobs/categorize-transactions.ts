import prisma from '../lib/prisma';
import openai, {
  getMissingOpenAIConfig,
  getOpenAIModel,
  getOpenAITemperature,
  isOpenAIModelNotFoundError,
} from '../lib/openai';
import { normalizePayee } from '../lib/normalize-payee';
import { buildCategorizationPrompt } from '../prompts/categorize';

const BATCH_SIZE = 30;

type Assignment = {
  transactionId?: string;
  categoryId?: string;
  categoryName?: string;
};

function parseAssignments(content: string): Assignment[] {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  if (Array.isArray(parsed.assignments)) {
    return parsed.assignments;
  }

  if (Array.isArray(parsed.results)) {
    return parsed.results;
  }

  if (parsed.transactionId && (parsed.categoryId || parsed.categoryName)) {
    return [parsed];
  }

  return [];
}

function resolveCategoryId(
  assignment: Assignment,
  validCategoryIds: Set<string>,
  categoryIdByName: Map<string, string>
): string | undefined {
  if (assignment.categoryId && validCategoryIds.has(assignment.categoryId)) {
    return assignment.categoryId;
  }

  if (!assignment.categoryName) {
    return undefined;
  }

  return categoryIdByName.get(assignment.categoryName.trim().toLowerCase());
}

async function categorizeBatch(
  assignments: Assignment[],
  validCategoryIds: Set<string>,
  categoryIdByName: Map<string, string>
): Promise<number> {
  let categorized = 0;
  for (const assignment of assignments) {
    if (!assignment.transactionId) continue;

    const resolvedCategoryId = resolveCategoryId(
      assignment,
      validCategoryIds,
      categoryIdByName
    );
    if (!resolvedCategoryId) continue;

    await prisma.transaction
      .update({
        where: { id: assignment.transactionId },
        data: { categoryId: resolvedCategoryId },
      })
      .catch(() => {
        // Skip if transaction not found
      });

    categorized++;
  }
  return categorized;
}

function logBatchError(err: unknown, batchNumber: number): void {
  if (isOpenAIModelNotFoundError(err)) {
    console.error(
      `[Categorize] OpenAI model not found: "${getOpenAIModel()}". ` +
        'Set OPENAI_MODEL to your exact provider model name.'
    );
  }
  console.error(`[Categorize] Batch ${batchNumber} failed:`, err);
}

async function applyCategoryRulesToTransactions(transactionIds: string[]): Promise<number> {
  if (transactionIds.length === 0) return 0;

  const [rules, transactions] = await Promise.all([
    prisma.categoryRule.findMany({
      select: { id: true, normalizedPayee: true, accountId: true, categoryId: true },
    }),
    prisma.transaction.findMany({
      where: {
        id: { in: transactionIds },
        categoryId: null,
        isReviewed: false,
      },
      select: {
        id: true,
        accountId: true,
        description: true,
        payee: true,
      },
    }),
  ]);

  if (rules.length === 0 || transactions.length === 0) return 0;

  const accountScoped = new Map<string, { id: string; categoryId: string }>();
  const globalRules = new Map<string, { id: string; categoryId: string }>();
  for (const rule of rules) {
    if (rule.accountId) accountScoped.set(`${rule.accountId}::${rule.normalizedPayee}`, { id: rule.id, categoryId: rule.categoryId });
    else globalRules.set(rule.normalizedPayee, { id: rule.id, categoryId: rule.categoryId });
  }

  let applied = 0;
  for (const tx of transactions) {
    const key = normalizePayee(tx.payee || tx.description);
    if (key === 'unknown-merchant') continue;
    const rule = accountScoped.get(`${tx.accountId}::${key}`) ?? globalRules.get(key);
    if (!rule) continue;

    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        categoryId: rule.categoryId,
        isReviewed: true,
        categoryRuleId: rule.id,
      },
    });
    applied += 1;
  }

  return applied;
}

export async function categorizeTransactions(): Promise<number> {
  console.log('[Categorize] Starting transaction categorization...');
  const candidateUncategorized = await prisma.transaction.findMany({
    where: {
      categoryId: null,
      isReviewed: false,
    },
    orderBy: { posted: 'desc' },
    take: BATCH_SIZE * 3, // Process up to 3 batches per run
  });
  const candidateIds = candidateUncategorized.map((transaction) => transaction.id);
  const ruleApplied = await applyCategoryRulesToTransactions(candidateIds);

  const missingConfig = getMissingOpenAIConfig();
  if (missingConfig.length > 0) {
    console.warn(`[Categorize] Skipping: missing OpenAI config (${missingConfig.join(', ')})`);
    return ruleApplied;
  }

  const categories = await prisma.category.findMany({
    where: { children: { none: {} } }, // Leaf categories: includes top-level categories with no children
  });

  if (categories.length === 0) {
    console.log('[Categorize] No categories found, skipping');
    return ruleApplied;
  }

  const afterRuleApplication = await prisma.transaction.findMany({
    where: {
      id: { in: candidateIds },
      categoryId: null,
      isReviewed: false,
    },
    orderBy: { posted: 'desc' },
  });

  if (afterRuleApplication.length === 0) {
    console.log('[Categorize] No uncategorized transactions found');
    return ruleApplied;
  }

  let categorized = 0;
  const validCategoryIds = new Set(categories.map(c => c.id));
  const categoryIdByName = new Map(
    categories.map(c => [c.name.trim().toLowerCase(), c.id] as const)
  );

  for (let i = 0; i < afterRuleApplication.length; i += BATCH_SIZE) {
    const batch = afterRuleApplication.slice(i, i + BATCH_SIZE);
    const prompt = buildCategorizationPrompt(
      categories.map(c => ({ name: c.name, id: c.id })),
      batch.map(t => ({
        id: t.id,
        description: t.description,
        amount: t.amount.toString(),
        payee: t.payee || undefined,
      }))
    );

    try {
      const response = await openai.chat.completions.create({
        model: getOpenAIModel(),
        messages: [{ role: 'user', content: prompt }],
        temperature: getOpenAITemperature(),
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) continue;

      const assignments = parseAssignments(content);
      categorized += await categorizeBatch(assignments, validCategoryIds, categoryIdByName);

      console.log(`[Categorize] Batch ${Math.floor(i / BATCH_SIZE) + 1}: categorized ${assignments.length} transactions`);
    } catch (err) {
      logBatchError(err, Math.floor(i / BATCH_SIZE) + 1);
    }
  }

  console.log(`[Categorize] Total categorized: ${categorized}`);
  return ruleApplied + categorized;
}
