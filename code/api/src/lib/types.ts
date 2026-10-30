import { Decimal } from '@prisma/client/runtime/library';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DateRangeFilter {
  startDate?: Date;
  endDate?: Date;
}

export interface TransactionFilters extends DateRangeFilter {
  status?: 'POSTED' | 'PENDING';
  accountId?: string;
  categoryId?: string;
  search?: string;
}

export interface DashboardSummary {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyNet: number;
}

export interface TrendDataPoint {
  date: string;
  value: number;
}

export interface HoldingsSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  accounts: AccountWithStats[];
}

export interface AccountWithStats {
  id: string;
  name: string;
  institution: string | null;
  type: string;
  currency: string;
  balance: number;
  availableBalance: number | null;
  balanceDate: Date;
  transactionCount: number;
}

export function decimalToNumber(val: Decimal | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}
