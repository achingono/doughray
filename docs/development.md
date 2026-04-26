# Doughray Development Guide

A comprehensive guide for developing the Doughray personal finance dashboard locally.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial Setup](#2-initial-setup)
3. [Running Locally](#3-running-locally)
4. [Project Structure](#4-project-structure)
5. [Code Architecture](#5-code-architecture)
6. [Database](#6-database)
7. [Key Conventions](#7-key-conventions)
8. [Common Development Tasks](#8-common-development-tasks)
9. [Testing](#9-testing)
10. [Troubleshooting Development Issues](#10-troubleshooting-development-issues)

---

## 1. Prerequisites

| Tool       | Version | Notes                                           |
| ---------- | ------- | ----------------------------------------------- |
| Node.js    | 20+     | LTS recommended — check with `node -v`          |
| npm        | 10+     | Ships with Node 20 — check with `npm -v`        |
| PostgreSQL | 16      | Local install or via Docker (see below)          |
| Git        | latest  | Any recent version                               |

### Quick PostgreSQL via Docker

If you don't have PostgreSQL installed locally, spin one up with Docker:

```bash
cd code
docker compose up -d postgres
```

This starts PostgreSQL 16 on port **5432** with the defaults from `.env.example` (`finance`/`finance`/`changeme_in_production`).

---

## 2. Initial Setup

```bash
# Clone the repo and navigate to the code directory
cd code

# Install all workspaces (api, spa, worker) in one command
npm install

# Create your local environment file
cp .env.example .env
```

Edit `.env` and update `DATABASE_URL` to point to your local PostgreSQL instance:

```env
# For local PostgreSQL:
DATABASE_URL=postgresql://finance:changeme_in_production@localhost:5432/finance

# For Docker Compose PostgreSQL:
DATABASE_URL=postgresql://finance:changeme_in_production@localhost:5432/finance
```

Then generate the Prisma client and run migrations:

```bash
# Generate the Prisma client (required before any code runs)
npx prisma generate --schema=prisma/schema.prisma

# Run database migrations
npx prisma migrate dev --schema=prisma/schema.prisma

```

> **Note:** Default categories are now seeded automatically by the API at startup when no categories exist.
>
> **Tip:** You can still run the seed script manually if you want to reset category defaults:
>
> ```bash
> npm run db:generate
> npm run db:migrate
> npm run db:seed
> ```

---

## 3. Running Locally

You need three terminals for the full development experience:

```bash
# Terminal 1 — API (Express + Prisma)
npm run dev:api
# → starts on http://localhost:3000
# → hot-reloads via ts-node-dev

# Terminal 2 — SPA (React + Vite)
npm run dev:spa
# → starts on http://localhost:5173
# → Vite proxies /api/* requests to localhost:3000

# Terminal 3 — Worker (optional, cron jobs)
npm run dev:worker
# → starts the cron scheduler
# → runs initial import after 10-second delay
# → requires SIMPLEFIN_ACCESS_URL and AZURE_OPENAI_* env vars
```

Open **http://localhost:5173** in your browser. The Vite dev server proxies all `/api/*` requests to the Express API so you don't need CORS workarounds during development.

### Environment Variables Reference

| Variable                     | Required | Description                                |
| ---------------------------- | -------- | ------------------------------------------ |
| `DATABASE_URL`               | Yes      | PostgreSQL connection string               |
| `API_PORT`                   | No       | API server port (default: `3000`)          |
| `NODE_ENV`                   | No       | `development` or `production`              |
| `SIMPLEFIN_ACCESS_URL`       | Worker   | SimpleFin Bridge access URL                |
| `AZURE_OPENAI_ENDPOINT`      | Worker   | Azure OpenAI endpoint URL                  |
| `AZURE_OPENAI_API_KEY`       | Worker   | Azure OpenAI API key                       |
| `AZURE_OPENAI_DEPLOYMENT`    | Worker   | Azure deployment name (no default; required for AI jobs) |
| `AZURE_OPENAI_API_VERSION`   | Worker   | API version (default: `2024-06-01`)        |

---

## 4. Project Structure

```
code/
├── package.json              # Root workspace config (npm workspaces)
├── docker-compose.yml        # Docker Compose for postgres, api, spa, worker
├── .env.example              # Template environment variables
│
├── prisma/
│   ├── schema.prisma         # Database schema (6 models, 4 enums)
│   └── seed.ts               # Database seed script
│
├── api/                      # Express REST API workspace
│   ├── package.json          # API dependencies (express, cors, zod, @prisma/client)
│   ├── tsconfig.json         # TypeScript config (CommonJS, ES2022, strict)
│   ├── Dockerfile
│   └── src/
│       ├── index.ts          # Express app entry — mounts routes + middleware
│       ├── lib/
│       │   ├── prisma.ts     # Singleton PrismaClient (dev logging)
│       │   └── types.ts      # Shared types + decimalToNumber() helper
│       ├── middleware/
│       │   ├── error-handler.ts  # AppError class + global error handler
│       │   └── validation.ts     # Zod validation middleware
│       ├── routes/
│       │   ├── accounts.ts       # GET /api/accounts, GET /api/accounts/:id
│       │   ├── transactions.ts   # GET /api/transactions, PATCH /api/transactions/:id
│       │   ├── dashboard.ts      # GET /api/dashboard/summary, trends, spending
│       │   ├── holdings.ts       # GET /api/holdings, /api/holdings/history
│       │   ├── budgets.ts        # CRUD /api/budgets
│       │   ├── categories.ts     # GET/POST /api/categories
│       │   ├── reports.ts        # GET /api/reports, GET /api/reports/:id
│       │   └── sync.ts           # GET/POST /api/sync
│       └── services/
│           ├── account.service.ts
│           ├── transaction.service.ts
│           ├── dashboard.service.ts
│           ├── holding.service.ts
│           ├── budget.service.ts
│           ├── category.service.ts
│           ├── report.service.ts
│           └── sync.service.ts
│
├── spa/                      # React SPA workspace (Vite + Tailwind)
│   ├── package.json          # SPA dependencies (react, recharts, radix, shadcn)
│   ├── tsconfig.json         # TypeScript config (ESNext modules, strict, @/ alias)
│   ├── vite.config.ts        # Vite config with /api proxy to localhost:3000
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── index.html
│   ├── nginx.conf            # Production nginx config
│   ├── Dockerfile
│   └── src/
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Router: /, /holdings, /transactions, /reports, /settings
│       ├── index.css         # Tailwind base + shadcn CSS variables
│       ├── lib/
│       │   ├── api.ts        # API client (fetch wrapper with typed methods)
│       │   ├── formatters.ts # Currency, date, percentage formatters
│       │   └── utils.ts      # cn() helper for Tailwind class merging
│       ├── types/
│       │   └── index.ts      # TypeScript interfaces for all API responses
│       ├── hooks/
│       │   ├── use-dashboard.ts    # Fetches dashboard data (summary, trends, spending, budgets)
│       │   ├── use-accounts.ts     # Fetches account list
│       │   ├── use-holdings.ts     # Fetches holdings data
│       │   ├── use-transactions.ts # Fetches paginated transactions
│       │   ├── use-toast.ts        # Toast notification hook
│       │   └── use-mobile.ts       # Mobile viewport detection
│       ├── pages/
│       │   ├── DashboardPage.tsx   # Main dashboard with cards, charts, budgets
│       │   ├── HoldingsPage.tsx    # Account holdings overview + history chart
│       │   ├── TransactionsPage.tsx# Filterable transaction table
│       │   ├── ReportsPage.tsx     # AI-generated financial reports
│       │   └── SettingsPage.tsx    # Settings / sync management
│       └── components/
│           ├── layout/
│           │   ├── AppLayout.tsx    # SidebarProvider + Outlet wrapper
│           │   ├── AppSidebar.tsx   # Navigation sidebar (Dashboard, Holdings, etc.)
│           │   └── AppHeader.tsx    # Top header with breadcrumbs + trigger
│           ├── dashboard/
│           │   ├── NetWorthCard.tsx       # Net worth + income/expense summary cards
│           │   ├── TrendLineChart.tsx     # Area chart (Recharts) for net worth trend
│           │   ├── SpendingByCategory.tsx # Spending breakdown by category
│           │   ├── RecentTransactions.tsx # Latest transactions list
│           │   ├── BudgetProgress.tsx     # Budget progress bars
│           │   └── DateRangeFilter.tsx    # Account + period filter controls
│           ├── holdings/
│           │   ├── AccountSummaryCard.tsx # Account balance card
│           │   ├── AccountDetail.tsx      # Account detail with recent txns
│           │   └── HoldingsChart.tsx      # Holdings history chart
│           ├── transactions/
│           │   ├── TransactionTable.tsx   # Data table for transactions
│           │   ├── TransactionFilters.tsx # Search + filter controls
│           │   └── CategoryBadge.tsx      # Color-coded category badge
│           └── ui/                        # 48 shadcn/ui components (see list below)
│
└── worker/                   # Background worker workspace (cron jobs)
    ├── package.json          # Worker deps (node-cron, @prisma/client, openai)
    ├── tsconfig.json         # TypeScript config (CommonJS, strict)
    ├── Dockerfile
    └── src/
        ├── index.ts          # Cron scheduler entry — registers all jobs
        ├── jobs/
        │   ├── import-transactions.ts     # Imports from SimpleFin (every 6h)
        │   ├── categorize-transactions.ts # AI categorization via Azure OpenAI (after import and backfill windows)
        │   └── generate-reports.ts        # Monthly report + daily net worth snapshot
        ├── lib/
        │   ├── prisma.ts     # PrismaClient singleton
        │   ├── openai.ts     # Azure OpenAI client
        │   └── simplefin.ts  # SimpleFin API client
        └── prompts/
            ├── categorize.ts # Prompt template for transaction categorization
            └── report.ts     # Prompt template for monthly report generation
```

---

## 5. Code Architecture

### API Layer

The API follows a **Routes → Services → Prisma** pattern:

```
Request → Route handler → Service function → Prisma query → Response
```

#### Adding a New Route

**Step 1:** Create a service in `api/src/services/`

```typescript
// api/src/services/goal.service.ts
import { prisma } from '../lib/prisma';
import { decimalToNumber } from '../lib/types';

export async function getAllGoals() {
  const goals = await prisma.goal.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return goals.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: decimalToNumber(g.targetAmount),
    currentAmount: decimalToNumber(g.currentAmount),
  }));
}
```

**Step 2:** Create a route in `api/src/routes/`

```typescript
// api/src/routes/goals.ts
import { Router } from 'express';
import { getAllGoals } from '../services/goal.service';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const goals = await getAllGoals();
    res.json({ data: goals });
  } catch (err) {
    next(err);
  }
});

export default router;
```

**Step 3:** Register in `api/src/index.ts`

```typescript
import goalRoutes from './routes/goals';
// ...
app.use('/api/goals', goalRoutes);
```

#### Error Handling

Throw `AppError` to return structured error responses:

```typescript
import { AppError } from '../middleware/error-handler';

// In a route or service:
throw new AppError(404, 'Goal not found', 'NOT_FOUND');
throw new AppError(400, 'Invalid amount', 'VALIDATION_ERROR');
throw new AppError(409, 'Goal already exists', 'CONFLICT');
```

Error responses follow this shape:

```json
{
  "error": {
    "message": "Goal not found",
    "code": "NOT_FOUND"
  }
}
```

Unhandled errors return a generic 500 with code `INTERNAL_ERROR`.

#### Validation

Use the `validate()` middleware with Zod schemas:

```typescript
import { z } from 'zod';
import { validate } from '../middleware/validation';

const querySchema = z.object({
  page: z.string().default('1').transform(Number),
  limit: z.string().default('50').transform(Number),
  search: z.string().optional(),
});

const bodySchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
});

// Validate query parameters
router.get('/', validate(querySchema, 'query'), async (req, res, next) => { ... });

// Validate request body
router.post('/', validate(bodySchema, 'body'), async (req, res, next) => { ... });

// Validate URL params
router.get('/:id', validate(paramsSchema, 'params'), async (req, res, next) => { ... });
```

Validation errors return a 400 response with Zod error details:

```json
{
  "error": {
    "message": "Validation error",
    "code": "VALIDATION_ERROR",
    "details": [
      { "path": ["name"], "message": "Required" }
    ]
  }
}
```

#### API Routes Summary

| Method  | Path                              | Description                    |
| ------- | --------------------------------- | ------------------------------ |
| GET     | `/api/health`                     | Health check                   |
| GET     | `/api/accounts`                   | List all active accounts       |
| GET     | `/api/accounts/:id`               | Get account details + recent txns |
| GET     | `/api/transactions`               | List transactions (paginated, filterable) |
| PATCH   | `/api/transactions/:id`           | Update transaction category    |
| GET     | `/api/dashboard/summary`          | Dashboard financial summary    |
| GET     | `/api/dashboard/trends`           | Net worth trend data           |
| GET     | `/api/dashboard/spending-by-category` | Spending breakdown         |
| GET     | `/api/holdings`                   | Holdings summary with accounts |
| GET     | `/api/holdings/history`           | Historical net worth snapshots |
| GET/POST | `/api/budgets`                  | List / create budgets          |
| PUT     | `/api/budgets/:id`                | Update a budget                |
| DELETE  | `/api/budgets/:id`                | Delete a budget                |
| GET/POST | `/api/categories`               | List / create categories       |
| GET     | `/api/reports`                    | List reports (paginated)       |
| GET     | `/api/reports/:id`                | Get a single report            |
| GET     | `/api/sync/status`                | Latest sync status             |
| GET     | `/api/sync/history`               | Sync history                   |
| POST    | `/api/sync/trigger`               | Trigger a manual sync          |

---

### SPA Layer

The SPA follows a **Pages → Components → Hooks → API client** pattern:

```
Page → Component → Hook → api.ts → fetch('/api/...') → Vite proxy → Express
```

#### Path Aliases

The `@/` alias maps to `spa/src/` (configured in both `tsconfig.json` and `vite.config.ts`):

```typescript
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Account } from "@/types";
```

#### Available shadcn/ui Components

All 48 components are installed in `spa/src/components/ui/`:

| Component | Component | Component | Component |
| --- | --- | --- | --- |
| accordion | alert | alert-dialog | aspect-ratio |
| avatar | badge | breadcrumb | button |
| calendar | card | carousel | chart |
| checkbox | collapsible | command | context-menu |
| dialog | drawer | dropdown-menu | form |
| hover-card | input | input-otp | label |
| menubar | navigation-menu | pagination | popover |
| progress | radio-group | resizable | scroll-area |
| select | separator | sheet | sidebar |
| skeleton | slider | sonner | switch |
| table | tabs | textarea | toast |
| toaster | toggle | toggle-group | tooltip |

#### Adding a New Page

**Step 1:** Create the page component in `spa/src/pages/`

```tsx
// spa/src/pages/GoalsPage.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GoalsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Goals</h2>
      <Card>
        <CardHeader>
          <CardTitle>Savings Goals</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Your financial goals will appear here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2:** Add the route in `spa/src/App.tsx`

```tsx
import { GoalsPage } from "./pages/GoalsPage";

// Inside <Routes>:
<Route element={<AppLayout />}>
  <Route path="/" element={<DashboardPage />} />
  <Route path="/holdings" element={<HoldingsPage />} />
  <Route path="/transactions" element={<TransactionsPage />} />
  <Route path="/reports" element={<ReportsPage />} />
  <Route path="/goals" element={<GoalsPage />} />       {/* ← add */}
  <Route path="/settings" element={<SettingsPage />} />
</Route>
```

**Step 3:** Add a nav item in `spa/src/components/layout/AppSidebar.tsx`

```tsx
import { Target } from "lucide-react"; // pick an icon

const navItems = [
  { title: "Dashboard", icon: LayoutDashboard, path: "/" },
  { title: "Holdings", icon: Landmark, path: "/holdings" },
  { title: "Transactions", icon: ArrowRightLeft, path: "/transactions" },
  { title: "Reports", icon: FileText, path: "/reports" },
  { title: "Goals", icon: Target, path: "/goals" },       // ← add
  { title: "Settings", icon: Settings, path: "/settings" },
];
```

#### Adding a New Chart

Use `ChartContainer` from `@/components/ui/chart` with Recharts:

```tsx
// spa/src/components/dashboard/MyNewChart.tsx
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface MyChartProps {
  data: { label: string; value: number }[];
}

const chartConfig = {
  value: {
    label: "Amount",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function MyNewChart({ data }: MyChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Spending</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <BarChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v}`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="value" fill="var(--color-value)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
```

Key points:

- Always wrap Recharts in `<ChartContainer config={...}>` for consistent theming
- Use `hsl(var(--chart-1))` through `hsl(var(--chart-5))` for chart colors
- Use `var(--color-<key>)` in fill/stroke to reference config colors
- Available Recharts components: `AreaChart`, `BarChart`, `LineChart`, `PieChart`, `RadarChart`

#### Styling

- **Tailwind CSS** utility classes for all layout and styling
- **shadcn CSS variables** for theming (`--background`, `--foreground`, `--primary`, `--chart-1`, etc.)
- **`cn()` helper** from `@/lib/utils` for conditional class merging:

```tsx
import { cn } from "@/lib/utils";

<div className={cn("rounded-lg p-4", isActive && "bg-primary text-primary-foreground")} />
```

---

### Worker Layer

The worker uses **node-cron** to schedule background jobs. Each job is an async function in `worker/src/jobs/`.

#### Current Cron Schedule

| Job                    | Schedule          | Cron Expression    |
| ---------------------- | ----------------- | ------------------ |
| Import transactions    | Every 6 hours     | `0 */6 * * *`      |
| Categorize transactions| 15 min after import | `15 */6 * * *`   |
| Backfill transactions  | Every 6 hours at :30 | `30 */6 * * *`  |
| Categorize backfilled transactions | 15 min after backfill | `45 */6 * * *` |
| Monthly report         | 1st of month, 6 AM | `0 6 1 * *`      |
| Net worth snapshot     | Daily at midnight | `0 0 * * *`        |

On startup, the worker also runs an initial import → categorize → snapshot cycle after a 10-second delay.

#### Adding a New Cron Job

**Step 1:** Create the job function in `worker/src/jobs/`

```typescript
// worker/src/jobs/cleanup-old-logs.ts
import prisma from '../lib/prisma';

export async function cleanupOldLogs(): Promise<number> {
  console.log('[Cleanup] Removing old sync logs...');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const { count } = await prisma.syncLog.deleteMany({
    where: { startedAt: { lt: cutoff } },
  });

  console.log(`[Cleanup] Removed ${count} old sync logs`);
  return count;
}
```

**Step 2:** Register in `worker/src/index.ts` with `cron.schedule()`

```typescript
import { cleanupOldLogs } from './jobs/cleanup-old-logs';

// Run cleanup weekly on Sunday at 3 AM
cron.schedule('0 3 * * 0', async () => {
  console.log('[Worker] Running: Cleanup Old Logs');
  try {
    await cleanupOldLogs();
  } catch (err) {
    console.error('[Worker] Cleanup job failed:', err);
  }
});
```

#### Cron Expression Quick Reference

```
┌────────────── minute (0-59)
│ ┌──────────── hour (0-23)
│ │ ┌────────── day of month (1-31)
│ │ │ ┌──────── month (1-12)
│ │ │ │ ┌────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

| Expression      | Description              |
| --------------- | ------------------------ |
| `*/15 * * * *`  | Every 15 minutes         |
| `0 */6 * * *`   | Every 6 hours            |
| `0 0 * * *`     | Daily at midnight        |
| `0 6 1 * *`     | 1st of each month at 6AM |
| `0 3 * * 0`     | Sundays at 3 AM          |

---

## 6. Database

### Schema Overview

The Prisma schema (`prisma/schema.prisma`) defines 6 models and 4 enums:

| Model              | Description                                        |
| ------------------ | -------------------------------------------------- |
| `Account`          | Bank/investment accounts (checking, savings, etc.) |
| `Transaction`      | Financial transactions linked to accounts          |
| `Category`         | Hierarchical transaction categories (parent/child) |
| `Budget`           | Budget targets per category and period             |
| `Report`           | AI-generated financial reports (JSON content)      |
| `SyncLog`          | Import sync history and status                     |
| `NetWorthSnapshot` | Daily net worth snapshots for trend tracking       |

| Enum           | Values                                                          |
| -------------- | --------------------------------------------------------------- |
| `AccountType`  | `CHECKING`, `SAVINGS`, `CREDIT_CARD`, `INVESTMENT`, `LOAN`, `MORTGAGE`, `OTHER` |
| `BudgetPeriod` | `WEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY`                      |
| `ReportType`   | `MONTHLY_SUMMARY`, `SPENDING_ANALYSIS`, `NET_WORTH_TREND`, `BUDGET_REVIEW` |
| `SyncStatus`   | `RUNNING`, `SUCCESS`, `FAILED`                                  |

### Schema Changes

```bash
# 1. Edit prisma/schema.prisma with your changes

# 2. Create and apply a migration
npx prisma migrate dev --schema=prisma/schema.prisma --name describe_change

# 3. Regenerate the Prisma client
npx prisma generate --schema=prisma/schema.prisma
```

Example — adding a `Goal` model:

```prisma
model Goal {
  id            String   @id @default(cuid())
  name          String
  targetAmount  Decimal  @db.Decimal(15, 2)
  currentAmount Decimal  @db.Decimal(15, 2) @default(0)
  deadline      DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

```bash
npx prisma migrate dev --schema=prisma/schema.prisma --name add_goal_model
npx prisma generate --schema=prisma/schema.prisma
```

### Useful Prisma Commands

```bash
# Open a GUI database browser at http://localhost:5555
npx prisma studio --schema=prisma/schema.prisma

# Introspect an existing database → update schema.prisma
npx prisma db pull --schema=prisma/schema.prisma

# Auto-format the schema file
npx prisma format --schema=prisma/schema.prisma

# Reset the database (drops all data, re-runs migrations + seed)
npx prisma migrate reset --schema=prisma/schema.prisma

# Check migration status
npx prisma migrate status --schema=prisma/schema.prisma

# Deploy migrations (production — no interactive prompts)
npx prisma migrate deploy --schema=prisma/schema.prisma
```

---

## 7. Key Conventions

### TypeScript

- **Strict mode** is enabled in all three workspaces
- API: `target: ES2022`
- SPA: `target: ES2020` with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`

### Module Systems

| Workspace | Module System | Import Style             | Root Dir     |
| --------- | ------------- | ------------------------ | ------------ |
| API       | CommonJS      | `import` (via esModuleInterop) | `api/src/`  |
| SPA       | ESM           | `import`                 | `spa/src/` (alias: `@/`) |
| Worker    | CommonJS      | `import` (via esModuleInterop) | `worker/src/` |

### Decimal Handling

All `Decimal` values from Prisma are converted to `number` at the **service layer** using `decimalToNumber()`:

```typescript
import { decimalToNumber } from '../lib/types';

// In a service function:
return {
  balance: decimalToNumber(account.balance),           // Decimal → number
  availableBalance: account.availableBalance
    ? decimalToNumber(account.availableBalance)
    : null,                                            // nullable Decimal → number | null
};
```

This ensures the API always returns plain JSON numbers, never Prisma `Decimal` objects.

### Date Handling

- **API responses:** ISO 8601 strings (e.g., `"2024-03-15T00:00:00.000Z"`)
- **Internal code:** `Date` objects
- **SPA formatting:** Use helpers from `@/lib/formatters.ts` (`formatDate()`, `formatShortDate()`)

### Error Response Shape

All API errors follow a consistent structure:

```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "MACHINE_READABLE_CODE",
    "details": []
  }
}
```

### Success Response Shape

```json
// Single resource
{ "data": { ... } }

// Collection (paginated)
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 142,
    "totalPages": 3
  }
}
```

---

## 8. Common Development Tasks

### Adding a New API Endpoint

Complete walkthrough for adding a `GET /api/goals` endpoint:

```bash
# 1. Add the model to prisma/schema.prisma (if needed)
# 2. Run migration
npx prisma migrate dev --schema=prisma/schema.prisma --name add_goals
npx prisma generate --schema=prisma/schema.prisma
```

```typescript
// 3. Create api/src/services/goal.service.ts
import { prisma } from '../lib/prisma';
import { decimalToNumber } from '../lib/types';

export async function getAllGoals() {
  const goals = await prisma.goal.findMany({
    orderBy: { deadline: 'asc' },
  });
  return goals.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: decimalToNumber(g.targetAmount),
    currentAmount: decimalToNumber(g.currentAmount),
    deadline: g.deadline,
  }));
}

export async function createGoal(data: {
  name: string;
  targetAmount: number;
  deadline?: Date;
}) {
  return prisma.goal.create({ data });
}
```

```typescript
// 4. Create api/src/routes/goals.ts
import { Router } from 'express';
import { z } from 'zod';
import { getAllGoals, createGoal } from '../services/goal.service';
import { validate } from '../middleware/validation';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  targetAmount: z.number().positive(),
  deadline: z.string().datetime().optional(),
});

router.get('/', async (_req, res, next) => {
  try {
    const goals = await getAllGoals();
    res.json({ data: goals });
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(createSchema, 'body'), async (req, res, next) => {
  try {
    const goal = await createGoal({
      ...req.body,
      deadline: req.body.deadline ? new Date(req.body.deadline) : undefined,
    });
    res.status(201).json({ data: goal });
  } catch (err) {
    next(err);
  }
});

export default router;
```

```typescript
// 5. Register in api/src/index.ts
import goalRoutes from './routes/goals';
app.use('/api/goals', goalRoutes);
```

Test it:

```bash
# Health check
curl http://localhost:3000/api/health

# List goals
curl http://localhost:3000/api/goals

# Create a goal
curl -X POST http://localhost:3000/api/goals \
  -H "Content-Type: application/json" \
  -d '{"name": "Emergency Fund", "targetAmount": 10000}'
```

---

### Adding a New SPA Page

Complete walkthrough for adding a Goals page:

```typescript
// 1. Add types in spa/src/types/index.ts
export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string | null;
}
```

```typescript
// 2. Add API methods in spa/src/lib/api.ts
export const api = {
  // ... existing methods ...
  getGoals: () => request<{ data: Goal[] }>('/goals'),
  createGoal: (data: { name: string; targetAmount: number; deadline?: string }) =>
    request('/goals', { method: 'POST', body: JSON.stringify(data) }),
};
```

```typescript
// 3. Create a hook in spa/src/hooks/use-goals.ts
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { Goal } from '@/types';

export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getGoals()
      .then((res) => setGoals(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { goals, loading, error };
}
```

```tsx
// 4. Create spa/src/pages/GoalsPage.tsx
import { useGoals } from "@/hooks/use-goals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";

export function GoalsPage() {
  const { goals, loading, error } = useGoals();

  if (error) {
    return <p className="text-muted-foreground">Failed to load goals: {error}</p>;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Goals</h2>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[120px]" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Goals</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {goals.map((goal) => {
          const percent = (goal.currentAmount / goal.targetAmount) * 100;
          return (
            <Card key={goal.id}>
              <CardHeader>
                <CardTitle className="text-base">{goal.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress value={percent} />
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
```

```tsx
// 5. Add route in spa/src/App.tsx
import { GoalsPage } from "./pages/GoalsPage";
// Inside <Routes>:
<Route path="/goals" element={<GoalsPage />} />
```

```tsx
// 6. Add nav item in spa/src/components/layout/AppSidebar.tsx
import { Target } from "lucide-react";
// Add to navItems array:
{ title: "Goals", icon: Target, path: "/goals" },
```

---

### Adding a New Dashboard Widget

Create a card/chart component following the existing patterns:

```tsx
// spa/src/components/dashboard/SavingsRateCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatPercent } from "@/lib/formatters";

interface SavingsRateCardProps {
  income: number;
  expenses: number;
}

export function SavingsRateCard({ income, expenses }: SavingsRateCardProps) {
  const rate = income > 0 ? ((income - expenses) / income) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Savings Rate
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatPercent(rate)}</div>
        <Progress value={Math.max(0, rate)} className="mt-2" />
        <p className="mt-1 text-xs text-muted-foreground">
          {rate >= 20 ? "On track!" : "Consider reducing expenses"}
        </p>
      </CardContent>
    </Card>
  );
}
```

Then use it in a page:

```tsx
<SavingsRateCard income={summary.monthlyIncome} expenses={summary.monthlyExpenses} />
```

---

### Modifying the Database Schema

**Step-by-step Prisma migration workflow:**

```bash
# 1. Edit prisma/schema.prisma
#    Add/modify/remove models, fields, enums, indexes

# 2. Create a migration (interactive — prompts for destructive changes)
npx prisma migrate dev --schema=prisma/schema.prisma --name add_goal_deadline

# 3. Regenerate the Prisma client
npx prisma generate --schema=prisma/schema.prisma

# 4. Update services, routes, and SPA types to use the new fields

# 5. If you need to start over:
npx prisma migrate reset --schema=prisma/schema.prisma
# ⚠️  This drops the entire database and re-seeds!
```

Common schema patterns:

```prisma
// Required field
name String

// Optional field
memo String?

// Decimal with precision
amount Decimal @db.Decimal(15, 2)

// Auto-generated ID
id String @id @default(cuid())

// Timestamps
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

// Unique constraint
externalId String @unique

// Index for query performance
@@index([accountId, posted])

// Relation with cascade delete
account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

// Self-referencing relation (tree)
parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
children Category[] @relation("CategoryTree")
```

---

### Adding a New Cron Job

Complete walkthrough for adding a weekly email digest:

```typescript
// 1. Create worker/src/jobs/weekly-digest.ts
import prisma from '../lib/prisma';

export async function generateWeeklyDigest(): Promise<void> {
  console.log('[Digest] Generating weekly digest...');

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const transactions = await prisma.transaction.findMany({
    where: { posted: { gte: oneWeekAgo } },
    include: { account: true, category: true },
  });

  const totalSpent = transactions
    .filter((t) => Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  console.log(`[Digest] Weekly spending: $${totalSpent.toFixed(2)} across ${transactions.length} transactions`);
  // Add notification/email logic here
}
```

```typescript
// 2. Register in worker/src/index.ts
import { generateWeeklyDigest } from './jobs/weekly-digest';

// Run weekly digest every Monday at 8 AM
cron.schedule('0 8 * * 1', async () => {
  console.log('[Worker] Running: Weekly Digest');
  try {
    await generateWeeklyDigest();
  } catch (err) {
    console.error('[Worker] Digest job failed:', err);
  }
});
```

---

### Manual Liability Account Creation

The manual liability account creation feature allows users to record loans, mortgages, and credit cards without requiring transaction imports or institutional sync.

#### Feature Overview

- **Supported Types:** CREDIT_CARD, LOAN, MORTGAGE
- **Optional Loan Details:** Comprehensive metadata for loans (interest rate, payment amounts, term dates, amortization info)
- **API Endpoint:** `POST /api/accounts`
- **UI Component:** `LiabilityForm` modal in Holdings page

#### Implementation Details

**Backend (API):**

1. **Database Schema** (`prisma/schema.prisma`):
   - Account model supports `CREDIT_CARD`, `LOAN`, `MORTGAGE` types
   - AccountLoanDetails table stores optional loan metadata (1:1 with Account)
   - Migration creates AccountLoanDetails table with CASCADE delete

2. **Service Layer** (`api/src/services/account.service.ts`):
   - `createAccount()` function validates liability type and creates account + optional loan details in a transaction
   - `isLiabilityType()` helper ensures only supported types can be created manually
   - Throws `AppError(400, 'VALIDATION_ERROR')` for non-liability types

3. **Route Handler** (`api/src/routes/accounts.ts`):
   - `POST /api/accounts` endpoint with Zod validation
   - Validates loan details (term date ordering, amortization months logic)
   - Returns 201 + account detail on success
   - Returns 400 + validation errors on failure

**Frontend (SPA):**

1. **Types** (`spa/src/types/index.ts`):
   - `CreateLiabilityAccountInput` interface with optional `loanDetails` object
   - All date fields accept ISO strings (converted from form date inputs)

2. **Component** (`spa/src/components/holdings/LiabilityForm.tsx`):
   - Dialog modal using React Hook Form + Zod
   - Base fields: name, type, institution, balance, currency
   - Expandable loan details section with optional checkbox
   - Loan details fields: type, principal, interest rate, payments, term dates, amortization, notes

3. **Hook** (`spa/src/hooks/use-accounts.ts`):
   - `createAccount()` method calls `api.createAccount()`
   - Integration with HoldingsPage for refresh and toast notifications

4. **Page Integration** (`spa/src/pages/HoldingsPage.tsx`):
   - "Create Account" button in liabilities section header
   - Opens LiabilityForm modal on click
   - Refreshes holdings and shows toast on successful creation

#### Example Usage

**Creating a Credit Card (No Details):**

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Visa",
    "type": "CREDIT_CARD",
    "institution": "Chase",
    "balance": -2500
  }'
```

**Creating a Mortgage (With Details):**

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Primary Mortgage",
    "type": "MORTGAGE",
    "institution": "TD Bank",
    "balance": -500000,
    "loanDetails": {
      "loanType": "MORTGAGE",
      "originalPrincipal": 559000,
      "currentPrincipal": 538830,
      "interestRateAnnual": 5.05,
      "paymentAmount": 1631.86,
      "paymentFrequency": "SEMI_MONTHLY",
      "termStartDate": "2024-08-01T00:00:00.000Z",
      "termMaturityDate": "2027-08-01T00:00:00.000Z",
      "originalAmortizationMonths": 300,
      "remainingAmortizationMonths": 279
    }
  }'
```

#### Testing

**Unit Tests:**
- Account service tests: `api/src/services/account.service.test.ts` (createAccount transaction, validation)
- Asset service tests: `api/src/services/asset.service.test.ts` (accountId linking, non-liability rejection)

**Integration Tests:**
- Route tests: `api/src/routes/routes.integration.test.ts` (POST /api/accounts success, validation errors)

**Run Tests:**
```bash
npm run test:api -- account.service.test.ts
npm run test:api -- asset.service.test.ts
npm run test:api -- routes.integration.test.ts
```

#### Asset Linking

Assets can optionally link to liability accounts (e.g., house property → mortgage, vehicle → auto loan):

- **Schema:** Asset model has nullable `accountId` FK to Account with `onDelete: SetNull`
- **Validation:** `updateAsset()` validates accountId references a liability account
- **UI:** AssetForm can optionally select a linked account when creating/editing assets

#### Migration Notes

**Backward Compatibility:**
- All changes are additive (new columns, new endpoints, optional fields)
- Existing accounts unaffected (accountId remains null)
- SimpleFin sync does not overwrite user-entered loan metadata
- No existing data loss or schema breaking changes

**Deployment:**
1. Apply migration: `npx prisma migrate deploy`
2. Regenerate Prisma client: `npx prisma generate`
3. Deploy API with new POST /api/accounts endpoint
4. Deploy SPA with LiabilityForm component and updated HoldingsPage

---

## 9. Testing

### API Testing

The API uses **Vitest**:

```bash
cd code
npm run test:api
```

### SPA Testing

The SPA uses **Vitest** + **React Testing Library**:

```bash
cd code
npm run test:spa
```

### Worker Testing

The worker also uses **Vitest**:

```bash
cd code
npm run test:worker
```

### End-to-End Testing (Playwright)

Run the full Playwright suite:

```bash
cd code
npm run test:e2e
```

Run a single Playwright spec:

```bash
cd code/spa
npm run test:e2e -- e2e/mobile-ui.spec.ts
```

### Generating Documentation Screenshots

Screenshots for `README.md` are generated with Playwright and include in-browser obfuscation of financial amounts before capture:

```bash
cd code/spa
PLAYWRIGHT_BASE_URL=http://localhost:5173 npm run test:e2e -- e2e/generate-doc-screenshots.spec.ts
```

### Manual Testing

**Prisma Studio** — visual database browser:

```bash
npx prisma studio --schema=prisma/schema.prisma
# Opens at http://localhost:5555
```

**curl examples** for quick API testing:

```bash
# Health check
curl -s http://localhost:3000/api/health | jq

# Get dashboard summary
curl -s http://localhost:3000/api/dashboard/summary | jq

# List transactions with filters
curl -s "http://localhost:3000/api/transactions?page=1&limit=10&search=grocery" | jq

# Get accounts
curl -s http://localhost:3000/api/accounts | jq

# Get budgets
curl -s http://localhost:3000/api/budgets | jq

# Trigger a sync
curl -s -X POST http://localhost:3000/api/sync/trigger | jq

# Create a category
curl -s -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -d '{"name": "Subscriptions", "icon": "CreditCard", "color": "violet"}' | jq
```

---

## 10. Troubleshooting Development Issues

### Port Conflicts

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Fix:** Kill the process using the port, or change it:

```bash
# Find what's using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>

# Or change the port in .env
API_PORT=3001
```

For the SPA (port 5173), Vite will automatically try the next available port.

---

### Prisma Client Not Found

```
Error: @prisma/client did not initialize yet. Please run "prisma generate"
```

**Fix:** Generate the Prisma client:

```bash
npx prisma generate --schema=prisma/schema.prisma
```

This needs to be re-run after:
- First `npm install`
- Any change to `prisma/schema.prisma`
- Clearing `node_modules`

---

### Module Not Found Errors

```
Cannot find module '@/components/ui/button'
```

**Fix:** Check that both `tsconfig.json` and `vite.config.ts` have the `@/` path alias configured:

```json
// tsconfig.json
"paths": { "@/*": ["./src/*"] }
```

```typescript
// vite.config.ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
},
```

---

### CORS Errors in Browser

```
Access to fetch at 'http://localhost:3000/api/...' has been blocked by CORS policy
```

**Fix:** The API already has `cors()` middleware enabled globally:

```typescript
// api/src/index.ts
app.use(cors());
```

In development, make sure you're accessing the app through Vite's dev server (`localhost:5173`), not directly. The Vite proxy handles `/api/*` requests, so you shouldn't see CORS errors.

If you're hitting the API directly from a different origin, `cors()` with no options allows all origins.

---

### Vite Proxy Not Working

```
GET http://localhost:5173/api/accounts 504 (Gateway Timeout)
```

**Fix:** Ensure the API is running on port 3000. The proxy is configured in `vite.config.ts`:

```typescript
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
},
```

Check that:
1. The API is running: `curl http://localhost:3000/api/health`
2. The `API_PORT` env var matches the proxy target (default `3000`)

---

### Database Connection Failed

```
Error: Can't reach database server at `localhost:5432`
```

**Fix:**
1. Ensure PostgreSQL is running:
   ```bash
   docker compose up -d postgres
   # or check your local install:
   pg_isready
   ```
2. Verify `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL=postgresql://finance:changeme_in_production@localhost:5432/finance
   ```
3. For Docker Compose, use `localhost` (not `postgres`) when running outside Docker.

---

### Worker Fails to Start

```
Error: AZURE_OPENAI_ENDPOINT is not configured
```

The worker requires Azure OpenAI credentials for transaction categorization and report generation. Set these in `.env`:

```env
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
```

If you don't have Azure OpenAI access, you can still run the API and SPA without the worker.

---

### Prisma Migration Conflicts

```
Error: The migration ... was modified after it was applied
```

**Fix:** Reset your local database:

```bash
npx prisma migrate reset --schema=prisma/schema.prisma
```

> ⚠️ This drops all data and re-runs migrations + the seed script.
