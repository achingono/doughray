import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import type { Category, RecategorizeScope, Transaction } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatCurrency, formatCalendarDate } from '@/lib/formatters';

interface RecategorizeDialogProps {
  open: boolean;
  transaction: Transaction | null;
  categories: Category[];
  onClose: () => void;
  onApplied: (result: { scope: RecategorizeScope; appliedPastCount: number; futureRuleCreated: boolean }) => Promise<void> | void;
  onCategoriesChanged: () => Promise<void> | void;
}

const SCOPE_OPTIONS: Array<{ value: RecategorizeScope; label: string }> = [
  { value: 'single-instance', label: 'This transaction only' },
  { value: 'all-past', label: 'All past matching transactions' },
  { value: 'all-future', label: 'All future matching transactions' },
  { value: 'all-past-and-future', label: 'All past and future matching transactions' },
];

export function RecategorizeDialog({ open, transaction, categories, onClose, onApplied, onCategoriesChanged }: Readonly<RecategorizeDialogProps>) {
  const [categoryId, setCategoryId] = useState<string>('');
  const [scope, setScope] = useState<RecategorizeScope>('single-instance');
  const [matchingPastCount, setMatchingPastCount] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParentId, setNewCategoryParentId] = useState<string>('none');
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryParentId, setEditCategoryParentId] = useState<string>('none');
  const [isManaging, setIsManaging] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  const leafCategories = useMemo(() => {
    const flattened: Array<{ id: string; name: string; label: string; parentId: string | null }> = [];
    const walk = (node: Category, parentName?: string) => {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        flattened.push({
          id: node.id,
          name: node.name,
          label: parentName ? `${parentName} / ${node.name}` : node.name,
          parentId: node.parentId,
        });
        return;
      }
      children.forEach((child) => walk(child, node.name));
    };
    categories.forEach((category) => walk(category));
    return flattened.sort((a, b) => a.label.localeCompare(b.label));
  }, [categories]);

  const parentCategoryOptions = useMemo(() => (
    categories
      .filter((category) => category.id !== categoryId)
      .map((category) => ({ id: category.id, name: category.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [categories, categoryId]);

  useEffect(() => {
    if (!open || !transaction) return;
    setCategoryId(transaction.category?.id ?? '');
    setScope('single-instance');
    setMatchingPastCount(0);
    setError(null);
  }, [open, transaction]);

  useEffect(() => {
    const selected = leafCategories.find((category) => category.id === categoryId);
    setEditCategoryName(selected?.name ?? '');
    setEditCategoryParentId(selected?.parentId ?? 'none');
  }, [leafCategories, categoryId]);

  useEffect(() => {
    if (!manageOpen) {
      setManageError(null);
      setNewCategoryName('');
      setNewCategoryParentId('none');
    }
  }, [manageOpen]);

  useEffect(() => {
    if (!open || !transaction || (scope !== 'all-past' && scope !== 'all-past-and-future')) {
      if (scope === 'single-instance' || scope === 'all-future') setMatchingPastCount(0);
      return;
    }

    setLoadingPreview(true);
    api.getRecategorizePreview(transaction.id, scope)
      .then((response) => {
        setMatchingPastCount(response.data.eligiblePastCount);
      })
      .catch((previewError: any) => {
        setError(previewError.message || 'Failed to preview matching transactions.');
      })
      .finally(() => {
        setLoadingPreview(false);
      });
  }, [open, transaction, scope]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!transaction) return;
    if (!categoryId) {
      setError('Select a category.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await api.recategorizeTransaction(transaction.id, categoryId, scope);
      await onApplied({
        scope,
        appliedPastCount: response.data.appliedPastCount,
        futureRuleCreated: Boolean(response.data.futureRule),
      });
      onClose();
    } catch (submitError: any) {
      setError(submitError.message || 'Failed to recategorize transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) {
      setManageError('Enter a category name.');
      return;
    }
    setManageError(null);
    setIsManaging(true);
    try {
      const response = await api.createCategory({
        name,
        parentId: newCategoryParentId === 'none' ? undefined : newCategoryParentId,
      });
      setCategoryId(response.data.id);
      setNewCategoryName('');
      await onCategoriesChanged();
    } catch (manageCreateError: any) {
      setManageError(manageCreateError.message || 'Failed to create category.');
    } finally {
      setIsManaging(false);
    }
  };

  const handleRenameCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryId) {
      setManageError('Select a category first.');
      return;
    }
    const name = editCategoryName.trim();
    if (!name) {
      setManageError('Enter a category name.');
      return;
    }
    setManageError(null);
    setIsManaging(true);
    try {
      await api.updateCategory(categoryId, {
        name,
        parentId: editCategoryParentId === 'none' ? null : editCategoryParentId,
      });
      await onCategoriesChanged();
    } catch (manageUpdateError: any) {
      setManageError(manageUpdateError.message || 'Failed to update category.');
    } finally {
      setIsManaging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Recategorize Transaction</DialogTitle>
          <DialogDescription>
            {transaction
              ? `${transaction.description} • ${formatCurrency(transaction.amount, transaction.account.currency)} • ${formatCalendarDate(transaction.posted)}`
              : 'Update category for this transaction and matching recurring instances.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="recategorize-category">New Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="recategorize-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {leafCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setManageError(null); setManageOpen(true); }}>
                Add / Edit Categories
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Apply To</Label>
            <RadioGroup value={scope} onValueChange={(value) => setScope(value as RecategorizeScope)}>
              {SCOPE_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`scope-${option.value}`} value={option.value} />
                  <Label htmlFor={`scope-${option.value}`} className="font-normal">
                    {option.label}
                    {(option.value === 'all-past' || option.value === 'all-past-and-future') && (
                      <span className="text-muted-foreground"> ({loadingPreview ? 'Checking…' : `${matchingPastCount} found`})</span>
                    )}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {(scope === 'all-future' || scope === 'all-past-and-future') && (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Future matching transactions will be auto-categorized and skipped by AI categorization.
            </p>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Applying…' : 'Apply'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>Create a new category or rename the selected category.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <form onSubmit={handleCreateCategory} className="space-y-2">
              <Label htmlFor="new-category-name">New Category Name</Label>
              <div className="flex gap-2">
                <Input id="new-category-name" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="e.g. Streaming" />
                <Button type="submit" disabled={isManaging}>Add</Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-category-parent">Parent Category</Label>
                <Select value={newCategoryParentId} onValueChange={setNewCategoryParentId}>
                  <SelectTrigger id="new-category-parent">
                    <SelectValue placeholder="No parent (top-level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No parent (top-level)</SelectItem>
                    {parentCategoryOptions.map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </form>
            <form onSubmit={handleRenameCategory} className="space-y-2">
              <Label htmlFor="edit-category-name">Rename Selected Category</Label>
              <div className="flex gap-2">
                <Input id="edit-category-name" value={editCategoryName} onChange={(event) => setEditCategoryName(event.target.value)} placeholder="Select a category first" />
                <Button type="submit" variant="outline" disabled={isManaging || !categoryId}>Save</Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category-parent">Move Under Parent</Label>
                <Select value={editCategoryParentId} onValueChange={setEditCategoryParentId} disabled={!categoryId}>
                  <SelectTrigger id="edit-category-parent">
                    <SelectValue placeholder="No parent (top-level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No parent (top-level)</SelectItem>
                    {parentCategoryOptions.map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </form>
            {manageError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {manageError}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
