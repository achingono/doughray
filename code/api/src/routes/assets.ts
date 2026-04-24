import { Router } from 'express';
import { z } from 'zod';
import { getAssets, getAssetById, createAsset, updateAsset, deleteAsset, addValuation } from '../services/asset.service';
import { validate } from '../middleware/validation';
import { AppError } from '../middleware/error-handler';

const router = Router();

const createAssetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['REAL_ESTATE', 'AUTOMOBILE', 'STOCK']).optional(),
  purchasePrice: z.number().min(0),
  currentValue: z.number().min(0),
  purchaseDate: z.string().datetime().optional().transform((v) => v ? new Date(v) : undefined),
  address: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  accountId: z.string().uuid().optional(),
});

const updateAssetSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['REAL_ESTATE', 'AUTOMOBILE', 'STOCK']).optional(),
  purchasePrice: z.number().min(0).optional(),
  currentValue: z.number().min(0).optional(),
  purchaseDate: z.string().datetime().optional().transform((v) => v ? new Date(v) : undefined),
  address: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  accountId: z.string().uuid().nullable().optional(),
});

const addValuationSchema = z.object({
  value: z.number().min(0),
  source: z.string().optional(),
});

router.get('/', async (_req, res, next) => {
  try {
    const assets = await getAssets();
    res.json({ data: assets });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const asset = await getAssetById(id);
    if (!asset) throw new AppError(404, 'Asset not found', 'NOT_FOUND');
    res.json({ data: asset });
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(createAssetSchema, 'body'), async (req, res, next) => {
  try {
    const asset = await createAsset(req.body);
    res.status(201).json({ data: asset });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validate(updateAssetSchema, 'body'), async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await updateAsset(id, req.body);
    res.json({ data: asset });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteAsset(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/valuations', validate(addValuationSchema, 'body'), async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await getAssetById(id);
    if (!asset) throw new AppError(404, 'Asset not found', 'NOT_FOUND');
    const valuation = await addValuation(id, req.body);
    res.status(201).json({ data: valuation });
  } catch (err) {
    next(err);
  }
});

export default router;
