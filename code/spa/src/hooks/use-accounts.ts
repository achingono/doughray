import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Account, CreateLiabilityAccountInput } from '../types';

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAccounts()
      .then(res => setAccounts(res.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const createAccount = async (data: CreateLiabilityAccountInput) => {
    return api.createAccount(data);
  };

  return { accounts, loading, error, createAccount };
}
