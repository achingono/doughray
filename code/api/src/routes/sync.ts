import { Router } from 'express';
import { getLatestSync, getSyncHistory, triggerSync } from '../services/sync.service';

const router = Router();

router.get('/status', async (_req, res, next) => {
  try {
    const latest = await getLatestSync();
    res.json({ data: latest });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit as string, 10) || 10;
    const history = await getSyncHistory(limit);
    res.json({ data: history });
  } catch (err) {
    next(err);
  }
});

router.post('/trigger', async (_req, res, next) => {
  try {
    const log = await triggerSync();
    res.json({ data: { message: 'Sync triggered', status: log.status, id: log.id } });
  } catch (err) {
    next(err);
  }
});

export default router;
