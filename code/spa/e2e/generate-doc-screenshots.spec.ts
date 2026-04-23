import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), "..", "..", "docs", "screenshots");
const VIEWPORT = { width: 1440, height: 900 };

function ensureScreenshotDir(): void {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function openSidebarRoute(page: Page, label: string): Promise<void> {
  await page.locator(`a:has-text("${label}")`).first().click();
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
}

async function installSyntheticDashboardData(page: Page): Promise<void> {
  await page.route("**/api/dashboard/summary**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          netWorth: 284320,
          totalAssets: 452980,
          totalLiabilities: 168660,
          monthlyIncome: 12150,
          monthlyExpenses: 8460,
          monthlyNet: 3690,
        },
      }),
    });
  });

  await page.route("**/api/dashboard/trends**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { date: "2025-10-01", value: 241500 },
          { date: "2025-11-01", value: 248800 },
          { date: "2025-12-01", value: 256220 },
          { date: "2026-01-01", value: 263940 },
          { date: "2026-02-01", value: 274510 },
          { date: "2026-03-01", value: 284320 },
        ],
      }),
    });
  });

  await page.route("**/api/dashboard/spending-by-category**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { category: { id: "cat-housing", name: "Housing", icon: null, color: null }, total: 3120 },
          { category: { id: "cat-food", name: "Food", icon: null, color: null }, total: 1460 },
          { category: { id: "cat-transport", name: "Transport", icon: null, color: null }, total: 860 },
          { category: { id: "cat-utilities", name: "Utilities", icon: null, color: null }, total: 740 },
          { category: { id: "cat-health", name: "Health", icon: null, color: null }, total: 590 },
        ],
      }),
    });
  });
}

async function installSyntheticTransactionsData(page: Page): Promise<void> {
  await page.route("**/api/accounts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "acct-checking-4821",
            name: "Aurora Checking •••• 4821",
            institution: "Northstar Bank",
            type: "CHECKING",
            currency: "USD",
            balance: 12840.22,
            availableBalance: 12110.54,
            balanceDate: "2026-03-01",
            transactionCount: 184,
          },
          {
            id: "acct-credit-1904",
            name: "Summit Card •••• 1904",
            institution: "Pioneer Credit",
            type: "CREDIT_CARD",
            currency: "USD",
            balance: -2840.11,
            availableBalance: null,
            balanceDate: "2026-03-01",
            transactionCount: 126,
          },
        ],
      }),
    });
  });

  await page.route("**/api/transactions/filter-categories**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "cat-food", name: "Food & Dining", icon: null, color: null, count: 8 },
          { id: "cat-travel", name: "Travel", icon: null, color: null, count: 4 },
          { id: "cat-shopping", name: "Shopping", icon: null, color: null, count: 6 },
          { id: "cat-utilities", name: "Utilities", icon: null, color: null, count: 3 },
        ],
      }),
    });
  });

  await page.route("**/api/transactions**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "tx-001",
            posted: "2026-03-15",
            amount: -84.32,
            description: "Blue Harbor Grocery",
            payee: "Blue Harbor Market",
            memo: null,
            isReviewed: true,
            categoryRuleId: null,
            account: { id: "acct-checking-4821", name: "Aurora Checking •••• 4821", institution: "Northstar Bank" },
            category: { id: "cat-food", name: "Food & Dining", icon: null, color: null },
          },
          {
            id: "tx-002",
            posted: "2026-03-14",
            amount: -42.7,
            description: "Metro Fuel Station",
            payee: "Metro Fuel",
            memo: null,
            isReviewed: true,
            categoryRuleId: null,
            account: { id: "acct-checking-4821", name: "Aurora Checking •••• 4821", institution: "Northstar Bank" },
            category: { id: "cat-utilities", name: "Utilities", icon: null, color: null },
          },
          {
            id: "tx-003",
            posted: "2026-03-13",
            amount: 3250.0,
            description: "Payroll Deposit",
            payee: "Northwind Labs Payroll",
            memo: null,
            isReviewed: true,
            categoryRuleId: null,
            account: { id: "acct-checking-4821", name: "Aurora Checking •••• 4821", institution: "Northstar Bank" },
            category: { id: "cat-income", name: "Income", icon: null, color: null },
          },
          {
            id: "tx-004",
            posted: "2026-03-11",
            amount: -126.4,
            description: "Cloudline Airlines",
            payee: "Cloudline",
            memo: null,
            isReviewed: true,
            categoryRuleId: null,
            account: { id: "acct-credit-1904", name: "Summit Card •••• 1904", institution: "Pioneer Credit" },
            category: { id: "cat-travel", name: "Travel", icon: null, color: null },
          },
          {
            id: "tx-005",
            posted: "2026-03-09",
            amount: -67.95,
            description: "Evergreen Pharmacy",
            payee: "Evergreen Pharmacy",
            memo: null,
            isReviewed: true,
            categoryRuleId: null,
            account: { id: "acct-credit-1904", name: "Summit Card •••• 1904", institution: "Pioneer Credit" },
            category: { id: "cat-health", name: "Health", icon: null, color: null },
          },
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 5,
          totalPages: 1,
        },
      }),
    });
  });
}

