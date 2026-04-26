import { useEffect, useState, useCallback } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { ACCOUNT_TYPE_LABELS, LIABILITY_TYPES, type AccountDetail as AccountDetailType, type LoanDetailSource, type LoanType, type InterestType, type PaymentFrequency, type LoanTransactionRule, type CreateLoanTransactionRuleInput, type Category } from "@/types";
import { api } from "@/lib/api";
import { Pencil, Trash2, Plus, RefreshCw } from "lucide-react";
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

  // Loan transaction tracking state
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [rules, setRules] = useState<LoanTransactionRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [isTrackingSubmitting, setIsTrackingSubmitting] = useState(false);
  const [isRunningTracking, setIsRunningTracking] = useState(false);
  const [newRuleType, setNewRuleType] = useState<'CATEGORY' | 'PAYEE'>('CATEGORY');
  const [newRuleCategoryId, setNewRuleCategoryId] = useState('');
  const [newRulePayee, setNewRulePayee] = useState('');
  const [newRuleDescription, setNewRuleDescription] = useState('');
  const [newRuleError, setNewRuleError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const loadAccount = useCallback(async () => {
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
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !open) return;
    loadAccount();
  }, [accountId, open, loadAccount]);

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

  const loadRules = useCallback(async () => {
    if (!accountId) return;
    setRulesLoading(true);
    try {
      const response = await api.getLoanTransactionRules(accountId);
      setRules(response.data);
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setRulesLoading(false);
    }
  }, [accountId]);

  const loadCategories = useCallback(async () => {
    try {
      const response = await api.getCategories();
      setCategories(response.data);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  useEffect(() => {
    if (!trackingOpen || !accountId) return;
    loadRules();
    loadCategories();
  }, [trackingOpen, accountId, loadRules, loadCategories]);

  const handleRunTracking = async () => {
    if (!accountId) return;
    setIsRunningTracking(true);
    try {
      const response = await api.runLoanTransactionTracking(accountId);
      toast.success(`Tracked ${response.data.trackedCount} transactions`);
      await loadAccount();
    } catch (err: any) {
      toast.error(err.message || 'Failed to run tracking');
    } finally {
      setIsRunningTracking(false);
    }
  };

  const handleAddRule = async () => {
    if (!accountId) return;
    if (newRuleType === 'CATEGORY' && !newRuleCategoryId) {
      setNewRuleError('Select a category');
      return;
    }
    if (newRuleType === 'PAYEE' && !newRulePayee.trim()) {
      setNewRuleError('Enter a payee name');
      return;
    }
    setNewRuleError(null);
    setIsTrackingSubmitting(true);
    try {
      const data: CreateLoanTransactionRuleInput = {
        ruleType: newRuleType,
        categoryId: newRuleType === 'CATEGORY' ? newRuleCategoryId : undefined,
        normalizedPayee: newRuleType === 'PAYEE' ? newRulePayee.trim() : undefined,
        description: newRuleDescription.trim() || undefined,
      };
      await api.createLoanTransactionRule(accountId, data);
      toast.success('Rule added');
      await loadRules();
      setNewRuleCategoryId('');
      setNewRulePayee('');
      setNewRuleDescription('');
    } catch (err: any) {
      setNewRuleError(err.message || 'Failed to add rule');
    } finally {
      setIsTrackingSubmitting(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await api.deleteLoanTransactionRule(ruleId);
      toast.success('Rule deleted');
      await loadRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete rule');
    }
  };

  const handleToggleRule = async (rule: LoanTransactionRule) => {
    try {
      await api.updateLoanTransactionRule(rule.id, { isActive: !rule.isActive });
      toast.success(rule.isActive ? 'Rule disabled' : 'Rule enabled');
      await loadRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update rule');
    }
  };

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
      <SheetContent className="w-[90vw] sm:w-[540px] md:w-[720px] lg:w-[800px] overflow-y-auto" data-lenis-prevent>
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
              {canEditLoanDetails && (
                <Button variant="outline" onClick={() => setTrackingOpen(true)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Track Transactions
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
              {(() => {
                const combinedTransactions = [
                  ...(account.recentTransactions?.map(t => ({ ...t, type: 'regular' as const })) || []),
                  ...(account.trackedTransactions?.map(t => ({
                    id: t.id,
                    posted: t.posted,
                    description: t.description + (t.sourceAccount ? ` (from ${t.sourceAccount})` : ''),
                    amount: t.amount,
                    type: 'tracked' as const
                  })) || [])
                ].sort((a, b) => new Date(b.posted).getTime() - new Date(a.posted).getTime());

                if (combinedTransactions.length === 0) {
                  return <p className="text-sm text-muted-foreground">No transactions yet.</p>;
                }

                return (
                  <div className="space-y-2">
                    {combinedTransactions.map((t, index) => {
                      // Ensure unique key: prefer id, otherwise include index in the fallback
                      const key = t.id !== undefined ? `${t.type}-${t.id}` : `${t.type}-${t.posted}-${index}`;
                      return (
                        <div key={key} className="flex items-center justify-between py-1.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm">{t.description}</p>
                              {t.type === 'tracked' && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Tracked</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{formatDate(t.posted)}</p>
                          </div>
                          <span className={`text-sm font-medium ${t.amount >= 0 ? 'text-emerald-600' : ''}`}>
                            {t.amount >= 0 ? '+' : ''}{formatCurrency(t.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
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
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto" data-lenis-prevent>
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
    <Dialog open={trackingOpen} onOpenChange={setTrackingOpen}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto" data-lenis-prevent>
        <DialogHeader>
          <DialogTitle>Transaction Tracking</DialogTitle>
          <DialogDescription>
            Automatically track loan payments from your source accounts based on categories or payee names.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={handleRunTracking} disabled={isRunningTracking}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRunningTracking ? 'animate-spin' : ''}`} />
              {isRunningTracking ? 'Running...' : 'Run Tracking Now'}
            </Button>
          </div>

          {account?.trackedTransactions && account.trackedTransactions.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Tracked Transactions ({account.trackedTransactions.length})</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {account.trackedTransactions.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                    <div>
                      <p className="font-medium">{t.description}</p>
                      <p className="text-xs text-muted-foreground">{t.sourceAccount} • {formatDate(t.posted)}</p>
                    </div>
                    <span className="font-medium">{formatCurrency(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div>
            <h4 className="font-semibold mb-2">Add Tracking Rule</h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Rule Type</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={newRuleType}
                  onChange={(e) => setNewRuleType(e.target.value as 'CATEGORY' | 'PAYEE')}
                >
                  <option value="CATEGORY">By Category</option>
                  <option value="PAYEE">By Payee Name</option>
                </select>
              </div>

              {newRuleType === 'CATEGORY' ? (
                <div className="space-y-2">
                  <Label>Category</Label>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                    value={newRuleCategoryId}
                    onChange={(e) => setNewRuleCategoryId(e.target.value)}
                  >
                    <option value="">Select category...</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Payee Name</Label>
                  <Input
                    value={newRulePayee}
                    onChange={(e) => setNewRulePayee(e.target.value)}
                    placeholder="e.g., Bank of America"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={newRuleDescription}
                  onChange={(e) => setNewRuleDescription(e.target.value)}
                  placeholder="e.g., Monthly mortgage payment"
                />
              </div>

              {newRuleError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {newRuleError}
                </div>
              )}

              <Button onClick={handleAddRule} disabled={isTrackingSubmitting} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                {isTrackingSubmitting ? 'Adding...' : 'Add Rule'}
              </Button>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-semibold mb-2">Active Rules</h4>
            {rulesLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tracking rules configured.</p>
            ) : (
              <div className="space-y-2">
                {rules.map(rule => {
                  const categoryName = rule.ruleType === 'CATEGORY'
                    ? categories.find(category => category.id === rule.categoryId)?.name ?? "Unknown Category"
                    : null;

                  return (
                    <div key={rule.id} className="flex items-center justify-between p-2 border rounded">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rule.isActive}
                          onChange={() => handleToggleRule(rule)}
                          className="h-4 w-4"
                        />
                        <div>
                          <p className="text-sm font-medium">
                            {rule.ruleType === 'CATEGORY'
                              ? `Category: ${categoryName}`
                              : `Payee: ${rule.normalizedPayee}`}
                          </p>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground">{rule.description}</p>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteRule(rule.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setTrackingOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
