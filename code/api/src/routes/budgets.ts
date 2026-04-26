import { Router } from 'express';
import { z } from 'zod';
import { getBudgets, createBudget, updateBudget, deleteBudget } from '../services/budget.service';
import { validate } from '../middleware/validation';

const router = Router();

const createBudgetSchema = z.object({
  categoryId: z.string().min(1, 'categoryId is required'),
  amount: z.number().positive('amount must be positive'),
  period: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional().default('MONTHLY'),
  startDate: z.string().optional().transform((v) => v ? new Date(v) : new Date()),
  endDate: z.string().optional().transform((v) => v ? new Date(v) : undefined),
});

const updateBudgetSchema = z.object({
  amount: z.number().positive().optional(),
  period: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  endDate: z.string().nullable().optional().transform((v) => v ? new Date(v) : undefined),
});

router.get('/', async (req, res, next) => {
  try {
    const period = req.query.period as string | undefined;
    const budgets = await getBudgets(period);
    res.json({ data: budgets });
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(createBudgetSchema, 'body'), async (req, res, next) => {
  try {
    const budget = await createBudget({
      categoryId: req.body.categoryId,
      amount: req.body.amount,
      period: req.body.period,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
    });
    res.status(201).json({ data: budget });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validate(updateBudgetSchema, 'body'), async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const budget = await updateBudget(id, req.body);
    res.json({ data: budget });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteBudget(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
