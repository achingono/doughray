import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Star, TrendingUp, Lightbulb, Loader2, FileBarChart, Scissors, Shield, HandCoins, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { PFSExecutiveSummary } from "@/components/reports/PFSExecutiveSummary";
import { PFSFinancialCondition } from "@/components/reports/PFSFinancialCondition";
import { PFSNarrative } from "@/components/reports/PFSNarrative";
import { PFSExportButton } from "@/components/reports/PFSExportButton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Report, PFSContent, ReportContent, SpendingAnalysisContent } from "@/types";

const LOADING_CARD_KEYS = ['report-loading-1', 'report-loading-2', 'report-loading-3', 'report-loading-4'] as const;

function isPFSContent(content: ReportContent | PFSContent | SpendingAnalysisContent): content is PFSContent {
  return 'netWorth' in content && 'assetAllocation' in content && 'solvencyBenchmarking' in content;
}

function isSpendingAnalysisContent(content: ReportContent | PFSContent | SpendingAnalysisContent): content is SpendingAnalysisContent {
  return 'totalExpenses' in content && 'subscriptionCandidates' in content && 'savingsOpportunities' in content;
}

interface ReportDetailViewProps {
  report: Report;
  onBack: () => void;
  onDelete: (reportId: string) => Promise<void>;
  deleting: boolean;
}

function PFSExportDocument({ report, content }: Readonly<{ report: Report; content: PFSContent }>) {
  return (
    <div className="space-y-6 bg-white p-8 text-black">
      <div>
        <h2 className="text-2xl font-bold">{report.title}</h2>
        <p className="text-sm text-slate-600">Generated {formatDate(report.generatedAt)} · Period {content.periodCovered}</p>
      </div>
      <PFSExecutiveSummary content={content} />
      <PFSFinancialCondition content={content} />
      <PFSNarrative content={content} />
    </div>
  );
}

function PFSDetailView({ report, onBack, onDelete, deleting }: Readonly<ReportDetailViewProps>) {
  const content = report.content as PFSContent;
  const exportRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{report.title}</h2>
        <div className="flex items-center gap-2">
          <PFSExportButton targetRef={exportRef} fileName={`pfs-${content.periodCovered}`} />
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={() => {
              onDelete(report.id).catch(console.error);
            }}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>← Back to Reports</Button>
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Executive Summary</TabsTrigger>
          <TabsTrigger value="details">Financial Condition</TabsTrigger>
          <TabsTrigger value="narrative">CPA Narrative</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4">
          <PFSExecutiveSummary content={content} />
        </TabsContent>
        <TabsContent value="details" className="mt-4">
          <PFSFinancialCondition content={content} />
        </TabsContent>
        <TabsContent value="narrative" className="mt-4">
          <PFSNarrative content={content} />
        </TabsContent>
      </Tabs>

      <div className="pointer-events-none fixed left-[-10000px] top-0 w-[1100px] opacity-100" aria-hidden>
        <div ref={exportRef}>
          <PFSExportDocument report={report} content={content} />
        </div>
      </div>
    </div>
  );
}

function MonthlyReportDetailView({ report, onBack, onDelete, deleting }: Readonly<ReportDetailViewProps>) {
  const c = report.content as ReportContent;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{c.title}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={() => {
              onDelete(report.id).catch(console.error);
            }}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>← Back to Reports</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><Star className="h-5 w-5 text-amber-500" /> Highlights</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">{c.highlights.map((h) => <li key={h} className="flex items-start gap-2 text-sm"><span className="text-primary mt-1">•</span>{h}</li>)}</ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Financial Grade</CardTitle></CardHeader>
          <CardContent className="text-center">
            <div className="text-5xl font-bold text-primary">{c.overallScore}</div>
            <p className="text-sm text-muted-foreground mt-2">{c.scoreExplanation}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-base"><TrendingUp className="h-4 w-4 inline mr-2" />Income</CardTitle></CardHeader><CardContent><p className="text-sm">{c.incomeAnalysis}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Expenses</CardTitle></CardHeader><CardContent><p className="text-sm">{c.expenseAnalysis}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Savings</CardTitle></CardHeader><CardContent><p className="text-sm">{c.savingsAnalysis}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-500" /> Recommendations</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2">{c.recommendations.map((r, i) => <li key={r} className="flex items-start gap-2 text-sm"><Badge variant="outline" className="mt-0.5 shrink-0">{i + 1}</Badge>{r}</li>)}</ul>
        </CardContent>
      </Card>
    </div>
  );
}

