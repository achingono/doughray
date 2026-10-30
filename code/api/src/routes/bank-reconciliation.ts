import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/error-handler';
import { commitMigrationReview, discardMigrationReview, getMigrationReview, saveMigrationDraft, getUndoableMigration, undoMigrationReview } from '../services/bank-reconciliation.service';

const router = Router();
const decisionsSchema = z.object({ decisions: z.array(z.object({ candidateId: z.string().min(1),
  action: z.enum(['SAME_TRANSACTION', 'NEW_TRANSACTION']), transactionId: z.string().min(1).optional() })).max(10000) });

router.get('/:connectionId', async (req, res, next) => {
  try { res.json({ data: await getMigrationReview(req.params.connectionId) }); } catch (error) { next(error); }
});
router.get('/:connectionId/undo', async (req, res, next) => {
  try { res.json({ data: await getUndoableMigration(req.params.connectionId) }); } catch (error) { next(error); }
});
router.post('/:connectionId/:batchId/undo', async (req, res, next) => {
  try { res.json({ data: await undoMigrationReview(req.params.connectionId, req.params.batchId) }); } catch (error) { next(error); }
});
router.put('/:connectionId/:batchId/draft', async (req, res, next) => {
  try {
    const parsed = decisionsSchema.extend({ version: z.number().int().nonnegative() }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid reconciliation draft.', 'VALIDATION_ERROR');
    res.json({ data: await saveMigrationDraft(req.params.connectionId, req.params.batchId, parsed.data.version, parsed.data.decisions) });
  } catch (error) { next(error); }
});
router.post('/:connectionId/:batchId/commit', async (req, res, next) => {
  try {
    const parsed = decisionsSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid reconciliation decisions.', 'VALIDATION_ERROR');
    res.json({ data: await commitMigrationReview(req.params.connectionId, req.params.batchId, parsed.data.decisions) });
  } catch (error) { next(error); }
});
router.post('/:connectionId/:batchId/discard', async (req, res, next) => {
  try { await discardMigrationReview(req.params.connectionId, req.params.batchId); res.status(204).end(); } catch (error) { next(error); }
});
export default router;
