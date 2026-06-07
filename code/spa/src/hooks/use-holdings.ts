import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { HoldingsSummary, TrendDataPoint, FilterPeriod } from '../types';

export function useHoldings(period: FilterPeriod = 'all') {
  const [holdings, setHoldings] = useState<HoldingsSummary | null>(null);
  const [history, setHistory] = useState<TrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [holdingsRes, historyRes] = await Promise.all([
      api.getHoldings(),
      api.getHoldingsHistory(period),
      ]);
      setHoldings(holdingsRes.data);
      setHistory(historyRes.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { holdings, history, loading, error, refresh };
}
