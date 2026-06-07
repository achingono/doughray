import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { DashboardSummary, TrendDataPoint, SpendingByCategory, Budget, Goal, FilterPeriod } from '../types';

function periodToStartDate(period: FilterPeriod): string | undefined {
  if (period === 'all') return undefined;
  const months = Number.parseInt(period, 10);
  if (months <= 0 || Number.isNaN(months)) return undefined;
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split('T')[0];
}

export function useDashboard(accountId?: string, period: FilterPeriod = 'all') {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<TrendDataPoint[]>([]);
  const [spending, setSpending] = useState<SpendingByCategory[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const startDate = periodToStartDate(period);
    Promise.all([
      api.getDashboardSummary(accountId),
      api.getDashboardTrends(period, accountId),
      api.getSpendingByCategory(startDate, undefined, accountId),
      api.getBudgets(period),
      api.getGoals('ACTIVE'),
    ])
      .then(([summaryRes, trendsRes, spendingRes, budgetsRes, goalsRes]) => {
        setSummary(summaryRes.data);
        setTrends(trendsRes.data);
        setSpending(spendingRes.data);
        setBudgets(budgetsRes.data);
        setGoals(goalsRes.data);

      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [accountId, period]);

  return { summary, trends, spending, budgets, goals, loading, error };
}
