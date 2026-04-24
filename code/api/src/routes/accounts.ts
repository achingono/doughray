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
  createAccount,
} from '../services/account.service';
import { AppError } from '../middleware/error-handler';

const router = Router();

const toOptionalDate = (value: string | null | undefined): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return value ? new Date(value) : null;
};

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

const createAccountSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(['CREDIT_CARD', 'LOAN', 'MORTGAGE']),
  institution: z.string().trim().nullable().default(null),
  currency: z.string().length(3).default('USD'),
  balance: z.number().finite(),
  balanceDate: z.string().datetime().optional(),
  loanDetails: loanDetailsSchema.optional(),
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

router.post('/', async (req, res, next) => {
  try {
    const body = createAccountSchema.parse(req.body);
    const account = await createAccount({
      name: body.name,
      type: body.type,
      institution: body.institution ?? null,
      currency: body.currency,
      balance: body.balance,
      balanceDate: toOptionalDate(body.balanceDate),
      loanDetails: body.loanDetails ? {
        loanType: body.loanDetails.loanType,
        originalPrincipal: body.loanDetails.originalPrincipal,
        currentPrincipal: body.loanDetails.currentPrincipal,
        interestType: body.loanDetails.interestType,
        interestRateAnnual: body.loanDetails.interestRateAnnual,
        paymentAmount: body.loanDetails.paymentAmount,
        paymentFrequency: body.loanDetails.paymentFrequency,
        termStartDate: toOptionalDate(body.loanDetails.termStartDate),
        termMaturityDate: toOptionalDate(body.loanDetails.termMaturityDate),
        originalAmortizationMonths: body.loanDetails.originalAmortizationMonths,
        remainingAmortizationMonths: body.loanDetails.remainingAmortizationMonths,
        renewalDate: toOptionalDate(body.loanDetails.renewalDate),
        notes: body.loanDetails.notes,
        lastVerifiedAt: toOptionalDate(body.loanDetails.lastVerifiedAt),
        source: body.loanDetails.source,
      } : undefined,
    });

    res.status(201).json({ data: account });
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

router.patch('/:id/balance', async (req, res, next) => {
  try {
    const body = balanceUpdateSchema.parse(req.body);
    const account = await updateAccountBalance(req.params.id, {
      balance: body.balance,
      availableBalance: body.availableBalance,
      balanceDate: toOptionalDate(body.balanceDate),
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
      termStartDate: toOptionalDate(body.termStartDate),
      termMaturityDate: toOptionalDate(body.termMaturityDate),
      originalAmortizationMonths: body.originalAmortizationMonths,
      remainingAmortizationMonths: body.remainingAmortizationMonths,
      renewalDate: toOptionalDate(body.renewalDate),
      notes: body.notes,
      lastVerifiedAt: toOptionalDate(body.lastVerifiedAt),
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
      beneficiaryDateOfBirth: toOptionalDate(body.beneficiaryDateOfBirth),
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
      lastStatementDate: toOptionalDate(body.lastStatementDate),
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
