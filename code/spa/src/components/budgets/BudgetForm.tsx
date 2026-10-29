import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { Budget, Category } from "@/types";

const budgetSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  amount: z.coerce.number().positive("Amount must be positive"),
  period: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
});

type BudgetFormValues = z.infer<typeof budgetSchema>;

interface BudgetFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  budget?: Budget | null;
}

export function BudgetForm({ open, onClose, onSubmit, budget }: Readonly<BudgetFormProps>) {
  const [categories, setCategories] = useState<Category[]>([]);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetSchema),
    defaultValues: budget ? {
      categoryId: budget.categoryId,
      amount: budget.amount,
      period: budget.period as any,
    } : {
      categoryId: '',
      amount: 0,
      period: 'MONTHLY',
    },
  });

  const period = watch('period');
  let submitLabel = 'Create';
  if (isSubmitting) {
    submitLabel = 'Saving...';
  } else if (budget) {
    submitLabel = 'Update';
  }

  useEffect(() => {
    if (open) {
      api.getCategories()
        .then(res => setCategories(res.data))
        .catch(console.error);
    }
  }, [open]);

  useEffect(() => {
    if (budget) {
      reset({
        categoryId: budget.categoryId,
        amount: budget.amount,
        period: budget.period as any,
      });
    } else {
      reset({ categoryId: '', amount: 0, period: 'MONTHLY' });
    }
  }, [budget, reset]);

  const handleFormSubmit = async (values: BudgetFormValues) => {
    await onSubmit({
      ...values,
      startDate: new Date().toISOString(),
    });
    reset();
    onClose();
  };

  // Flatten categories for dropdown (parent + children)
  const allCategories: { id: string; name: string; isChild: boolean }[] = [];
  categories.forEach(cat => {
    allCategories.push({ id: cat.id, name: cat.name, isChild: false });
    cat.children?.forEach(child => {
      allCategories.push({ id: child.id, name: child.name, isChild: true });
    });
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{budget ? 'Edit Budget' : 'Create Budget'}</DialogTitle>
          <DialogDescription>
            {budget ? 'Update this budget limit.' : 'Set a spending limit for a category.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={watch('categoryId')}
              onValueChange={(v) => setValue('categoryId', v, { shouldValidate: true })}
              disabled={!!budget}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {allCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.isChild ? `  └ ${cat.name}` : cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.categoryId && <p className="text-xs text-red-500">{errors.categoryId.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount ($)</Label>
            <Input id="amount" type="number" step="0.01" {...register("amount")} />
            {errors.amount && <p className="text-xs text-red-500">{errors.amount.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setValue('period', v as BudgetFormValues['period'], { shouldValidate: true })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                <SelectItem value="YEARLY">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
             <Button type="submit" disabled={isSubmitting}>
               {submitLabel}
             </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
