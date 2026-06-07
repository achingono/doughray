import { Prisma } from '@prisma/client';
import openai, {
  getMissingOpenAIConfig,
  getOpenAIModel,
  getOpenAITemperature,
  isOpenAIModelNotFoundError,
} from '../lib/openai';
import { prisma } from '../lib/prisma';
import { buildCategorizationPrompt } from '../prompts/categorize';
import { applyCategoryRulesToTransactions } from './category-rule.service';

const BATCH_SIZE = 30;

type Assignment = {
  transactionId?: string;
  categoryId?: string;
  categoryName?: string;
};

function parseAssignments(content: string): Assignment[] {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.assignments)) return parsed.assignments;
  if (Array.isArray(parsed.results)) return parsed.results;
  if (parsed.transactionId && (parsed.categoryId || parsed.categoryName)) return [parsed];
  return [];
}

function resolveCategoryId(
  assignment: Assignment,
  validCategoryIds: Set<string>,
  categoryIdByName: Map<string, string>,
): string | undefined {
  if (assignment.categoryId && validCategoryIds.has(assignment.categoryId)) {
    return assignment.categoryId;
  }
  if (!assignment.categoryName) return undefined;
  return categoryIdByName.get(assignment.categoryName.trim().toLowerCase());
}

async function categorizeBatch(
  assignments: Assignment[],
  validCategoryIds: Set<string>,
  categoryIdByName: Map<string, string>,
): Promise<number> {
  let categorized = 0;

  for (const assignment of assignments) {
    if (!assignment.transactionId) continue;

    const resolvedCategoryId = resolveCategoryId(assignment, validCategoryIds, categoryIdByName);
    if (!resolvedCategoryId) continue;

    try {
      await prisma.transaction.update({
        where: { id: assignment.transactionId },
        data: { categoryId: resolvedCategoryId },
      });
      categorized += 1;
    } catch (err) {
      // Transaction may have been deleted between read and update.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        console.warn(`[Categorize] Transaction "${assignment.transactionId}" no longer exists; skipping.`);
        continue;
      }
      throw err;
    }
  }

  return categorized;
}

function logBatchError(err: unknown, batchNumber: number): void {
  if (isOpenAIModelNotFoundError(err)) {
    console.error(
      `[Categorize] OpenAI model not found: "${getOpenAIModel()}". ` +
        'Set OPENAI_MODEL to your exact provider model name.',
    );
  }
  console.error(`[Categorize] Batch ${batchNumber} failed:`, err);
}

export async function runTransactionCategorization(transactionIds: string[]): Promise<number> {
  if (transactionIds.length === 0) return 0;

  const ruleAppliedCount = await applyCategoryRulesToTransactions(transactionIds);

  const missingConfig = getMissingOpenAIConfig();
  if (missingConfig.length > 0) {
    console.warn(`[Categorize] Skipping: missing OpenAI config (${missingConfig.join(', ')})`);
    return ruleAppliedCount;
  }

  const categories = await prisma.category.findMany({
    where: { children: { none: {} } },
    select: { id: true, name: true },
  });
  if (categories.length === 0) return ruleAppliedCount;

  const uncategorized = await prisma.transaction.findMany({
    where: {
      id: { in: transactionIds },
      categoryId: null,
      isReviewed: false,
    },
    orderBy: { posted: 'desc' },
  });
  if (uncategorized.length === 0) return ruleAppliedCount;

  let categorized = 0;
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const categoryIdByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id] as const));

  for (let index = 0; index < uncategorized.length; index += BATCH_SIZE) {
    const batch = uncategorized.slice(index, index + BATCH_SIZE);
    const prompt = buildCategorizationPrompt(
      categories.map((category) => ({ name: category.name, id: category.id })),
      batch.map((transaction) => ({
        id: transaction.id,
        description: transaction.description,
        amount: transaction.amount.toString(),
        payee: transaction.payee || undefined,
      })),
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
      console.log(`[Categorize] Batch ${Math.floor(index / BATCH_SIZE) + 1}: categorized ${assignments.length} transactions`);
    } catch (err) {
      logBatchError(err, Math.floor(index / BATCH_SIZE) + 1);
    }
  }

  return ruleAppliedCount + categorized;
}

export function triggerTransactionCategorization(transactionIds: string[]): void {
  void runTransactionCategorization(transactionIds).catch((err) => {
    console.error('[Categorize] Triggered categorization run failed:', err);
  });
}
