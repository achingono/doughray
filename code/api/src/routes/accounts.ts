import { Router } from 'express';
import { z, ZodError } from 'zod';
import { getAllAccounts, getAccountById, updateAccountBalance, updateImportedAccountInstitution, upsertAccountLoanDetails } from '../services/account.service';
import { AppError } from '../middleware/error-handler';

const router = Router();

const balanceUpdateSchema = z.object({
  balance: z.number().finite(),
  availableBalance: z.number().finite().nullable().optional(),
  balanceDate: z.string().datetime().optional(),
});

const institutionUpdateSchema = z.object({
  institution: z.string().trim().min(1),
});

const loanDetailsSchema = z
  .object({
    loanType: z.enum(['MORTGAGE', 'AUTO_LOAN', 'PERSONAL_LOAN', 'HELOC', 'OTHER']),
    originalPrincipal: z.number().finite().nonnegative().nullable().optional(),
    currentPrincipal: z.number().finite().nonnegative().nullable().optional(),
    interestType: z.enum(['FIXED', 'VARIABLE']).nullable().optional(),
    interestRateAnnual: z.number().finite().nonnegative().nullable().optional(),
    paymentAmount: z.number().finite().nonnegative().nullable().optional(),
    paymentFrequency: z.enum(['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY']).nullable().optional(),
    termStartDate: z.string().datetime().nullable().optional(),
    termMaturityDate: z.string().datetime().nullable().optional(),
    originalAmortizationMonths: z.number().int().positive().nullable().optional(),
    remainingAmortizationMonths: z.number().int().nonnegative().nullable().optional(),
    renewalDate: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    lastVerifiedAt: z.string().datetime().nullable().optional(),
    source: z.enum(['USER_ENTERED', 'IMPORTED', 'SYNCED']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.termStartDate && value.termMaturityDate) {
      const start = new Date(value.termStartDate);
      const maturity = new Date(value.termMaturityDate);
      if (maturity < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['termMaturityDate'],
          message: 'termMaturityDate must be on or after termStartDate',
        });
      }
    }

    if (
      value.originalAmortizationMonths !== undefined &&
      value.originalAmortizationMonths !== null &&
      value.remainingAmortizationMonths !== undefined &&
      value.remainingAmortizationMonths !== null &&
      value.remainingAmortizationMonths > value.originalAmortizationMonths
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remainingAmortizationMonths'],
        message: 'remainingAmortizationMonths cannot exceed originalAmortizationMonths',
      });
    }
  });

router.get('/', async (_req, res, next) => {
  try {
    const accounts = await getAllAccounts();
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const account = await getAccountById(req.params.id);
    if (!account) {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }
    res.json({ data: account });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/balance', async (req, res, next) => {
  try {
    const body = balanceUpdateSchema.parse(req.body);
    const account = await updateAccountBalance(req.params.id, {
      balance: body.balance,
      availableBalance: body.availableBalance,
      balanceDate: body.balanceDate ? new Date(body.balanceDate) : undefined,
    });

    if (!account) {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }

    res.json({ data: account });
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

router.patch('/:id/institution', async (req, res, next) => {
  try {
    const body = institutionUpdateSchema.parse(req.body);
    const account = await updateImportedAccountInstitution(req.params.id, {
      institution: body.institution,
    });

    if (!account) {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }

    res.json({ data: account });
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

router.patch('/:id/loan-details', async (req, res, next) => {
  try {
    const body = loanDetailsSchema.parse(req.body);
    const account = await upsertAccountLoanDetails(req.params.id, {
      loanType: body.loanType,
      originalPrincipal: body.originalPrincipal,
      currentPrincipal: body.currentPrincipal,
      interestType: body.interestType,
      interestRateAnnual: body.interestRateAnnual,
      paymentAmount: body.paymentAmount,
      paymentFrequency: body.paymentFrequency,
      termStartDate: body.termStartDate === undefined ? undefined : body.termStartDate ? new Date(body.termStartDate) : null,
      termMaturityDate: body.termMaturityDate === undefined ? undefined : body.termMaturityDate ? new Date(body.termMaturityDate) : null,
      originalAmortizationMonths: body.originalAmortizationMonths,
      remainingAmortizationMonths: body.remainingAmortizationMonths,
      renewalDate: body.renewalDate === undefined ? undefined : body.renewalDate ? new Date(body.renewalDate) : null,
      notes: body.notes,
      lastVerifiedAt: body.lastVerifiedAt === undefined ? undefined : body.lastVerifiedAt ? new Date(body.lastVerifiedAt) : null,
      source: body.source,
    });

    if (!account) {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }

    res.json({ data: account });
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

export default router;
