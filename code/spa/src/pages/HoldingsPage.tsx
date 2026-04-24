import { useState } from "react";
import { useHoldings } from "@/hooks/use-holdings";
import { useAccounts } from "@/hooks/use-accounts";
import { AccountSummaryCard } from "@/components/holdings/AccountSummaryCard";
import { HoldingsChart } from "@/components/holdings/HoldingsChart";
import { AccountDetail } from "@/components/holdings/AccountDetail";
import { LiabilityForm } from "@/components/holdings/LiabilityForm";
import { TrendLineChart } from "@/components/dashboard/TrendLineChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/formatters";
import { ACCOUNT_TYPE_LABELS, ASSET_TYPES, LIABILITY_TYPES, type CreateLiabilityAccountInput } from "@/types";
import { toast } from "sonner";

const SUMMARY_SKELETON_KEYS = ['holdings-summary-1', 'holdings-summary-2', 'holdings-summary-3'] as const;

export function HoldingsPage() {
  const [period, setPeriod] = useState("all");
  const { holdings, history, loading, error, refresh } = useHoldings(period);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showLiabilityForm, setShowLiabilityForm] = useState(false);
  const { createAccount } = useAccounts();

  const handleAccountUpdated = async () => {
    try {
      await refresh();
      toast.success('Account updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to refresh holdings');
    }
  };

  const handleCreateLiability = async (data: CreateLiabilityAccountInput) => {
    try {
      await createAccount(data);
      await refresh();
      setShowLiabilityForm(false);
      toast.success('Liability account created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create liability account');
      throw err;
    }
  };

  if (error) {
    return <div className="flex items-center justify-center h-[50vh]"><p className="text-muted-foreground">Failed to load: {error}</p></div>;
  }

  if (loading || !holdings) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Holdings</h2>
        <div className="grid gap-4 md:grid-cols-3">{SUMMARY_SKELETON_KEYS.map((key) => <Skeleton key={key} className="h-[120px] rounded-xl" />)}</div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  const assets = holdings.accounts.filter(a => ASSET_TYPES.includes(a.type));
  const liabilities = holdings.accounts.filter(a => LIABILITY_TYPES.includes(a.type));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Holdings</h2>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="3">3 Months</SelectItem>
            <SelectItem value="6">6 Months</SelectItem>
            <SelectItem value="12">12 Months</SelectItem>
            <SelectItem value="24">24 Months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <AccountSummaryCard title="Total Assets" amount={holdings.totalAssets} icon="TrendingUp" />
        <AccountSummaryCard title="Total Liabilities" amount={holdings.totalLiabilities} icon="CreditCard" />
        <AccountSummaryCard title="Net Worth" amount={holdings.netWorth} icon="Wallet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <div className="lg:col-span-4">
          <TrendLineChart data={history} title="Net Worth History" description="Historical net worth over time" />
        </div>
        <div className="lg:col-span-3">
          <HoldingsChart accounts={holdings.accounts} />
        </div>
      </div>

      {assets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <CardDescription>{assets.length} accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map(a => (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedAccountId(a.id)}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.institution || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{ACCOUNT_TYPE_LABELS[a.type]}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(a.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {liabilities.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Liabilities</CardTitle>
                <CardDescription>{liabilities.length} accounts</CardDescription>
              </div>
              <Button onClick={() => setShowLiabilityForm(true)} size="sm">
                Create Account
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liabilities.map(a => (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedAccountId(a.id)}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.institution || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{ACCOUNT_TYPE_LABELS[a.type]}</Badge></TableCell>
                    <TableCell className="text-right font-medium text-red-600">{formatCurrency(Math.abs(a.balance))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AccountDetail
        accountId={selectedAccountId}
        open={selectedAccountId !== null}
        onClose={() => setSelectedAccountId(null)}
        onAccountUpdated={handleAccountUpdated}
      />

      <LiabilityForm
        open={showLiabilityForm}
        onClose={() => setShowLiabilityForm(false)}
        onSubmit={handleCreateLiability}
      />
    </div>
  );
}
