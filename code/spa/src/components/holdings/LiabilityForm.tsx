import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { CreateLiabilityAccountInput, LoanType } from "@/types";

const loanDetailsSchema = z.object({
  loanType: z.enum(['MORTGAGE', 'AUTO_LOAN', 'PERSONAL_LOAN', 'HELOC', 'OTHER']).optional(),
  originalPrincipal: z.coerce.number().optional(),
  currentPrincipal: z.coerce.number().optional(),
  interestRateAnnual: z.coerce.number().optional(),
  paymentAmount: z.coerce.number().optional(),
  paymentFrequency: z.enum(['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY']).optional(),
  termStartDate: z.string().optional(),
  termMaturityDate: z.string().optional(),
  originalAmortizationMonths: z.coerce.number().int().optional(),
  remainingAmortizationMonths: z.coerce.number().int().optional(),
  notes: z.string().max(2000).optional(),
});

const liabilitySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(['CREDIT_CARD', 'LOAN', 'MORTGAGE']),
  institution: z.string().optional(),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']).default('USD'),
  balance: z.coerce.number(),
  includeLoanDetails: z.boolean().default(false),
  loanDetails: loanDetailsSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.includeLoanDetails && !value.loanDetails?.loanType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['loanDetails', 'loanType'],
      message: 'Loan type is required when including loan details',
    });
  }
});

type LiabilityFormValues = z.infer<typeof liabilitySchema>;

const toIsoDateTime = (value?: string): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

interface LiabilityFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateLiabilityAccountInput) => Promise<void>;
}

