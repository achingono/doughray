import { useState } from "react";
import { useBudgets } from "@/hooks/use-budgets";
import { BudgetCard } from "@/components/budgets/BudgetCard";
import { BudgetForm } from "@/components/budgets/BudgetForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/formatters";
import { PiggyBank, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Budget, FilterPeriod } from "@/types";

const SUMMARY_SKELETON_KEYS = ['budget-summary-1', 'budget-summary-2', 'budget-summary-3'] as const;
const CARD_SKELETON_KEYS = ['budget-card-1', 'budget-card-2', 'budget-card-3', 'budget-card-4'] as const;

export function BudgetsPage() {
  const [period, setPeriod] = useState<FilterPeriod>("all");
  const { budgets, loading, error, createBudget, updateBudget, deleteBudget } = useBudgets(period);
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  if (error) {
    return <div className="flex items-center justify-center h-[50vh]"><p className="text-muted-foreground">Failed to load: {error}</p></div>;
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Budgets</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {SUMMARY_SKELETON_KEYS.map((key) => <Skeleton key={key} className="h-[120px] rounded-xl" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CARD_SKELETON_KEYS.map((key) => <Skeleton key={key} className="h-[140px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRemaining = totalBudgeted - totalSpent;

  const handleCreate = async (data: any) => {
    try {
      await createBudget(data);
      toast.success('Budget created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create budget');
    }
  };

  const handleUpdate = async (data: any) => {
    if (!editingBudget) return;
    try {
      await updateBudget(editingBudget.id, data);
      toast.success('Budget updated');
      setEditingBudget(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update budget');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBudget(id);
      toast.success('Budget deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete budget');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Budgets</h2>
        <div className="flex items-center gap-4">
          <Select value={period} onValueChange={value => setPeriod(value as FilterPeriod)}>
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
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Budget
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Budgeted</CardTitle>
            <PiggyBank className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalBudgeted)}</div>
            <p className="text-xs text-muted-foreground mt-1">{budgets.length} budget{budgets.length === 1 ? '' : 's'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Spent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totalSpent)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalRemaining >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(totalRemaining)}
            </div>
          </CardContent>
        </Card>
      </div>

      {budgets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <PiggyBank className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No budgets yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create your first budget to track spending limits.</p>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Budget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {budgets.map(budget => (
            <BudgetCard
              key={budget.id}
              budget={budget}
              onEdit={(b) => setEditingBudget(b)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <BudgetForm
        open={formOpen || editingBudget !== null}
        onClose={() => { setFormOpen(false); setEditingBudget(null); }}
        onSubmit={editingBudget ? handleUpdate : handleCreate}
        budget={editingBudget}
      />
    </div>
  );
}
