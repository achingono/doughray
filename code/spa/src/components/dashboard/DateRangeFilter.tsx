import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account, FilterPeriod } from "@/types";

interface DateRangeFilterProps {
  accounts: Account[];
  selectedAccountId: string;
  onAccountChange: (accountId: string) => void;
  period: FilterPeriod;
  onPeriodChange: (period: FilterPeriod) => void;
}

export function DateRangeFilter({
  accounts,
  selectedAccountId,
  onAccountChange,
  period,
  onPeriodChange,
}: Readonly<DateRangeFilterProps>) {
  return (
    <div className="flex items-center gap-3">
      <Select value={selectedAccountId} onValueChange={onAccountChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All Accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={period} onValueChange={onPeriodChange}>
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
  );
}
