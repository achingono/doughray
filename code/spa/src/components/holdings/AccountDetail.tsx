import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { ACCOUNT_TYPE_LABELS, LIABILITY_TYPES, type AccountDetail as AccountDetailType, type LoanDetailSource, type LoanType, type InterestType, type PaymentFrequency } from "@/types";
import { api } from "@/lib/api";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

interface AccountDetailProps {
  accountId: string | null;
  open: boolean;
  onClose: () => void;
  onAccountUpdated?: () => Promise<void> | void;
}

const LOADING_ROW_KEYS = ['account-detail-loading-1', 'account-detail-loading-2', 'account-detail-loading-3', 'account-detail-loading-4', 'account-detail-loading-5'] as const;

const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  MORTGAGE: 'Mortgage',
  AUTO_LOAN: 'Auto Loan',
  PERSONAL_LOAN: 'Personal Loan',
  HELOC: 'HELOC',
  OTHER: 'Other',
};

const INTEREST_TYPE_LABELS: Record<InterestType, string> = {
  FIXED: 'Fixed',
  VARIABLE: 'Variable',
};

const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly',
  SEMI_MONTHLY: 'Semi-monthly',
  MONTHLY: 'Monthly',
};

const SOURCE_LABELS: Record<LoanDetailSource, string> = {
  USER_ENTERED: 'User Entered',
  IMPORTED: 'Imported',
  SYNCED: 'Synced',
};

function toDateInputValue(value: string | null): string {
  return value ? value.split('T')[0] ?? '' : '';
}