async function installSyntheticReportsData(page: Page): Promise<void> {
  await page.route("**/api/reports**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "rpt-pfs-2026-03",
            title: "Personal Financial Statement",
            type: "PERSONAL_FINANCIAL_STATEMENT",
            period: "2026-03",
            generatedAt: "2026-03-31T15:00:00.000Z",
            content: {
              reportDate: "2026-03-31",
              periodCovered: "2026-03",
              netWorth: 284320,
              netWorthChange: { amount: 9810, percentage: 3.6, comparedTo: "2026-02" },
              totalAssets: 452980,
              totalLiabilities: 168660,
              assetAllocation: [
                { category: "Cash", value: 98420, percentage: 21.7 },
                { category: "Investments", value: 276880, percentage: 61.1 },
                { category: "Real Estate", value: 77680, percentage: 17.2 },
              ],
              assets: [
                { category: "Cash", value: 98420, percentOfTotal: 21.7 },
                { category: "Investments", value: 276880, percentOfTotal: 61.1 },
                { category: "Real Estate", value: 77680, percentOfTotal: 17.2 },
              ],
              liabilities: [
                { category: "Mortgage", value: 142300, percentOfTotal: 84.4 },
                { category: "Credit Card", value: 26360, percentOfTotal: 15.6 },
              ],
              trendAnalysis: "Steady growth across savings and investments.",
              taxSensitivityAnalysis: "Tax exposure remains moderate.",
              solvencyBenchmarking: {
                dtiRatio: 0.22,
                liquidityRatio: 5.4,
                savingsRate: 0.3,
                debtToAssetRatio: 0.37,
                analysis: "Solvency profile is strong.",
              },
              debtStrategy: {
                method: "Avalanche",
                analysis: "Highest-rate balances are prioritized.",
                priorityOrder: [{ name: "Rewards Card", balance: 26360, rate: 0.19 }],
              },
              assetRebalancing: {
                warnings: ["Equity concentration slightly elevated."],
                suggestions: ["Shift 5% to short-duration bonds."],
              },
              overallInsight: "Financial trajectory is positive with manageable liabilities.",
            },
          },
          {
            id: "rpt-exp-2026-03",
            title: "Spending Analysis",
            type: "SPENDING_ANALYSIS",
            period: "2026-03",
            generatedAt: "2026-03-31T15:10:00.000Z",
            content: {
              reportDate: "2026-03-31",
              periodCovered: "2026-03",
              dataQuality: "sufficient",
              totalExpenses: 8460,
              transactionCount: 114,
              essentialVsDiscretionary: {
                essential: 6120,
                discretionary: 2340,
                essentialRatio: 72.3,
                discretionaryRatio: 27.7,
              },
              topRecurringMerchants: [],
              subscriptionCandidates: [],
              insuranceOptimization: { monthlyAverage: 420, premiumTrendPercent: 1.8, providerCount: 2 },
              negotiationCandidates: [],
              savingsOpportunities: [
                {
                  title: "Streaming bundle consolidation",
                  description: "Merge overlapping plans.",
                  estimatedMonthlySavings: 28,
                  estimatedAnnualSavings: 336,
                  confidence: "high",
                },
              ],
              overview: "Discretionary spending is trending down.",
              subscriptionStrategy: { analysis: "Subscriptions are controlled.", actions: ["Cancel unused trial"] },
              insuranceStrategy: { analysis: "Premium growth is modest.", actions: ["Request annual quote review"] },
              negotiationStrategy: { analysis: "Few high-variance vendors.", actions: ["Negotiate mobile plan"] },
              prioritizedActionPlan: [
                { priority: 1, title: "Review subscriptions", why: "Immediate savings", expectedMonthlySavings: 28 },
              ],
              overallInsight: "Budget adherence is strong.",
            },
          },
        ],
        pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
      }),
    });
  });
}

async function sanitizeFinancialDisplay(page: Page): Promise<void> {
  await page.evaluate(() => {
    let seed = 20260417;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const randomCurrency = (symbol: string): string => {
      const dollars = Math.floor(next() * 90000) + 100;
      const cents = Math.floor(next() * 100);
      return `${symbol}${dollars.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
    };

    const randomPercent = (): string => `${(next() * 95 + 2).toFixed(1)}%`;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.parentElement) continue;
      const parentTag = node.parentElement.tagName.toLowerCase();
      if (parentTag === "script" || parentTag === "style") continue;
      if (!node.textContent?.trim()) continue;
      textNodes.push(node);
    }

    for (const node of textNodes) {
      const original = node.textContent ?? "";
      let updated = original;
      updated = updated.replace(/([$€£])\s?\d[\d,]*(?:\.\d{1,2})?/g, (_, symbol: string) => randomCurrency(symbol));
      updated = updated.replace(/\b\d+(?:\.\d+)?%/g, () => randomPercent());
      updated = updated.replace(/\b(?:\d[ -]?){8,}\d\b/g, "•••• •••• ••••");
      updated = updated.replace(/\b\d{6,}\b/g, "••••••••");
      if (updated !== original) node.textContent = updated;
    }
  });
}

async function sanitizeAndCapture(page: Page, filename: string): Promise<void> {
  await sanitizeFinancialDisplay(page);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, filename),
    fullPage: false,
  });
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: VIEWPORT });

test("capture README screenshots with obfuscated financial values", async ({ page }) => {
  ensureScreenshotDir();
  await installSyntheticDashboardData(page);
  await installSyntheticTransactionsData(page);
  await installSyntheticReportsData(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "dashboard.png"),
    fullPage: false,
  });

  await openSidebarRoute(page, "Holdings");
  await sanitizeAndCapture(page, "holdings.png");

  await openSidebarRoute(page, "Transactions");
  await sanitizeAndCapture(page, "transactions.png");

  await openSidebarRoute(page, "Budgets");
  await sanitizeAndCapture(page, "budgets.png");

  await openSidebarRoute(page, "Goals");
  await sanitizeAndCapture(page, "goals.png");

  await openSidebarRoute(page, "Reports");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "reports.png"),
    fullPage: false,
  });

  await openSidebarRoute(page, "Settings");
  await sanitizeAndCapture(page, "settings.png");
});
