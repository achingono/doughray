import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CategoryBadge } from "./CategoryBadge";
import { formatCurrency, formatCalendarDate } from "@/lib/formatters";
import type { Transaction } from "@/types";

interface TransactionTableProps {
  transactions: Transaction[];
  pagination: { page: number; totalPages: number; total: number };
  onPageChange: (page: number) => void;
  onCategoryClick?: (transactionId: string) => void;
}

export function TransactionTable({ transactions, pagination, onPageChange, onCategoryClick }: Readonly<TransactionTableProps>) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No transactions found. Try adjusting your filters.
      </div>
    );
  }

  return (
    <div>
      <Table className="min-w-[680px]">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map(t => (
            <TableRow key={t.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatCalendarDate(t.posted)}</TableCell>
              <TableCell>
                <div>
                  <p className="font-medium">{t.description}{t.status === 'PENDING' && <span className="ml-2 text-xs text-muted-foreground">Pending</span>}</p>
                  {t.payee && <p className="text-xs text-muted-foreground">{t.payee}</p>}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{t.account.name}</TableCell>
              <TableCell>
                <CategoryBadge category={t.category} onClick={() => onCategoryClick?.(t.id)} />
              </TableCell>
              <TableCell className={`text-right font-medium whitespace-nowrap ${t.amount >= 0 ? 'text-emerald-600' : ''}`}>
                {t.amount >= 0 ? '+' : ''}{formatCurrency(t.amount, t.account.currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between mt-4 px-2">
        <p className="text-sm text-muted-foreground">
          {pagination.total} transaction{pagination.total === 1 ? '' : 's'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