export function LiabilityForm({ open, onClose, onSubmit }: Readonly<LiabilityFormProps>) {
  const { register, handleSubmit, reset, control, watch, formState: { errors, isSubmitting } } = useForm<LiabilityFormValues>({
    resolver: zodResolver(liabilitySchema),
    defaultValues: {
      name: '',
      type: 'LOAN',
      currency: 'USD',
      balance: 0,
      includeLoanDetails: false,
    },
  });

  const includeLoanDetails = watch('includeLoanDetails');

  const submitLabel = isSubmitting ? 'Creating...' : 'Create Account';

  const handleFormSubmit = async (values: LiabilityFormValues) => {
    const { includeLoanDetails: _, ...rest } = values;

    const data: CreateLiabilityAccountInput = {
      name: rest.name,
      type: rest.type,
      institution: rest.institution || undefined,
      currency: rest.currency,
      balance: rest.balance,
      loanDetails: includeLoanDetails && rest.loanDetails ? {
        loanType: rest.loanDetails.loanType as LoanType,
        originalPrincipal: rest.loanDetails.originalPrincipal,
        currentPrincipal: rest.loanDetails.currentPrincipal,
        interestRateAnnual: rest.loanDetails.interestRateAnnual,
        paymentAmount: rest.loanDetails.paymentAmount,
        paymentFrequency: rest.loanDetails.paymentFrequency,
        termStartDate: toIsoDateTime(rest.loanDetails.termStartDate),
        termMaturityDate: toIsoDateTime(rest.loanDetails.termMaturityDate),
        originalAmortizationMonths: rest.loanDetails.originalAmortizationMonths,
        remainingAmortizationMonths: rest.loanDetails.remainingAmortizationMonths,
        notes: rest.loanDetails.notes || null,
      } : undefined,
    };

    await onSubmit(data);
    reset();
    onClose();
  };

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      reset();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Liability Account</DialogTitle>
          <DialogDescription>
            Add a new liability account to track loans, mortgages, or credit card balances.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Account Type */}
          <div className="space-y-2">
            <Label htmlFor="type">Account Type *</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                    <SelectItem value="LOAN">Loan</SelectItem>
                    <SelectItem value="MORTGAGE">Mortgage</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.type && <p className="text-xs text-red-500">{errors.type.message}</p>}
          </div>

          {/* Account Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Account Name *</Label>
            <Input
              id="name"
              placeholder="e.g. Primary Credit Card, Home Mortgage, Car Loan"
              {...register("name")}
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          {/* Institution */}
          <div className="space-y-2">
            <Label htmlFor="institution">Financial Institution</Label>
            <Input
              id="institution"
              placeholder="e.g. TD Bank, Chase, Royal Bank"
              {...register("institution")}
            />
          </div>

          {/* Balance */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <Select value={field.value ?? "USD"} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CAD">CAD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="balance">Current Balance ($) *</Label>
              <Input
                id="balance"
                type="number"
                step="0.01"
                placeholder="e.g. -5000"
                {...register("balance")}
              />
              {errors.balance && <p className="text-xs text-red-500">{errors.balance.message}</p>}
            </div>
          </div>

          {/* Loan Details Toggle */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Controller
                control={control}
                name="includeLoanDetails"
                render={({ field }) => (
                  <Checkbox
                    id="includeLoanDetails"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="includeLoanDetails" className="font-normal cursor-pointer">
                Include detailed loan information
              </Label>
            </div>
          </div>

          {/* Loan Details Section */}
          {includeLoanDetails && (
            <div className="border rounded-lg p-4 bg-slate-50 space-y-4">
              <h3 className="font-semibold text-sm">Loan Details (Optional)</h3>

              {/* Loan Type */}
              <div className="space-y-2">
                <Label htmlFor="loanType">Loan Type</Label>
                <Controller
                  control={control}
                  name="loanDetails.loanType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select loan type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MORTGAGE">Mortgage</SelectItem>
                        <SelectItem value="AUTO_LOAN">Auto Loan</SelectItem>
                        <SelectItem value="PERSONAL_LOAN">Personal Loan</SelectItem>
                        <SelectItem value="HELOC">Home Equity Line of Credit</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.loanDetails?.loanType && <p className="text-xs text-red-500">{errors.loanDetails.loanType.message}</p>}
              </div>

              {/* Principal Amounts */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="originalPrincipal">Original Principal ($)</Label>
                  <Input
                    id="originalPrincipal"
                    type="number"
                    step="0.01"
                    {...register("loanDetails.originalPrincipal")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currentPrincipal">Current Principal ($)</Label>
                  <Input
                    id="currentPrincipal"
                    type="number"
                    step="0.01"
                    {...register("loanDetails.currentPrincipal")}
                  />
                </div>
              </div>

              {/* Interest Rate */}
              <div className="space-y-2">
                <Label htmlFor="interestRateAnnual">Annual Interest Rate (%)</Label>
                <Input
                  id="interestRateAnnual"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 5.05"
                  {...register("loanDetails.interestRateAnnual")}
                />
              </div>

              {/* Payment Amount and Frequency */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="paymentAmount">Payment Amount ($)</Label>
                  <Input
                    id="paymentAmount"
                    type="number"
                    step="0.01"
                    {...register("loanDetails.paymentAmount")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentFrequency">Payment Frequency</Label>
                  <Controller
                    control={control}
                    name="loanDetails.paymentFrequency"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="WEEKLY">Weekly</SelectItem>
                          <SelectItem value="BIWEEKLY">Bi-Weekly</SelectItem>
                          <SelectItem value="SEMI_MONTHLY">Semi-Monthly</SelectItem>
                          <SelectItem value="MONTHLY">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              {/* Term Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="termStartDate">Term Start Date</Label>
                  <Input
                    id="termStartDate"
                    type="date"
                    {...register("loanDetails.termStartDate")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="termMaturityDate">Term Maturity Date</Label>
                  <Input
                    id="termMaturityDate"
                    type="date"
                    {...register("loanDetails.termMaturityDate")}
                  />
                </div>
              </div>

              {/* Amortization */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="originalAmortizationMonths">Original Amortization (months)</Label>
                  <Input
                    id="originalAmortizationMonths"
                    type="number"
                    {...register("loanDetails.originalAmortizationMonths")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="remainingAmortizationMonths">Remaining Amortization (months)</Label>
                  <Input
                    id="remainingAmortizationMonths"
                    type="number"
                    {...register("loanDetails.remainingAmortizationMonths")}
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Any additional information about this loan"
                  rows={4}
                  maxLength={2000}
                  {...register("loanDetails.notes")}
                />
                {errors.loanDetails?.notes && <p className="text-xs text-red-500">{errors.loanDetails.notes.message}</p>}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
