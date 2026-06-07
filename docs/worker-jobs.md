# Worker Jobs

## 1. Overview

The worker service runs as a standalone Docker container alongside the API and SPA. It uses [`node-cron`](https://www.npmjs.com/package/node-cron) to schedule recurring background jobs that keep financial data fresh, categorized, and summarized.

**Architecture:**

```
┌──────────┐     ┌──────────┐     ┌─────────────────┐
│   SPA    │────▶│   API    │────▶│   PostgreSQL     │
└──────────┘     └──────────┘     └────────▲─────────┘
                                           │
                                  ┌────────┴─────────┐
                                  │     Worker        │
                                  │  (node-cron)      │
                                  └──┬───────────┬────┘
                                     │           │
                              ┌──────▼──┐  ┌─────▼───────┐
                              │SimpleFin│  │OpenAI API    │
                              │ Bridge  │  │              │
                              └─────────┘  └──────────────┘
```

**External dependencies:**

| Service | Purpose |
|---------|---------|
| PostgreSQL | Shared database with the API (via Prisma ORM) |
| SimpleFin Bridge | Financial data aggregation (accounts & transactions) |
| OpenAI-compatible LLM | LLM for categorization and report generation |

The worker has **6 scheduled cron jobs** and runs an **initial startup sequence** on boot.

---

## 2. Cron Schedule

| Job | Cron Expression | Schedule | Description |
|-----|----------------|----------|-------------|
| Import Transactions | `0 */6 * * *` | Every 6 hours (00:00, 06:00, 12:00, 18:00) | Fetches accounts & transactions from SimpleFin |
| Categorize Transactions | `15 */6 * * *` | 15 min after each import (00:15, 06:15, 12:15, 18:15) | Assigns categories to transactions via an OpenAI-compatible LLM |
| Backfill Transactions | `30 */6 * * *` | Every 6 hours at :30 (00:30, 06:30, 12:30, 18:30) | Imports one 90-day historical window per active account |
| Categorize Backfilled Transactions | `45 */6 * * *` | 15 min after each backfill (00:45, 06:45, 12:45, 18:45) | Assigns categories to uncategorized backfilled transactions |
| Generate Monthly Report | `0 6 1 * *` | 1st of each month at 6:00 AM | Creates a narrative monthly financial report |
| Net Worth Snapshot | `0 0 * * *` | Daily at midnight | Records a daily net worth data point |

All times are in the container's timezone. Categorization jobs are intentionally staggered 15 minutes after import and backfill to allow ingestion jobs to complete first.

**Source:** [`worker/src/index.ts`](../worker/src/index.ts)

---

## 3. Job Details

### 3.1 Import Transactions

**File:** [`worker/src/jobs/import-transactions.ts`](../worker/src/jobs/import-transactions.ts)

**Purpose:** Sync financial accounts and transactions from SimpleFin Bridge into the local database.

**How it works:**

1. **Determine start date** — Queries the most recent `SyncLog` with `status: 'SUCCESS'`. If found, the start date is set to 1 day before that sync's `startedAt` timestamp (overlap for safety). If no previous sync exists, no start date is passed (fetches all available history).
2. **Create SyncLog** — A new `SyncLog` record is created with `status: 'RUNNING'`.
3. **Fetch from SimpleFin** — Calls `fetchTransactions(startDate)` which executes `simplefin-cli transactions --start-date <date>` via `child_process.execSync`.
4. **Upsert accounts** — For each account returned:
   - Matches by `externalId` (SimpleFin account ID)
   - **Update:** balance, available balance, balance date, name, institution, institution domain
   - **Create:** all of the above plus currency and inferred account type
5. **Upsert transactions** — For each transaction on each account:
   - Matches by `externalId` (SimpleFin transaction ID) for deduplication
   - **Update:** amount, description, payee, memo
   - **Create:** all of the above plus accountId and posted date
6. **Finalize SyncLog** — Updates the `SyncLog` to `SUCCESS` with `accountCount` and `transactionCount`, or `FAILED` with `errorMessage`.

**Account type inference** (`inferAccountType`):

The function analyzes the account name (case-insensitive) and balance to assign a type:

| Condition | Type |
|-----------|------|
| Name contains `credit`, `visa`, or `mastercard` | `CREDIT_CARD` |
| Name contains `saving` | `SAVINGS` |
| Name contains `invest`, `brokerage`, `rrsp`, or `tfsa` | `INVESTMENT` |
| Name contains `mortgage` | `MORTGAGE` |
| Name contains `loan`, `loc`, or `line of credit` | `LOAN` |
| Name contains `checking` or `chequing` | `CHECKING` |
| Balance is negative (fallback) | `CREDIT_CARD` |
| Default fallback | `CHECKING` |

**SimpleFin data format:**

```json
{
  "ok": true,
  "accounts": [
    {
      "id": "ACT-xxx",
      "name": "My Checking",
      "currency": "CAD",
      "balance": "1234.56",
      "available-balance": "1200.00",
      "balance-date": 1710000000,
      "org": { "name": "Bank of Example", "domain": "example.com" },
      "transactions": [
        {
          "id": "TXN-xxx",
          "posted": 1709900000,
          "amount": "-42.50",
          "description": "GROCERY STORE #123",
          "payee": "Grocery Store",
          "memo": null
        }
      ]
    }
  ]
}
```

> **Note:** Monetary values are strings (parsed to floats). Dates (`posted`, `balance-date`) are Unix timestamps in seconds (converted to JS `Date` via `* 1000`).

**Error handling:**

- On failure, the `SyncLog` is updated to `FAILED` with `errorMessage` set to the stringified error, and the error is re-thrown.
- The outer scheduler in `index.ts` catches the error and logs it, preventing the process from crashing.

**Return value:** `{ accountCount: number; transactionCount: number }`

---

### 3.2 Categorize Transactions

**File:** [`worker/src/jobs/categorize-transactions.ts`](../worker/src/jobs/categorize-transactions.ts)

**Purpose:** Automatically assign categories to uncategorized transactions using an OpenAI-compatible LLM.

**How it works:**

1. **Fetch leaf categories** — Queries categories with no children (true leaves), including top-level categories that do not have subcategories.
2. **Find uncategorized transactions** — Queries transactions where `categoryId IS NULL` and `isReviewed = false`, ordered by `posted` descending, limited to 90 (`BATCH_SIZE * 3`).
3. **Batch processing** — Splits transactions into batches of 30. For each batch:
   a. Builds a prompt with the category list and transaction details
   b. Sends to an OpenAI-compatible API (temperature `0.1`, JSON mode)
   c. Parses the response into assignments that may contain `{ transactionId, categoryId }` or `{ transactionId, categoryName }`
   d. Resolves category IDs directly or by normalized category name
   e. Updates matching transactions with the assigned category
4. **Logging** — Logs per-batch and total counts.

**Constants:**

| Constant | Value | Description |
|----------|-------|-------------|
| `BATCH_SIZE` | `30` | Transactions per LLM request |
| Max batches per run | `3` | Hard limit: `BATCH_SIZE * 3 = 90` transactions max |

**Manual override:** Transactions with `isReviewed = true` are never touched by this job. Users can manually categorize and mark transactions as reviewed to prevent AI from overwriting their choices.

**Rate limiting:** Batches are processed sequentially (no parallelism) to avoid exceeding provider rate limits.

**Response parsing:** The code handles:
- A raw JSON array
- Object wrappers with `assignments` or `results`
- A single assignment object

It accepts either `categoryId` (validated against known IDs) or `categoryName` (resolved case-insensitively to a known category):

```typescript
const parsed = JSON.parse(content);
if (Array.isArray(parsed)) assignments = parsed;
else if (Array.isArray(parsed.assignments)) assignments = parsed.assignments;
else if (Array.isArray(parsed.results)) assignments = parsed.results;
else if (parsed.transactionId && (parsed.categoryId || parsed.categoryName)) assignments = [parsed];
```

**LLM prompt template** (from [`worker/src/prompts/categorize.ts`](../worker/src/prompts/categorize.ts)):

```
You are a financial transaction categorizer. Analyze each transaction and assign
the most appropriate category.

Available categories:
- "Groceries" (id: cat_abc123)
- "Dining Out" (id: cat_def456)
- ...

Transactions to categorize:
{ "id": "txn_1", "description": "GROCERY STORE #123", "amount": "-42.50", "payee": "Grocery Store" }
{ "id": "txn_2", "description": "NETFLIX.COM", "amount": "-15.99" }
...

Respond with a JSON object with an "assignments" array.
Each assignment must include "transactionId" and either "categoryId" or "categoryName".

Only output valid JSON. No explanations.
```

**Error handling:** If a batch fails (LLM error, parse error, etc.), the error is logged and the job continues with the next batch. Individual transaction updates that fail (e.g., transaction deleted between query and update) are silently caught and skipped.

**Return value:** Total number of successfully categorized transactions.

---

### 3.3 Generate Monthly Report

**File:** [`worker/src/jobs/generate-reports.ts`](../worker/src/jobs/generate-reports.ts) — `generateMonthlyReport()`

**Purpose:** Create an AI-powered monthly financial summary with insights and recommendations.

**How it works:**

1. **Calculate period** — Determines the previous month's start and end dates. The period is formatted as `YYYY-MM` (e.g., `2026-03`).
2. **Idempotency check** — Queries for an existing `Report` with the same `period` and `type: 'MONTHLY_SUMMARY'`. If found, skips.
3. **Aggregate financial data:**
   - Fetches all transactions in the date range (with category included)
   - Calculates total income (positive amounts) and total expenses (negative amounts)
   - Builds a `categorySpending` map (top 10 categories by spend)
4. **Gather account data** — Fetches all active accounts with their current balances and types.
5. **Build prompt** — Assembles all data into the report prompt.
6. **LLM call** — Sends to an OpenAI-compatible API (temperature `0.3`, JSON mode).
7. **Store report** — Creates a `Report` record with `type: 'MONTHLY_SUMMARY'`, the LLM-generated JSON as `content`, and the period string.

**Report JSON structure:**

```json
{
  "title": "Monthly Financial Report - 2026-03",
  "highlights": [
    "key insight 1",
    "key insight 2",
    "key insight 3"
  ],
  "incomeAnalysis": "Brief analysis of income trends",
  "expenseAnalysis": "Brief analysis of spending patterns",
  "savingsAnalysis": "Brief analysis of savings rate and recommendations",
  "topExpenseInsights": [
    "insight about top spending category",
    "insight 2"
  ],
  "recommendations": [
    "actionable recommendation 1",
    "recommendation 2"
  ],
  "overallScore": "B+",
  "scoreExplanation": "Why this grade was given"
}
```

**LLM prompt template** (from [`worker/src/prompts/report.ts`](../worker/src/prompts/report.ts)):

```
You are a personal finance analyst. Generate an insightful monthly financial report.

Period: 2026-03
Total Income: $5,230.00
Total Expenses: $3,890.50
Net Savings: $1,339.50
Transaction Count: 142

Top Spending Categories:
- Rent: $1,500.00
- Groceries: $620.30
- Dining Out: $340.00
- ...

Account Balances:
- Chequing (CHECKING): $3,450.00
- Savings (SAVINGS): $12,500.00
- Visa (CREDIT_CARD): $-1,230.50
- ...

Generate a JSON response with this structure:
{
  "title": "Monthly Financial Report - 2026-03",
  "highlights": ["key insight 1", "key insight 2", "key insight 3"],
  "incomeAnalysis": "Brief analysis of income trends",
  "expenseAnalysis": "Brief analysis of spending patterns",
  "savingsAnalysis": "Brief analysis of savings rate and recommendations",
  "topExpenseInsights": ["insight about top spending category", "insight 2"],
  "recommendations": ["actionable recommendation 1", "recommendation 2"],
  "overallScore": "A letter grade A-F for financial health this month",
  "scoreExplanation": "Why this grade was given"
}

Only output valid JSON.
```

**Error handling:** Catches LLM and parsing errors, logs them, and returns without creating a report. The job is idempotent — it will create the report on the next monthly run.

---

### 3.4 Net Worth Snapshot

**File:** [`worker/src/jobs/generate-reports.ts`](../worker/src/jobs/generate-reports.ts) — `takeNetWorthSnapshot()`

**Purpose:** Record a daily net worth data point for historical trend tracking and charts.

**How it works:**

1. **Idempotency check** — Sets today's date to midnight (`00:00:00.000`) and queries `NetWorthSnapshot` by that exact date. If a record exists, skips.
2. **Fetch accounts** — Queries all accounts where `isActive = true`.
3. **Classify and sum:**
   - **Assets** (positive): `CHECKING`, `SAVINGS`, `INVESTMENT`, `OTHER`
   - **Liabilities** (absolute value): `CREDIT_CARD`, `LOAN`, `MORTGAGE`
4. **Create snapshot** — Stores a `NetWorthSnapshot` with `totalAssets`, `totalLiabilities`, and `netWorth` (assets minus liabilities).

**Classification table:**

| Account Type | Classification |
|-------------|----------------|
| `CHECKING` | Asset |
| `SAVINGS` | Asset |
| `INVESTMENT` | Asset |
| `OTHER` | Asset |
| `CREDIT_CARD` | Liability |
| `LOAN` | Liability |
| `MORTGAGE` | Liability |

**Note:** Liability balances use `Math.abs()` to ensure they are stored as positive values in `totalLiabilities`.

---

## 4. SimpleFin Integration

**File:** [`worker/src/lib/simplefin.ts`](../worker/src/lib/simplefin.ts)

The worker communicates with [SimpleFin Bridge](https://www.simplefin.org/) via the `simplefin-cli` npm package, which is installed globally in the Docker container.

**Functions:**

| Function | CLI Command | Timeout | Description |
|----------|-------------|---------|-------------|
| `fetchAccounts()` | `simplefin-cli accounts` | 60s | Fetch account list (not currently used by jobs) |
| `fetchTransactions(startDate?, endDate?)` | `simplefin-cli transactions [--start-date X] [--end-date Y]` | 120s | Fetch accounts with transactions |

**Implementation details:**

- Uses `child_process.execSync` for synchronous CLI execution
- Passes the full `process.env` to the child process (including `SIMPLEFIN_ACCESS_URL`)
- Parses stdout as JSON
- On error, returns `{ ok: false, error: { code: 'FETCH_ERROR', message: '...' } }`

**TypeScript interfaces:**

```typescript
interface SFAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;                // String — parsed to float
  'available-balance'?: string;
  'balance-date': number;         // Unix timestamp (seconds)
  org: {
    domain?: string;
    name?: string;
    url?: string;
    sfin_url?: string;
  };
  transactions: SFTransaction[];
}

interface SFTransaction {
  id: string;
  posted: number;                 // Unix timestamp (seconds)
  amount: string;                 // String — parsed to float
  description: string;
  payee?: string;
  memo?: string;
}

interface SFResult {
  ok: boolean;
  accounts?: SFAccount[];
  error?: { code: string; message: string };
}
```

**Environment variable:**

| Variable | Description |
|----------|-------------|
| `SIMPLEFIN_ACCESS_URL` | SimpleFin Bridge access URL (contains embedded credentials). Passed to `simplefin-cli` via environment. |

---

## 5. OpenAI-Compatible Integration

**File:** [`worker/src/lib/openai.ts`](../worker/src/lib/openai.ts)

Uses the official `openai` npm package against an OpenAI-compatible chat completions endpoint.

**Client configuration:**

```typescript
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_BASE_URL` | _(optional)_ | Custom OpenAI-compatible base URL |
| `OPENAI_API_KEY` | _(required)_ | OpenAI-compatible API key |
| `OPENAI_MODEL` | _(required)_ | Model or deployment name |
| `OPENAI_TEMPERATURE` | `1` | Default temperature |

**LLM parameters by job:**

| Job | Temperature | Response Format | Reasoning |
|-----|-------------|-----------------|-----------|
| Categorize Transactions | `0.1` | `json_object` | Low temperature for consistent, deterministic categorization |
| Generate Monthly Report | `0.3` | `json_object` | Slightly higher temperature for more creative narrative writing |

Both jobs use `response_format: { type: 'json_object' }` to enforce structured JSON output from the model.

---

## 6. Startup Behavior

On container start, after all cron jobs are registered, the worker waits **10 seconds** then runs an initial sequence:

```typescript
setTimeout(async () => {
  await importTransactions();
  await categorizeTransactions();
  await takeNetWorthSnapshot();
}, 10000);
```

**Execution order:** Import → Categorize → Snapshot (sequential, not parallel).

This ensures that:
- Data is fresh immediately after a deployment or container restart
- New transactions are categorized right away
- The daily net worth snapshot is not missed if the container restarts after midnight

> **Note:** The monthly report is _not_ run on startup — it only runs on the 1st of each month via the cron schedule.

---

## 7. Logging

All jobs log to stdout/stderr with a bracketed prefix for easy filtering:

| Prefix | Source |
|--------|--------|
| `[Worker]` | Scheduler (`index.ts`) — job start/failure |
| `[Import]` | Import transactions job |
| `[Categorize]` | Categorize transactions job |
| `[Report]` | Monthly report generation |
| `[Snapshot]` | Net worth snapshot |
| `[SimpleFin]` | SimpleFin CLI wrapper |

**Viewing logs:**

```bash
# Follow all worker logs
docker compose logs -f worker

# Filter to a specific job
docker compose logs -f worker 2>&1 | grep '\[Import\]'

# View last 100 lines
docker compose logs --tail=100 worker
```

---

## 8. Error Handling

Each job is wrapped in a `try/catch` in the scheduler (`index.ts`), ensuring no single job failure crashes the worker process.

| Job | On Error |
|-----|----------|
| **Import Transactions** | Creates a `SyncLog` entry with `status: 'FAILED'` and `errorMessage`. Error is re-thrown to the scheduler, which logs it. |
| **Categorize Transactions** | Failed batches are logged and skipped; processing continues with the next batch. Individual transaction update failures are silently caught. |
| **Generate Monthly Report** | Error is logged. The job is idempotent — since no report was created, it will be retried on the next monthly trigger. |
| **Net Worth Snapshot** | Error is logged. Idempotent — will retry the next day. If the container restarts, the startup sequence will also attempt it. |

**Graceful shutdown:**

The worker listens for `SIGTERM` and `SIGINT` signals and exits cleanly:

```typescript
process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM, shutting down...');
  process.exit(0);
});
```

---

## 9. Customization

### Modify cron schedules

Edit the cron expressions in [`worker/src/index.ts`](../worker/src/index.ts):

```typescript
// Example: run import every 4 hours instead of 6
cron.schedule('0 */4 * * *', async () => { ... });
```

### Adjust batch size

Edit the `BATCH_SIZE` constant in [`worker/src/jobs/categorize-transactions.ts`](../worker/src/jobs/categorize-transactions.ts):

```typescript
const BATCH_SIZE = 30; // Change to desired size
```

The maximum transactions per run is `BATCH_SIZE * 3`.

### Customize LLM prompts

Prompt templates are in [`worker/src/prompts/`](../worker/src/prompts/):

| File | Used By | Purpose |
|------|---------|---------|
| `categorize.ts` | Categorize Transactions | Builds the category assignment prompt |
| `report.ts` | Generate Monthly Report | Builds the financial report prompt |

### Add a new job

1. Create a new file in `worker/src/jobs/` with an exported async function.
2. Register it in `worker/src/index.ts`:

```typescript
import { myNewJob } from './jobs/my-new-job';

cron.schedule('0 12 * * *', async () => {
  console.log('[Worker] Running: My New Job');
  try {
    await myNewJob();
  } catch (err) {
    console.error('[Worker] My New Job failed:', err);
  }
});
```

3. Optionally add it to the startup sequence in the `setTimeout` block.

---

## 10. Environment Variables Reference

| Variable | Required | Default | Used By |
|----------|----------|---------|---------|
| `DATABASE_URL` | Yes | — | Prisma (all jobs) |
| `SIMPLEFIN_ACCESS_URL` | Yes | — | SimpleFin CLI (import job) |
| `OPENAI_BASE_URL` | No | — | OpenAI-compatible client |
| `OPENAI_API_KEY` | Yes | — | OpenAI-compatible client |
| `OPENAI_MODEL` | Yes | — | Model or deployment selection |
| `OPENAI_TEMPERATURE` | No | `1` | Default LLM temperature |