function toIsoDateOrNull(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function AccountDetail({ accountId, open, onClose, onAccountUpdated }: Readonly<AccountDetailProps>) {
  const [account, setAccount] = useState<AccountDetailType | null>(null);
  const [loading, setLoading] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [institutionOpen, setInstitutionOpen] = useState(false);
  const [balance, setBalance] = useState('');
  const [availableBalance, setAvailableBalance] = useState('');
  const [balanceDate, setBalanceDate] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [institutionError, setInstitutionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInstitutionSubmitting, setIsInstitutionSubmitting] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanError, setLoanError] = useState<string | null>(null);
  const [isLoanSubmitting, setIsLoanSubmitting] = useState(false);
  const [loanType, setLoanType] = useState<LoanType>('MORTGAGE');
  const [interestType, setInterestType] = useState<InterestType | ''>('');
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency | ''>('');
  const [source, setSource] = useState<LoanDetailSource>('USER_ENTERED');
  const [originalPrincipal, setOriginalPrincipal] = useState('');
  const [currentPrincipal, setCurrentPrincipal] = useState('');
  const [interestRateAnnual, setInterestRateAnnual] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [originalAmortizationMonths, setOriginalAmortizationMonths] = useState('');
  const [remainingAmortizationMonths, setRemainingAmortizationMonths] = useState('');
  const [termStartDate, setTermStartDate] = useState('');
  const [termMaturityDate, setTermMaturityDate] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [lastVerifiedAt, setLastVerifiedAt] = useState('');
  const [notes, setNotes] = useState('');

  const loadAccount = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const response = await api.getAccount(accountId);
      setAccount(response.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!accountId || !open) return;
    loadAccount();
  }, [accountId, open]);

  useEffect(() => {
    if (!adjustOpen || !account) return;
    setBalance(String(account.balance));
    setAvailableBalance(account.availableBalance === null ? '' : String(account.availableBalance));
    setBalanceDate(account.balanceDate.split('T')[0] || '');
    setAdjustError(null);
  }, [adjustOpen, account]);

  useEffect(() => {
    if (!loanOpen || !account) return;
    const details = account.loanDetails;
    setLoanType(details?.loanType ?? 'OTHER');
    setInterestType(details?.interestType ?? '');
    setPaymentFrequency(details?.paymentFrequency ?? '');
    setSource(details?.source ?? 'USER_ENTERED');
    setOriginalPrincipal(details?.originalPrincipal === null || details?.originalPrincipal === undefined ? '' : String(details.originalPrincipal));
    setCurrentPrincipal(details?.currentPrincipal === null || details?.currentPrincipal === undefined ? '' : String(details.currentPrincipal));
    setInterestRateAnnual(details?.interestRateAnnual === null || details?.interestRateAnnual === undefined ? '' : String(details.interestRateAnnual));
    setPaymentAmount(details?.paymentAmount === null || details?.paymentAmount === undefined ? '' : String(details.paymentAmount));
    setOriginalAmortizationMonths(details?.originalAmortizationMonths === null || details?.originalAmortizationMonths === undefined ? '' : String(details.originalAmortizationMonths));
    setRemainingAmortizationMonths(details?.remainingAmortizationMonths === null || details?.remainingAmortizationMonths === undefined ? '' : String(details.remainingAmortizationMonths));
    setTermStartDate(toDateInputValue(details?.termStartDate ?? null));
    setTermMaturityDate(toDateInputValue(details?.termMaturityDate ?? null));
    setRenewalDate(toDateInputValue(details?.renewalDate ?? null));
    setLastVerifiedAt(toDateInputValue(details?.lastVerifiedAt ?? null));
    setNotes(details?.notes ?? '');
    setLoanError(null);
  }, [loanOpen, account]);

  const handleAdjustSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsedBalance = Number(balance);
    if (!Number.isFinite(parsedBalance)) {
      setAdjustError('Enter a valid balance.');
      return;
    }

    if (availableBalance.trim() && !Number.isFinite(Number(availableBalance))) {
      setAdjustError('Enter a valid available balance or leave it blank.');
      return;
    }

    setAdjustError(null);
    setIsSubmitting(true);
    try {
      if (!account) return;
      const response = await api.updateAccountBalance(account.id, {
        balance: parsedBalance,
        availableBalance: availableBalance.trim() ? Number(availableBalance) : null,
        balanceDate: balanceDate ? new Date(`${balanceDate}T00:00:00.000Z`).toISOString() : undefined,
      });
      setAccount(response.data);
      setAdjustOpen(false);
      await onAccountUpdated?.();
      toast.success('Balance adjusted');
    } catch (err: any) {
      setAdjustError(err.message || 'Failed to update balance.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInstitutionSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!account) return;
    const trimmedInstitution = institutionName.trim();
    if (!trimmedInstitution) {
      setInstitutionError('Enter an institution name.');
      return;
    }

    setInstitutionError(null);
    setIsInstitutionSubmitting(true);
    try {
      const response = await api.updateAccountInstitution(account.id, {
        institution: trimmedInstitution,
      });
      setAccount(response.data);
      setInstitutionOpen(false);
      await onAccountUpdated?.();
      toast.success('Institution updated');
    } catch (err: any) {
      setInstitutionError(err.message || 'Failed to update institution.');
    } finally {
      setIsInstitutionSubmitting(false);
    }
  };

  const canEditInstitution = Boolean(
    account && (account.externalId.startsWith('manual-import:') || account.externalId.startsWith('excel-import:')),
  );
  const canEditLoanDetails = Boolean(account && LIABILITY_TYPES.includes(account.type));

  const handleLoanSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account) return;

    const parsedOriginalPrincipal = parseOptionalNumber(originalPrincipal);
    const parsedCurrentPrincipal = parseOptionalNumber(currentPrincipal);
    const parsedInterestRateAnnual = parseOptionalNumber(interestRateAnnual);
    const parsedPaymentAmount = parseOptionalNumber(paymentAmount);
    const parsedOriginalAmortizationMonths = parseOptionalInteger(originalAmortizationMonths);
    const parsedRemainingAmortizationMonths = parseOptionalInteger(remainingAmortizationMonths);
    const numericValues = [
      { label: 'Original principal', value: parsedOriginalPrincipal },
      { label: 'Current principal', value: parsedCurrentPrincipal },
      { label: 'Interest rate', value: parsedInterestRateAnnual },
      { label: 'Payment amount', value: parsedPaymentAmount },
      { label: 'Original amortization months', value: parsedOriginalAmortizationMonths },
      { label: 'Remaining amortization months', value: parsedRemainingAmortizationMonths },
    ];
    const invalid = numericValues.find((item) => Number.isNaN(item.value));
    if (invalid) {
      setLoanError(`${invalid.label} must be a valid number.`);
      return;
    }
    if (parsedOriginalAmortizationMonths !== null && !Number.isInteger(parsedOriginalAmortizationMonths)) {
      setLoanError('Original amortization months must be a whole number.');
      return;
    }
    if (parsedRemainingAmortizationMonths !== null && !Number.isInteger(parsedRemainingAmortizationMonths)) {
      setLoanError('Remaining amortization months must be a whole number.');
      return;
    }

    setLoanError(null);
    setIsLoanSubmitting(true);
    try {
      const response = await api.updateAccountLoanDetails(account.id, {
        loanType,
        originalPrincipal: parsedOriginalPrincipal,
        currentPrincipal: parsedCurrentPrincipal,
        interestType: interestType || null,
        interestRateAnnual: parsedInterestRateAnnual,
        paymentAmount: parsedPaymentAmount,
        paymentFrequency: paymentFrequency || null,
        originalAmortizationMonths: parsedOriginalAmortizationMonths,
        remainingAmortizationMonths: parsedRemainingAmortizationMonths,
        termStartDate: toIsoDateOrNull(termStartDate),
        termMaturityDate: toIsoDateOrNull(termMaturityDate),
        renewalDate: toIsoDateOrNull(renewalDate),
        lastVerifiedAt: toIsoDateOrNull(lastVerifiedAt),
        notes: notes.trim() ? notes.trim() : null,
        source,
      });
      setAccount(response.data);
      setLoanOpen(false);
      await onAccountUpdated?.();
      toast.success('Loan details updated');
    } catch (err: any) {
      setLoanError(err.message || 'Failed to update loan details.');
    } finally {
      setIsLoanSubmitting(false);
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{account?.name || 'Account Details'}</SheetTitle>
          <SheetDescription>{account?.institution || 'Loading...'}</SheetDescription>
        </SheetHeader>

        {loading || !account ? (
          <div className="space-y-4 mt-6">
            {LOADING_ROW_KEYS.map((key) => <div key={key} className="h-8 bg-muted animate-pulse rounded" />)}
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Balance</p>
                <p className="text-xl font-bold">{formatCurrency(account.balance)}</p>
                <p className="text-xs text-muted-foreground mt-1">As of {formatDate(account.balanceDate)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Type</p>
                <Badge variant="outline">{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
              </div>
              {account.availableBalance !== null && (
                <div>
                  <p className="text-sm text-muted-foreground">Available</p>
                  <p className="text-lg font-semibold">{formatCurrency(account.availableBalance)}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Transactions</p>
                <p className="text-lg font-semibold">{account.transactionCount}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {canEditInstitution && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setInstitutionName(account.institution ?? '');
                    setInstitutionError(null);
                    setInstitutionOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" /> Edit Institution
                </Button>
              )}
              <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Adjust Balance
              </Button>
              {canEditLoanDetails && (
                <Button variant="outline" onClick={() => setLoanOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit Loan Details
                </Button>
              )}
            </div>

            <Separator />

            {canEditLoanDetails && (
              <>
                <div>
                  <h4 className="font-semibold mb-3">Loan Details</h4>
                  {account.loanDetails ? (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Loan Type</p>
                        <p>{LOAN_TYPE_LABELS[account.loanDetails.loanType]}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Source</p>
                        <p>{SOURCE_LABELS[account.loanDetails.source]}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Original Principal</p>
                        <p>{account.loanDetails.originalPrincipal === null ? '—' : formatCurrency(account.loanDetails.originalPrincipal)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Current Principal</p>
                        <p>{account.loanDetails.currentPrincipal === null ? '—' : formatCurrency(account.loanDetails.currentPrincipal)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Interest</p>
                        <p>{account.loanDetails.interestType ? `${INTEREST_TYPE_LABELS[account.loanDetails.interestType]}${account.loanDetails.interestRateAnnual !== null ? ` • ${account.loanDetails.interestRateAnnual}%` : ''}` : '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Payment</p>
                        <p>{account.loanDetails.paymentAmount === null ? '—' : `${formatCurrency(account.loanDetails.paymentAmount)}${account.loanDetails.paymentFrequency ? ` • ${PAYMENT_FREQUENCY_LABELS[account.loanDetails.paymentFrequency]}` : ''}`}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Term Start</p>
                        <p>{account.loanDetails.termStartDate ? formatDate(account.loanDetails.termStartDate) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Term Maturity</p>
                        <p>{account.loanDetails.termMaturityDate ? formatDate(account.loanDetails.termMaturityDate) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Original Amortization</p>
                        <p>{account.loanDetails.originalAmortizationMonths === null ? '—' : `${account.loanDetails.originalAmortizationMonths} months`}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Remaining Amortization</p>
                        <p>{account.loanDetails.remainingAmortizationMonths === null ? '—' : `${account.loanDetails.remainingAmortizationMonths} months`}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Renewal Date</p>
                        <p>{account.loanDetails.renewalDate ? formatDate(account.loanDetails.renewalDate) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Last Verified</p>
                        <p>{account.loanDetails.lastVerifiedAt ? formatDate(account.loanDetails.lastVerifiedAt) : '—'}</p>
                      </div>
                      {account.loanDetails.notes && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground">Notes</p>
                          <p>{account.loanDetails.notes}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No loan details captured yet.</p>
                  )}
                </div>
                <Separator />
              </>
            )}

            <div>
              <h4 className="font-semibold mb-3">Recent Transactions</h4>
              {account.recentTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transactions yet.</p>
              ) : (
                <div className="space-y-2">
                  {account.recentTransactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between py-1.5">
                      <div>
                        <p className="text-sm">{t.description}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(t.posted)}</p>
                      </div>
                      <span className={`text-sm font-medium ${t.amount >= 0 ? 'text-emerald-600' : ''}`}>
                        {t.amount >= 0 ? '+' : ''}{formatCurrency(t.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Adjust Account Balance</DialogTitle>
          <DialogDescription>
            Overwrite the stored account balance to match current institution data without changing historical transactions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-balance">Current Balance</Label>
            <Input id="account-balance" type="number" step="0.01" value={balance} onChange={(event) => setBalance(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-available-balance">Available Balance</Label>
            <Input id="account-available-balance" type="number" step="0.01" value={availableBalance} onChange={(event) => setAvailableBalance(event.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-balance-date">Balance Date</Label>
            <Input id="account-balance-date" type="date" value={balanceDate} onChange={(event) => setBalanceDate(event.target.value)} />
          </div>
          {adjustError && <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{adjustError}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Balance'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={institutionOpen} onOpenChange={setInstitutionOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Edit Institution</DialogTitle>
          <DialogDescription>
            Update the institution name for this imported account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInstitutionSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-institution">Institution Name</Label>
            <Input
              id="account-institution"
              value={institutionName}
              onChange={(event) => setInstitutionName(event.target.value)}
            />
          </div>
          {institutionError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {institutionError}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInstitutionOpen(false)}
              disabled={isInstitutionSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isInstitutionSubmitting}>
              {isInstitutionSubmitting ? 'Saving...' : 'Save Institution'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={loanOpen} onOpenChange={setLoanOpen}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Loan Details</DialogTitle>
          <DialogDescription>
            Capture and maintain loan metadata for debt planning and renewal tracking.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleLoanSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="loan-type">Loan Type</Label>
              <select id="loan-type" className="w-full rounded-md border px-3 py-2 text-sm bg-background" value={loanType} onChange={(event) => setLoanType(event.target.value as LoanType)}>
                {Object.entries(LOAN_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-source">Source</Label>
              <select id="loan-source" className="w-full rounded-md border px-3 py-2 text-sm bg-background" value={source} onChange={(event) => setSource(event.target.value as LoanDetailSource)}>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-original-principal">Original Principal</Label>
              <Input id="loan-original-principal" type="number" step="0.01" value={originalPrincipal} onChange={(event) => setOriginalPrincipal(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-current-principal">Current Principal</Label>
              <Input id="loan-current-principal" type="number" step="0.01" value={currentPrincipal} onChange={(event) => setCurrentPrincipal(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-interest-type">Interest Type</Label>
              <select id="loan-interest-type" className="w-full rounded-md border px-3 py-2 text-sm bg-background" value={interestType} onChange={(event) => setInterestType((event.target.value as InterestType) || '')}>
                <option value="">Not set</option>
                {Object.entries(INTEREST_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-interest-rate">Interest Rate (Annual %)</Label>
              <Input id="loan-interest-rate" type="number" step="0.0001" value={interestRateAnnual} onChange={(event) => setInterestRateAnnual(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-payment-amount">Payment Amount</Label>
              <Input id="loan-payment-amount" type="number" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-payment-frequency">Payment Frequency</Label>
              <select id="loan-payment-frequency" className="w-full rounded-md border px-3 py-2 text-sm bg-background" value={paymentFrequency} onChange={(event) => setPaymentFrequency((event.target.value as PaymentFrequency) || '')}>
                <option value="">Not set</option>
                {Object.entries(PAYMENT_FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-term-start">Term Start Date</Label>
              <Input id="loan-term-start" type="date" value={termStartDate} onChange={(event) => setTermStartDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-term-maturity">Term Maturity Date</Label>
              <Input id="loan-term-maturity" type="date" value={termMaturityDate} onChange={(event) => setTermMaturityDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-original-amortization">Original Amortization (months)</Label>
              <Input id="loan-original-amortization" type="number" step="1" value={originalAmortizationMonths} onChange={(event) => setOriginalAmortizationMonths(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-remaining-amortization">Remaining Amortization (months)</Label>
              <Input id="loan-remaining-amortization" type="number" step="1" value={remainingAmortizationMonths} onChange={(event) => setRemainingAmortizationMonths(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-renewal-date">Renewal Date</Label>
              <Input id="loan-renewal-date" type="date" value={renewalDate} onChange={(event) => setRenewalDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-last-verified">Last Verified Date</Label>
              <Input id="loan-last-verified" type="date" value={lastVerifiedAt} onChange={(event) => setLastVerifiedAt(event.target.value)} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="loan-notes">Notes</Label>
              <Input id="loan-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          {loanError && <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{loanError}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLoanOpen(false)} disabled={isLoanSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isLoanSubmitting}>{isLoanSubmitting ? 'Saving...' : 'Save Loan Details'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
