import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, CheckCircle, XCircle, Clock, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/formatters";
import type { SyncStatus, Category, CategoryRule } from "@/types";
import { BankConnections } from '@/components/banks/BankConnections';

export function SettingsPage() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncStatus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    Promise.all([api.getSyncStatus(), api.getSyncHistory(), api.getCategories(), api.getCategoryRules(1, 100)])
      .then(([s, h, c, rules]) => {
        setSyncStatus(s.data);
        setSyncHistory(h.data);
        setCategories(c.data);
        setCategoryRules(rules.data);
      })
      .catch(console.error);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage('Sync queued.');
    try {
      const result = await api.triggerSync();
      for (let i = 0; i < 90; i++) {
        const job = (await api.getSyncJob(result.data.jobId)).data;
        if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(job.errorMessage || 'Sync did not complete.');
        if (job.status === 'SUCCEEDED') {
          const [status, history] = await Promise.all([api.getSyncStatus(), api.getSyncHistory()]);
          setSyncStatus(status.data); setSyncHistory(history.data); setSyncMessage('Sync complete.');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      setSyncMessage('Sync is still running. Check the status again later.');
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'SUCCESS': return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case 'FAILED': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'RUNNING': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' => {
    if (status === 'SUCCESS') return 'default';
    if (status === 'FAILED') return 'destructive';
    return 'secondary';
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await api.deleteCategoryRule(ruleId);
      setCategoryRules((previous) => previous.filter((rule) => rule.id !== ruleId));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold tracking-tight">Settings</h2>

      <BankConnections />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Data Sync</CardTitle>
              <CardDescription>SimpleFin connection and sync status</CardDescription>
            </div>
            <Button onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {syncMessage && <p role="status" className="mb-3 text-sm">{syncMessage}</p>}
          {syncStatus ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              {statusIcon(syncStatus.status)}
              <div>
                <p className="text-sm font-medium">Last sync: {formatDate(syncStatus.startedAt)}</p>
                <p className="text-xs text-muted-foreground">
                  {syncStatus.accountCount} accounts · {syncStatus.transactionCount} transactions
                  {syncStatus.errorMessage && <span className="text-red-500"> · {syncStatus.errorMessage}</span>}
                </p>
              </div>
              <Badge variant={statusBadgeVariant(syncStatus.status)} className="ml-auto">
                {syncStatus.status}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No sync history. Configure SimpleFin and run your first sync.</p>
          )}

          {syncHistory.length > 1 && (
            <>
              <Separator className="my-4" />
              <h4 className="text-sm font-medium mb-2">Sync History</h4>
              <div className="space-y-2">
                {syncHistory.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    {statusIcon(s.status)}
                    <span className="text-muted-foreground">{formatDate(s.startedAt)}</span>
                    <span>{s.accountCount} accounts, {s.transactionCount} transactions</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Transaction categories used for classification</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {categories.map(cat => (
              <div key={cat.id} className="p-3 border rounded-lg">
                <p className="font-medium text-sm">{cat.name}</p>
                {cat.children.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {cat.children.map(child => (
                      <Badge key={child.id} variant="secondary" className="text-xs">{child.name}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category Rules</CardTitle>
          <CardDescription>Future recurring transaction category overrides</CardDescription>
        </CardHeader>
        <CardContent>
          {categoryRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category rules yet.</p>
          ) : (
            <div className="space-y-2">
              {categoryRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{rule.normalizedPayee}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.category.name} · {rule.account ? rule.account.name : 'All accounts'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleDeleteRule(rule.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