function SpendingAnalysisDetailView({ report, onBack, onDelete, deleting }: Readonly<ReportDetailViewProps>) {
  const c = report.content as SpendingAnalysisContent;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{report.title}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={() => {
              onDelete(report.id).catch(console.error);
            }}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>← Back to Reports</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Total Expenses</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatCurrency(c.totalExpenses)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Transactions</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{c.transactionCount}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Data Quality</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold capitalize">{c.dataQuality}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
        <CardContent><p className="text-sm">{c.overview}</p></CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Scissors className="h-4 w-4" /> Subscription Strategy</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{c.subscriptionStrategy.analysis}</p>
            <ul className="space-y-1">{c.subscriptionStrategy.actions.map((item) => <li key={item} className="text-sm text-muted-foreground">• {item}</li>)}</ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Insurance Strategy</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{c.insuranceStrategy.analysis}</p>
            <ul className="space-y-1">{c.insuranceStrategy.actions.map((item) => <li key={item} className="text-sm text-muted-foreground">• {item}</li>)}</ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><HandCoins className="h-4 w-4" /> Negotiation Strategy</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{c.negotiationStrategy.analysis}</p>
            <ul className="space-y-1">{c.negotiationStrategy.actions.map((item) => <li key={item} className="text-sm text-muted-foreground">• {item}</li>)}</ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Prioritized Action Plan</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {c.prioritizedActionPlan.map((item) => (
              <li key={`${item.priority}-${item.title}`} className="rounded border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{item.priority}. {item.title}</p>
                  <Badge variant="outline">{formatCurrency(item.expectedMonthlySavings)}/mo</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{item.why}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Savings Opportunities</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {c.savingsOpportunities.map((item) => (
              <li key={item.title} className="text-sm">
                <span className="font-medium">{item.title}:</span> {formatCurrency(item.estimatedMonthlySavings)}/mo ({formatCurrency(item.estimatedAnnualSavings)}/yr)
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingExpense, setGeneratingExpense] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);

  const mergeReportIntoList = (nextReport: Report) => {
    setReports((prev) => {
      const filtered = prev.filter(
        (report) => !(report.id === nextReport.id || (report.type === nextReport.type && report.period === nextReport.period)),
      );
      return [nextReport, ...filtered];
    });
  };

  useEffect(() => {
    api.getReports()
      .then(res => setReports(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleGeneratePFS = async () => {
    setGenerating(true);
    try {
      const res = await api.generatePFS({ overwriteExisting });
      mergeReportIntoList(res.data);
      setSelectedReport(res.data);
      toast.success(overwriteExisting ? "Financial statement overwritten" : "Financial statement generated");
    } catch (err) {
      console.error("Failed to generate PFS:", err);
      toast.error(err instanceof Error ? err.message : "Failed to generate financial statement");
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateExpenseAnalysis = async () => {
    setGeneratingExpense(true);
    try {
      const res = await api.generateExpenseAnalysis({ overwriteExisting });
      mergeReportIntoList(res.data);
      setSelectedReport(res.data);
      toast.success(overwriteExisting ? "Expense analysis overwritten" : "Expense analysis generated");
    } catch (err) {
      console.error("Failed to generate expense analysis:", err);
      toast.error(err instanceof Error ? err.message : "Failed to generate expense analysis");
    } finally {
      setGeneratingExpense(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    const confirmed = globalThis.confirm("Delete this report permanently?");
    if (!confirmed) return;

    setDeletingReportId(reportId);
    try {
      await api.deleteReport(reportId);
      setReports((prev) => prev.filter((report) => report.id !== reportId));
      if (selectedReport?.id === reportId) {
        setSelectedReport(null);
      }
      toast.success("Report deleted");
    } catch (err) {
      console.error("Failed to delete report:", err);
      toast.error(err instanceof Error ? err.message : "Failed to delete report");
    } finally {
      setDeletingReportId(null);
    }
  };

  if (loading) {
    return (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">Reports</h2>
        <div className="grid gap-4 md:grid-cols-2">{LOADING_CARD_KEYS.map((key) => <Skeleton key={key} className="h-[200px] rounded-xl" />)}</div>
        </div>
    );
  }

  if (selectedReport) {
    const isPFS = selectedReport.type === 'PERSONAL_FINANCIAL_STATEMENT' && isPFSContent(selectedReport.content);
    const isExpenseAnalysis = selectedReport.type === 'SPENDING_ANALYSIS' && isSpendingAnalysisContent(selectedReport.content);
    if (isPFS) {
      return (
        <PFSDetailView
          report={selectedReport}
          onBack={() => setSelectedReport(null)}
          onDelete={handleDeleteReport}
          deleting={deletingReportId === selectedReport.id}
        />
      );
    }
    if (isExpenseAnalysis) {
      return (
        <SpendingAnalysisDetailView
          report={selectedReport}
          onBack={() => setSelectedReport(null)}
          onDelete={handleDeleteReport}
          deleting={deletingReportId === selectedReport.id}
        />
      );
    }
    return (
      <MonthlyReportDetailView
        report={selectedReport}
        onBack={() => setSelectedReport(null)}
        onDelete={handleDeleteReport}
        deleting={deletingReportId === selectedReport.id}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Reports</h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex w-full items-center gap-2 rounded-md border px-3 py-2 sm:w-auto sm:py-1.5">
            <Switch id="overwrite-existing" checked={overwriteExisting} onCheckedChange={(checked) => setOverwriteExisting(checked === true)} />
            <Label htmlFor="overwrite-existing" className="text-xs leading-tight text-muted-foreground">
              Overwrite current period
            </Label>
          </div>
          <Button className="w-full sm:w-auto" onClick={handleGenerateExpenseAnalysis} disabled={generatingExpense}>
            {generatingExpense ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
            ) : (
              <><TrendingUp className="h-4 w-4 mr-2" />Generate Expense Analysis</>
            )}
          </Button>
          <Button className="w-full sm:w-auto" onClick={handleGeneratePFS} disabled={generating}>
            {generating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
            ) : (
              <><FileBarChart className="h-4 w-4 mr-2" />Generate Financial Statement</>
            )}
          </Button>
        </div>
      </div>
      {reports.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><p className="text-muted-foreground">No reports generated yet. Click "Generate Financial Statement" to create your first Personal Financial Statement, or reports will be automatically created monthly.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map(report => {
            const isPFS = report.type === 'PERSONAL_FINANCIAL_STATEMENT' && isPFSContent(report.content);
            const isExpenseAnalysis = report.type === 'SPENDING_ANALYSIS' && isSpendingAnalysisContent(report.content);
            if (isPFS) {
              const pfsContent = report.content as PFSContent;
              return (
                <Card key={report.id} className="cursor-pointer hover:shadow-md transition-shadow border-primary/20" onClick={() => setSelectedReport(report)}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{report.title}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant="default">PFS</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={deletingReportId === report.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteReport(report.id).catch(console.error);
                          }}
                        >
                          {deletingReportId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <CardDescription>{formatDate(report.generatedAt)} · {report.period}{report.isStale ? ' · Data changed since this report was generated' : ''}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">Net Worth</p>
                        <p className="text-sm font-semibold">${pfsContent.netWorth.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Assets</p>
                        <p className="text-sm font-semibold text-emerald-600">${pfsContent.totalAssets.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Liabilities</p>
                        <p className="text-sm font-semibold text-red-600">${pfsContent.totalLiabilities.toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            if (isExpenseAnalysis) {
              const expenseContent = report.content as SpendingAnalysisContent;
              const monthlySavings = expenseContent.savingsOpportunities
                .reduce((sum, item) => sum + item.estimatedMonthlySavings, 0);
              return (
                <Card key={report.id} className="cursor-pointer hover:shadow-md transition-shadow border-amber-500/30" onClick={() => setSelectedReport(report)}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{report.title}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Expense</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={deletingReportId === report.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteReport(report.id).catch(console.error);
                          }}
                        >
                          {deletingReportId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <CardDescription>{formatDate(report.generatedAt)} · {report.period}{report.isStale ? ' · Data changed since this report was generated' : ''}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">Expenses</p>
                        <p className="text-sm font-semibold">{formatCurrency(expenseContent.totalExpenses)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Candidates</p>
                        <p className="text-sm font-semibold">{expenseContent.savingsOpportunities.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Est. Savings</p>
                        <p className="text-sm font-semibold text-emerald-600">{formatCurrency(monthlySavings)}/mo</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            const monthlyContent = report.content as ReportContent;
            return (
              <Card key={report.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedReport(report)}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{monthlyContent.title || report.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge>{monthlyContent.overallScore}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={deletingReportId === report.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteReport(report.id).catch(console.error);
                        }}
                      >
                        {deletingReportId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{formatDate(report.generatedAt)} · {report.period}{report.isStale ? ' · Data changed since this report was generated' : ''}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">{monthlyContent.highlights.slice(0, 3).map((h) => <li key={h} className="text-sm text-muted-foreground">• {h}</li>)}</ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
