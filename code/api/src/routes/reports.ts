import { Router } from 'express';
import { getReports, getReportById, deleteReportById } from '../services/report.service';
import { generatePFS } from '../services/pfs.service';
import { generateExpenseAnalysis } from '../services/expense-analysis.service';
import { AppError } from '../middleware/error-handler';

const router = Router();

function parseOverwriteExisting(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const value = (body as { overwriteExisting?: unknown }).overwriteExisting;
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new AppError(400, 'overwriteExisting must be a boolean', 'VALIDATION_ERROR');
  }
  return value;
}

router.post('/', async (req, res, next) => {
  try {
    const report = await generatePFS({ overwriteExisting: parseOverwriteExisting(req.body) });
    res.status(201).json({ data: await getReportById(report.id) ?? report });
  } catch (err) {
    next(err);
  }
});

router.post('/expense-analysis', async (req, res, next) => {
  try {
    const report = await generateExpenseAnalysis({ overwriteExisting: parseOverwriteExisting(req.body) });
    res.status(201).json({ data: await getReportById(report.id) ?? report });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Number.parseInt(req.query.page as string, 10) || 1;
    const limit = Number.parseInt(req.query.limit as string, 10) || 10;
    const result = await getReports(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) {
      throw new AppError(404, 'Report not found', 'NOT_FOUND');
    }
    res.json({ data: report });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const report = await getReportById(req.params.id);
    if (!report) {
      throw new AppError(404, 'Report not found', 'NOT_FOUND');
    }
    await deleteReportById(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
