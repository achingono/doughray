import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { Transaction, PaginatedResponse } from '../types';

export interface TransactionFilters {
  status?: 'POSTED' | 'PENDING';
  accountId?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function useTransactions(initialFilters: TransactionFilters = {}) {
  const [filters, setFilters] = useState<TransactionFilters>(initialFilters);
  const [result, setResult] = useState<PaginatedResponse<Transaction> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (f: TransactionFilters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTransactions(f);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(filters);
  }, [filters, fetchTransactions]);

  const updateFilters = useCallback((updates: Partial<TransactionFilters>) => {
    setFilters(prev => ({ ...prev, ...updates, page: updates.page ?? 1 }));
  }, []);

  const setPage = useCallback((page: number) => {
    setFilters(prev => ({ ...prev, page }));
  }, []);

  return {
    transactions: result?.data ?? [],
    pagination: result?.pagination ?? { page: 1, limit: 50, total: 0, totalPages: 0 },
    loading,
    error,
    filters,
    updateFilters,
    setPage,
    refresh: () => fetchTransactions(filters),
  };
}
