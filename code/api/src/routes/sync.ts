import { Router } from 'express';
import { getLatestSync, getSyncHistory } from '../services/sync.service';

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
    // In production, this would trigger the worker via a message queue or API call
    res.json({ data: { message: 'Sync triggered', status: 'queued' } });
  } catch (err) {
    next(err);
  }
});

export default router;
