import { Router, type ParamsDictionary } from 'express';
import { z, ZodError } from 'zod';
import multer from 'multer';
import { getTransactions, getTransactionFilterCategories, updateTransactionCategory } from '../services/transaction.service';
import { getRecategorizePreview, recategorizeTransaction } from '../services/recategorization.service';
import { validate } from '../middleware/validation';
import { AppError } from '../middleware/error-handler';
import { importTransactionsFromFile } from '../services/transaction-import.service';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const querySchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  page: z.string().default('1').transform(Number),
  limit: z.string().default('50').transform(Number),
});

const filterCategoryQuerySchema = z.object({
  accountId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
});

const importBodySchema = z
  .object({
    accountId: z.string().trim().min(1).optional(),
    accountName: z.string().trim().min(1).optional(),
    institution: z.string().trim().min(1).optional(),
    currency: z.string().trim().min(1).optional(),
    accountType: z.preprocess(
      (value) => (typeof value === 'string' ? value.toUpperCase() : value),
      z.enum(['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'LOAN', 'MORTGAGE', 'OTHER']).optional(),
    ),
    accountBalance: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() ? Number(value) : undefined),
      z.number().finite().optional(),
    ),
    format: z.preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() : value),
      z.enum(['ofx', 'qfx', 'csv', 'xlsx']).optional(),
    ),
  });

const recategorizeScopeSchema = z.enum(['single-instance', 'all-past', 'all-future', 'all-past-and-future']);
const recategorizeBodySchema = z.object({
  categoryId: z.string().trim().min(1),
  scope: recategorizeScopeSchema,
});

const recategorizePreviewQuerySchema = z.object({
  scope: recategorizeScopeSchema.default('all-past'),
});

router.get<ParamsDictionary, any, any, z.infer<typeof querySchema>>('/', validate(querySchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit, startDate, endDate, ...rest } = req.query;
    const result = await getTransactions(
      {
        ...rest,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
      page,
      limit
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get<ParamsDictionary, any, any, z.infer<typeof filterCategoryQuerySchema>>('/filter-categories', validate(filterCategoryQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { accountId, search, startDate, endDate } = req.query;
    const categories = await getTransactionFilterCategories({
      accountId,
      search,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    res.json({ data: categories });
  } catch (err) {
    next(err);
  }
});

router.post('/import', (req, res, next) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr instanceof multer.MulterError) {
        next(new AppError(400, uploadErr.message, 'VALIDATION_ERROR'));
        return;
      }
      next(uploadErr);
      return;
    }

    try {
      if (!req.file) {
        throw new AppError(400, 'file is required', 'VALIDATION_ERROR');
      }

      const body = importBodySchema.parse(req.body);
      const importResult = await importTransactionsFromFile({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname || 'import.dat',
        format: body.format,
        accountId: body.accountId,
        newAccount: body.accountId || !body.accountName
          ? undefined
          : {
              name: body.accountName,
              institution: body.institution,
              currency: body.currency,
              type: body.accountType,
              balance: body.accountBalance,
            },
      });

      res.status(201).json({ data: importResult });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: {
            message: 'Validation error',
            code: 'VALIDATION_ERROR',
            details: err.errors,
          },
        });
        return;
      }
      next(err);
    }
  });
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) {
      throw new AppError(400, 'categoryId is required', 'VALIDATION_ERROR');
    }
    const updated = await updateTransactionCategory(req.params.id, categoryId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/recategorize-preview', validate(recategorizePreviewQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { scope } = req.query as unknown as z.infer<typeof recategorizePreviewQuerySchema>;
    const transactionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const preview = await getRecategorizePreview(transactionId, scope);
    res.json({ data: preview });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/recategorize', validate(recategorizeBodySchema), async (req, res, next) => {
  try {
    const { categoryId, scope } = req.body as z.infer<typeof recategorizeBodySchema>;
    const transactionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await recategorizeTransaction(transactionId, categoryId, scope);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
