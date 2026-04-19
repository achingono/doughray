export interface ExpenseTransactionCategory {
  name: string;
  parent?: { name: string } | null;
}

export interface ExpenseTransactionLike {
  amount: number;
  category?: ExpenseTransactionCategory | null;
}

const NON_EXPENSE_CATEGORY_NAMES = new Set(['Transfers']);
const NON_EXPENSE_PARENT_CATEGORY_NAMES = new Set(['Income']);

export function isExpenseTransaction(transaction: ExpenseTransactionLike): boolean {
  if (transaction.amount >= 0) return false;

  const categoryName = transaction.category?.name;
  if (categoryName && NON_EXPENSE_CATEGORY_NAMES.has(categoryName)) {
    return false;
  }

  const parentCategoryName = transaction.category?.parent?.name;
  if (parentCategoryName && NON_EXPENSE_PARENT_CATEGORY_NAMES.has(parentCategoryName)) {
    return false;
  }

  return true;
}
