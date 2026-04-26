import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { Budget, FilterPeriod } from '../types';

export function useBudgets(period: FilterPeriod = 'all') {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBudgets = useCallback(() => {
    setLoading(true);
    api.getBudgets(period)
      .then(res => setBudgets(res.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const createBudget = async (data: { categoryId: string; amount: number; period: string; startDate: string; endDate?: string }) => {
    await api.createBudget(data);
    fetchBudgets();
  };

  const updateBudget = async (id: string, data: any) => {
    await api.updateBudget(id, data);
    fetchBudgets();
  };

  const deleteBudget = async (id: string) => {
    await api.deleteBudget(id);
    setBudgets(prev => prev.filter(b => b.id !== id));
  };

  return { budgets, loading, error, createBudget, updateBudget, deleteBudget, refetch: fetchBudgets };
}
