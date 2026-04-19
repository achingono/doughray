import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { Goal } from "@/types";

interface GoalProgressProps {
  goals: Goal[];
  className?: string;
}

export function GoalProgress({ goals, className }: Readonly<GoalProgressProps>) {
  const activeGoals = goals.filter(g => g.status === 'ACTIVE');

  if (activeGoals.length === 0) {
    return (
      <Card className={cn("flex h-full flex-col", className)}>
        <CardHeader>
          <CardTitle>Goal Progress</CardTitle>
          <CardDescription>Track your savings goals</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground text-center py-8">
            No active goals. Create one to track progress.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader>
        <CardTitle>Goal Progress</CardTitle>
        <CardDescription>Active savings goals</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {activeGoals.slice(0, 5).map((goal) => {
            const isComplete = goal.percentComplete >= 100;
            return (
              <div key={goal.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{goal.name}</span>
                  <span className={`text-xs ${isComplete ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}`}>
                    {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                  </span>
                </div>
                <Progress
                  value={Math.min(goal.percentComplete, 100)}
                  className={`h-2 ${isComplete ? '[&>div]:bg-emerald-500' : ''}`}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatPercent(goal.percentComplete)}</span>
                  <span>{isComplete ? 'Complete!' : `${formatCurrency(goal.targetAmount - goal.currentAmount)} remaining`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
