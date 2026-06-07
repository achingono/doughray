import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { AppError } from '../middleware/error-handler';
import { deleteCategoryRule, listCategoryRules, createCategoryRule, type CreateCategoryRuleInput } from '../services/category-rule.service';

const router = Router();

const querySchema = z.object({
  page: z.string().default('1').transform(Number),
  limit: z.string().default('20').transform(Number),
});

const createCategoryRuleSchema = z.object({
  normalizedPayee: z.string().trim().min(1),
  categoryId: z.string().trim().min(1),
  sourceTransactionId: z.string().trim().min(1),
  accountId: z.string().trim().min(1).nullable().optional(),
});

router.get('/', validate(querySchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit } = req.query as unknown as z.infer<typeof querySchema>;
    const result = await listCategoryRules(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(createCategoryRuleSchema), async (req, res, next) => {
  try {
    const data = req.body as z.infer<typeof createCategoryRuleSchema>;
    const rule = await createCategoryRule(data as CreateCategoryRuleInput);
    res.status(201).json({ data: rule });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteCategoryRule(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
