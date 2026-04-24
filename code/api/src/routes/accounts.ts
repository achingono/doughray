import { Router } from 'express';
import { z, ZodError } from 'zod';
import {
  getAllAccounts,
  getAccountById,
  getAccountCreditCardDetails,
  getAccountRegisteredDetails,
  updateAccountBalance,
  updateImportedAccountInstitution,
  upsertAccountCreditCardDetails,
  upsertAccountLoanDetails,
  upsertAccountRegisteredDetails,
} from '../services/account.service';
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

const registeredDetailsSchema = z
  .object({
    registrationType: z.enum(['RRSP', 'TFSA', 'RESP', 'RIF', 'RDSP']),
    annualContributionLimit: z.number().finite().nonnegative().optional(),
    totalContributionRoom: z.number().finite().nonnegative().optional(),
    contributedThisYear: z.number().finite().nonnegative().optional(),
    unusedCarryforward: z.number().finite().nonnegative().optional(),
    beneficiaryName: z.string().trim().min(1).max(255).nullable().optional(),
    beneficiaryDateOfBirth: z.string().datetime().nullable().optional(),
    grantRoomAvailable: z.number().finite().nonnegative().nullable().optional(),
    grantsReceived: z.number().finite().nonnegative().nullable().optional(),
    subscriptionLimit: z.number().finite().nonnegative().nullable().optional(),
    verificationSource: z.enum(['CRA_NOTICE_OF_ASSESSMENT', 'INSTITUTION_STATEMENT', 'USER_ENTERED', 'IMPORTED']).optional(),
    lastVerifiedAt: z.string().datetime(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const totalContributionRoom = value.totalContributionRoom ?? 0;
    const contributedThisYear = value.contributedThisYear ?? 0;
    const unusedCarryforward = value.unusedCarryforward ?? 0;

    if (contributedThisYear + unusedCarryforward > totalContributionRoom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalContributionRoom'],
        message: `Contributed this year (${contributedThisYear}) + unused carryforward (${unusedCarryforward}) exceeds total contribution room (${totalContributionRoom})`,
      });
    }

    const hasBeneficiaryName = value.beneficiaryName !== undefined && value.beneficiaryName !== null && value.beneficiaryName.trim().length > 0;
    const hasBeneficiaryDateOfBirth = value.beneficiaryDateOfBirth !== undefined && value.beneficiaryDateOfBirth !== null;

    if (value.registrationType === 'RESP' && (!hasBeneficiaryName || !hasBeneficiaryDateOfBirth)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beneficiaryDateOfBirth'],
        message: 'RESP requires both beneficiaryName and beneficiaryDateOfBirth',
      });
    }
  });

const creditCardDetailsSchema = z.object({
  creditLimit: z.number().finite().positive(),
  currentUtilization: z.number().finite().min(0).max(100),
  annualPercentageRate: z.number().finite().nonnegative(),
  minimumPaymentDueDate: z.number().int().min(1).max(31),
  lastStatementBalance: z.number().finite().nonnegative().optional(),
  lastStatementDate: z.string().datetime().nullable().optional(),
  hasAnnualFee: z.boolean().optional(),
  annualFeeAmount: z.number().finite().nonnegative().nullable().optional(),
  rewardsProgram: z.enum(['NONE', 'CASH_BACK', 'POINTS', 'MILES', 'TRAVEL_CREDIT']).nullable().optional(),
  rewardsRate: z.number().finite().nonnegative().nullable().optional(),
  rewardsRedeemedThisYear: z.number().finite().nonnegative().nullable().optional(),
  issuingBank: z.string().trim().min(1).max(255).nullable().optional(),
  cardType: z.enum(['CREDIT', 'CHARGE', 'SECURED']).nullable().optional(),
  verificationSource: z.enum(['INSTITUTION_STATEMENT', 'USER_ENTERED', 'SYNCED_FROM_ACCOUNT_AGGREGATOR']).optional(),
  lastVerifiedAt: z.string().datetime(),
  notes: z.string().trim().max(2000).nullable().optional(),
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

router.get('/:id/registered-details', async (req, res, next) => {
  try {
    const details = await getAccountRegisteredDetails(req.params.id);
    if (!details) {
      throw new AppError(404, 'Registered details not found', 'NOT_FOUND');
    }
    res.json({ data: details });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/registered-details', async (req, res, next) => {
  try {
    const body = registeredDetailsSchema.parse(req.body);
    const details = await upsertAccountRegisteredDetails(req.params.id, {
      registrationType: body.registrationType,
      annualContributionLimit: body.annualContributionLimit,
      totalContributionRoom: body.totalContributionRoom,
      contributedThisYear: body.contributedThisYear,
      unusedCarryforward: body.unusedCarryforward,
      beneficiaryName: body.beneficiaryName,
      beneficiaryDateOfBirth:
        body.beneficiaryDateOfBirth === undefined ? undefined : body.beneficiaryDateOfBirth ? new Date(body.beneficiaryDateOfBirth) : null,
      grantRoomAvailable: body.grantRoomAvailable,
      grantsReceived: body.grantsReceived,
      subscriptionLimit: body.subscriptionLimit,
      verificationSource: body.verificationSource,
      lastVerifiedAt: new Date(body.lastVerifiedAt),
      notes: body.notes,
    });

    if (!details) {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }

    res.json({ data: details });
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

router.get('/:id/credit-card-details', async (req, res, next) => {
  try {
    const details = await getAccountCreditCardDetails(req.params.id);
    if (!details) {
      throw new AppError(404, 'Credit card details not found', 'NOT_FOUND');
    }
    res.json({ data: details });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/credit-card-details', async (req, res, next) => {
  try {
    const body = creditCardDetailsSchema.parse(req.body);
    const details = await upsertAccountCreditCardDetails(req.params.id, {
      creditLimit: body.creditLimit,
      currentUtilization: body.currentUtilization,
      annualPercentageRate: body.annualPercentageRate,
      minimumPaymentDueDate: body.minimumPaymentDueDate,
      lastStatementBalance: body.lastStatementBalance,
      lastStatementDate: body.lastStatementDate === undefined ? undefined : body.lastStatementDate ? new Date(body.lastStatementDate) : null,
      hasAnnualFee: body.hasAnnualFee,
      annualFeeAmount: body.annualFeeAmount,
      rewardsProgram: body.rewardsProgram,
      rewardsRate: body.rewardsRate,
      rewardsRedeemedThisYear: body.rewardsRedeemedThisYear,
      issuingBank: body.issuingBank,
      cardType: body.cardType,
      verificationSource: body.verificationSource,
      lastVerifiedAt: new Date(body.lastVerifiedAt),
      notes: body.notes,
    });

    if (!details) {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }

    res.json({ data: details });
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
