export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCompactCurrency(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  return formatCurrency(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

/** Bank posting dates are stored at UTC midnight as calendar dates. */
export function formatCalendarDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(date));
}

export function formatShortDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatChange(current: number, previous: number): { value: string; isPositive: boolean; percent: string } {
  const change = current - previous;
  const percent = previous === 0 ? 0 : (change / Math.abs(previous)) * 100;
  return {
    value: formatCurrency(Math.abs(change)),
    isPositive: change >= 0,
    percent: `${change >= 0 ? '+' : '-'}${Math.abs(percent).toFixed(1)}%`,
  };
}

export function getAccountTypeIcon(type: string): string {
  switch (type) {
    case 'CHECKING': return 'Wallet';
    case 'SAVINGS': return 'PiggyBank';
    case 'CREDIT_CARD': return 'CreditCard';
    case 'INVESTMENT': return 'TrendingUp';
    case 'LOAN': return 'HandCoins';
    case 'MORTGAGE': return 'Home';
    default: return 'Landmark';
  }
}

export function getCategoryColor(color = 'gray'): string {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    pink: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  };
  return colorMap[color] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300';
}
