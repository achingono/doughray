import { Router } from 'express';
import { z } from 'zod';
import {
  getRulesForAccount,
  createRule,
  updateRule,
  deleteRule,
  getTransactionsForAccount,
  runTrackingForAccount,
  runTrackingForAllAccounts,
  LoanTransactionRuleType,
} from '../services/loan-transaction.service';
import { validate } from '../middleware/validation';

const router = Router();

const createRuleSchema = z.object({
  ruleType: z.enum(['CATEGORY', 'PAYEE']),
  categoryId: z.string().trim().min(1).optional(),
  normalizedPayee: z.string().trim().min(1).optional(),
  description: z.string().trim().max(500).optional(),
});

const updateRuleSchema = z.object({
  ruleType: z.enum(['CATEGORY', 'PAYEE']).optional(),
  categoryId: z.string().trim().min(1).nullish(),
  normalizedPayee: z.string().trim().min(1).nullish(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});

router.get('/accounts/:accountId/rules', async (req, res, next) => {
  try {
    const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
    const rules = await getRulesForAccount(accountId);
    res.json({ data: rules });
  } catch (err) {
    next(err);
  }
});

router.post('/accounts/:accountId/rules', validate(createRuleSchema), async (req, res, next) => {
  try {
    const body = req.body as any;
    const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
    const rule = await createRule({
      accountId,
      ruleType: body.ruleType as LoanTransactionRuleType,
      categoryId: body.categoryId,
      normalizedPayee: body.normalizedPayee,
      description: body.description,
    });
    res.status(201).json({ data: rule });
  } catch (err) {
    next(err);
  }
});

router.patch('/rules/:ruleId', validate(updateRuleSchema), async (req, res, next) => {
  try {
    const body = req.body as any;
    const ruleId = Array.isArray(req.params.ruleId) ? req.params.ruleId[0] : req.params.ruleId;
    const rule = await updateRule(ruleId, {
      ruleType: body.ruleType as LoanTransactionRuleType | undefined,
      categoryId: body.categoryId,
      normalizedPayee: body.normalizedPayee,
      description: body.description,
      isActive: body.isActive,
    });
    res.json({ data: rule });
  } catch (err) {
    next(err);
  }
});

router.delete('/rules/:ruleId', async (req, res, next) => {
  try {
    const ruleId = Array.isArray(req.params.ruleId) ? req.params.ruleId[0] : req.params.ruleId;
    await deleteRule(ruleId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/accounts/:accountId/transactions', async (req, res, next) => {
  try {
    const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
    const transactions = await getTransactionsForAccount(accountId);
    res.json({ data: transactions });
  } catch (err) {
    next(err);
  }
});

router.post('/accounts/:accountId/tracking/run', async (req, res, next) => {
  try {
    const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
    const count = await runTrackingForAccount(accountId);
    res.json({ data: { trackedCount: count } });
  } catch (err) {
    next(err);
  }
});

router.post('/tracking/run-all', async (_req, res, next) => {
  try {
    const results = await runTrackingForAllAccounts();
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

export default router;