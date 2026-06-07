# Doughray — Architecture Documentation

> Personal finance dashboard for self-hosted, single-user deployments.

---

## 1. System Overview

Doughray is a containerized personal finance dashboard composed of **four Docker containers** orchestrated via Docker Compose:

| Container    | Technology       | Role                                      |
| ------------ | ---------------- | ----------------------------------------- |
| **SPA**      | Nginx (Alpine)   | Serves the React single-page application  |
| **API**      | Express (Node 20)| REST API for data access and mutations     |
| **Worker**   | node-cron (Node 20) | Scheduled background jobs (import, categorization, reports) |
| **PostgreSQL** | PostgreSQL 16  | Persistent relational data store           |

### Design Principles

- **Single-user, self-hosted** — no authentication layer; the application is designed to run on a trusted private network.
- **Separation of concerns** — the API serves read/write requests from the SPA while the Worker handles all external service communication and long-running tasks independently.
- **Incremental sync** — transaction imports pull only new data since the last successful sync.

### High-Level Data Flow

```
SimpleFin Bridge ──▶ Worker ──▶ PostgreSQL ◀── API ◀── SPA (Browser)
                       │
                       ▼
               OpenAI-compatible API
```

The **Worker** is the only container that communicates with SimpleFin for transaction data. Both the **Worker** and **API** can call an OpenAI-compatible LLM service for categorization and report generation. The **API** reads and writes to PostgreSQL on behalf of the **SPA**. PostgreSQL is the single source of truth.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose Network                   │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │     SPA      │    │     API      │    │   Worker     │   │
│  │   (Nginx)    │───▶│  (Express)   │    │  (node-cron) │   │
│  │   :80        │    │  :3000       │    │              │   │
│  └──────────────┘    └──────┬───────┘    └──────┬───────┘   │
│                             │                    │           │
│                      ┌──────▼────────────────────▼──────┐   │
│                      │         PostgreSQL 16             │   │
│                      │           :5432                   │   │
│                      └──────────────────────────────────┘   │
│                                                              │
│  Worker also connects to:                                    │
│  ┌──────────────┐    ┌──────────────┐                       │
│  │  SimpleFin   │    │ OpenAI API   │                       │
│  │  Bridge API  │    │    API       │                       │
│  └──────────────┘    └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Container Communication Summary

| Source   | Destination   | Protocol | Purpose                        |
| -------- | ------------- | -------- | ------------------------------ |
| SPA      | API           | HTTP     | Nginx reverse-proxies `/api/*` |
| API      | PostgreSQL    | TCP      | Prisma Client queries          |
| Worker   | PostgreSQL    | TCP      | Prisma Client queries          |
| Worker   | SimpleFin     | HTTPS    | Transaction import via CLI     |
| API      | OpenAI-compatible LLM | HTTPS | On-demand AI reports and categorization |
| Worker   | OpenAI-compatible LLM | HTTPS | Scheduled categorization & report generation |

---

## 3. Container Details

### 3.1 SPA Container

| Property        | Value                                    |
| --------------- | ---------------------------------------- |
| Base Image      | Multi-stage: `node:20` → `nginx:alpine` |
| Exposed Port    | `80`                                     |
| Framework       | React + Vite                             |
| Routing         | SPA fallback (all routes → `index.html`) |

#### Build Process

The Dockerfile uses a **multi-stage build**:

1. **Stage 1 — Build** (`node:20`): Installs dependencies, runs `vite build`, producing optimized static assets in `dist/`.
2. **Stage 2 — Serve** (`nginx:alpine`): Copies the `dist/` output and a custom `nginx.conf` into the Nginx image.

#### Nginx Configuration

```nginx
# Key directives in nginx.conf

# Gzip compression
gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;

# Static asset caching (1 year for hashed filenames)
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# API reverse proxy
location /api/ {
    proxy_pass http://api:3000;
}

# SPA fallback
location / {
    try_files $uri $uri/ /index.html;
}
```

- **Gzip compression** is enabled for CSS, JS, JSON, and SVG to minimize transfer sizes.
- **Static asset caching** uses a 1-year expiry since Vite produces content-hashed filenames — any code change generates new filenames, naturally busting the cache.
- **API proxy** forwards all `/api/*` requests to the API container on port 3000, keeping the browser unaware of the internal service topology.
- **SPA fallback** ensures client-side routing works by serving `index.html` for any route not matching a static file.

---

### 3.2 API Container

| Property        | Value                       |
| --------------- | --------------------------- |
| Base Image      | `node:20-alpine`            |
| Exposed Port    | `3000`                      |
| Framework       | Express.js (TypeScript → JS)|
| ORM             | Prisma Client               |

#### Startup Sequence

1. Run `npx prisma migrate deploy` — applies any pending database migrations.
2. Start the Express server on port 3000.

#### Route Modules

The API mounts **8 route modules** under the `/api/` prefix:

| Route Module       | Endpoint Prefix        | Purpose                              |
| ------------------ | ---------------------- | ------------------------------------ |
| Accounts           | `/api/accounts`        | CRUD for bank/investment accounts    |
| Transactions       | `/api/transactions`    | List, filter, update transactions    |
| Categories         | `/api/categories`      | Category tree management             |
| Budgets            | `/api/budgets`         | Budget CRUD and progress tracking    |
| Reports            | `/api/reports`         | Retrieve generated reports           |
| Net Worth          | `/api/net-worth`       | Net worth snapshots over time        |
| Sync               | `/api/sync`            | Sync status and manual trigger       |
| Dashboard          | `/api/dashboard`       | Aggregated dashboard summary data    |

#### Middleware Stack

- **CORS** — enabled for cross-origin requests during development.
- **Zod validation middleware** — validates request bodies, query parameters, and path parameters against Zod schemas before reaching route handlers.
- **Error handling middleware** — catches all errors and returns structured JSON responses:

  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Human-readable description",
      "details": []
    }
  }
  ```

#### Database Access

A **Prisma Client singleton** is instantiated once and reused across all route handlers, ensuring connection pooling is managed efficiently.

---

### 3.3 Worker Container

| Property        | Value                          |
| --------------- | ------------------------------ |
| Base Image      | `node:20-alpine`               |
| External Tools  | `simplefin-cli` (global npm)   |
| Scheduler       | `node-cron`                    |
| External APIs   | SimpleFin Bridge, OpenAI-compatible LLM |

#### Scheduled Jobs

| Job                        | Cron Schedule           | Description                                          |
| -------------------------- | ----------------------- | ---------------------------------------------------- |
| Transaction Import         | Every 6 hours           | Pulls new transactions from SimpleFin Bridge         |
| Transaction Categorization | 15 min after import     | Categorizes uncategorized transactions via an OpenAI-compatible LLM |
| Backfill Transactions      | Every 6 hours at :30    | Imports one 90-day historical transaction window per account |
| Backfill Categorization    | 15 min after backfill   | Categorizes uncategorized transactions imported by backfill |
| Report Generation          | 1st of month, 6:00 AM  | Generates monthly financial reports via an OpenAI-compatible LLM  |
| Net Worth Snapshot         | Daily                   | Records a point-in-time net worth snapshot            |

#### Startup Behavior

On container start, the Worker waits **10 seconds** (to allow PostgreSQL and migrations to complete), then performs an **initial transaction import** before handing off to the cron scheduler.

#### Shared Database Access

The Worker uses the **same Prisma schema** as the API container, connecting to the same PostgreSQL database. This ensures both services share a consistent view of the data model.

---

### 3.4 PostgreSQL Container

| Property        | Value                     |
| --------------- | ------------------------- |
| Base Image      | `postgres:16-alpine`      |
| Exposed Port    | `5432` (internal only)    |
| Database Name   | `finance`                 |
| Volume          | `pgdata` (named volume)   |

#### Configuration

- **Persistent volume** — the `pgdata` named Docker volume ensures data survives container restarts and recreations.
- **Health check** — Docker Compose uses `pg_isready` to verify PostgreSQL is accepting connections before dependent containers start.
- **Credentials** — configured via environment variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).

---

## 4. Database Schema

The database is managed by **Prisma ORM** with 7 models. All primary keys use CUIDs for globally unique, URL-safe identifiers.

### 4.1 Account

Represents a financial account imported from SimpleFin (checking, savings, credit card, etc.).

| Field              | Type              | Constraints / Default          |
| ------------------ | ----------------- | ------------------------------ |
| `id`               | `String` (cuid)   | Primary key                    |
| `externalId`       | `String`          | **Unique** — SimpleFin account ID |
| `name`             | `String`          | Account display name           |
| `institution`      | `String`          | Financial institution name     |
| `institutionDomain`| `String`          | Institution domain (e.g. `chase.com`) |
| `currency`         | `String`          | Default: `"USD"`               |
| `type`             | `AccountType` enum| `CHECKING`, `SAVINGS`, `CREDIT_CARD`, `INVESTMENT`, `LOAN`, `MORTGAGE`, `OTHER` |
| `balance`          | `Decimal(15,2)`   | Current balance                |
| `availableBalance` | `Decimal(15,2)?`  | Optional available balance     |
| `balanceDate`      | `DateTime`        | Date the balance was recorded  |
| `isActive`         | `Boolean`         | Default: `true`                |
| `createdAt`        | `DateTime`        | Auto-set on creation           |
| `updatedAt`        | `DateTime`        | Auto-updated on change         |

**Relations:**

- Has many → `Transaction`

**Indexes:**

- `type` — filter accounts by type
- `isActive` — filter active/inactive accounts

---

### 4.2 Transaction

Represents a single financial transaction linked to an account.

| Field          | Type              | Constraints / Default          |
| -------------- | ----------------- | ------------------------------ |
| `id`           | `String` (cuid)   | Primary key                    |
| `externalId`   | `String`          | **Unique** — SimpleFin transaction ID |
| `accountId`    | `String`          | Foreign key → `Account.id`     |
| `posted`       | `DateTime`        | Date the transaction posted    |
| `amount`       | `Decimal(15,2)`   | Transaction amount (signed)    |
| `description`  | `String`          | Transaction description        |
| `payee`        | `String?`         | Optional payee name            |
| `memo`         | `String?`         | Optional memo/notes            |
| `categoryId`   | `String?`         | Foreign key → `Category.id` (optional) |
| `isReviewed`   | `Boolean`         | Default: `false`               |
| `createdAt`    | `DateTime`        | Auto-set on creation           |
| `updatedAt`    | `DateTime`        | Auto-updated on change         |

**Relations:**

- Belongs to → `Account`
- Optionally belongs to → `Category`

**Indexes:**

- `accountId` — filter transactions by account
- `categoryId` — filter transactions by category
- `posted` — sort/filter by date
- `(accountId, posted)` — compound index for efficient account + date range queries

**Cascade Rules:**

- Delete `Account` → **cascade delete** all related `Transaction` records
- Delete `Category` → **set null** on `categoryId` (transactions become uncategorized)

---

### 4.3 Category

Represents a spending/income category in a self-referential tree structure.

| Field      | Type            | Constraints / Default      |
| ---------- | --------------- | -------------------------- |
| `id`       | `String` (cuid) | Primary key                |
| `name`     | `String`        | **Unique** — category name |
| `icon`     | `String?`       | Optional Lucide icon name  |
| `color`    | `String?`       | Optional Tailwind CSS color|
| `parentId` | `String?`       | Self-referential FK → `Category.id` |

**Relations:**

- Self-referential tree: optional `parent` → `Category`, has many `children` → `Category`
- Has many → `Transaction`
- Has many → `Budget`

**Seed Data:**

The database is seeded with **11 parent categories** and approximately **40 child categories** covering standard personal finance taxonomy:

```
Housing
  ├── Rent/Mortgage
  ├── Utilities
  ├── Maintenance
  └── Insurance
Food & Dining
  ├── Groceries
  ├── Restaurants
  ├── Coffee Shops
  └── Fast Food
Transportation
  ├── Gas
  ├── Public Transit
  ├── Parking
  └── Car Maintenance
... (and so on)
```

---

### 4.4 Budget

Defines a spending target for a category over a recurring period.

| Field        | Type              | Constraints / Default      |
| ------------ | ----------------- | -------------------------- |
| `id`         | `String` (cuid)   | Primary key                |
| `categoryId` | `String`          | Foreign key → `Category.id`|
| `amount`     | `Decimal(15,2)`   | Budget amount              |
| `period`     | `BudgetPeriod` enum | `WEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY` |
| `startDate`  | `DateTime`        | Budget start date          |
| `endDate`    | `DateTime?`       | Optional end date          |
| `createdAt`  | `DateTime`        | Auto-set on creation       |
| `updatedAt`  | `DateTime`        | Auto-updated on change     |

**Relations:**

- Belongs to → `Category`

**Cascade Rules:**

- Delete `Category` → **cascade delete** all related `Budget` records

---

### 4.5 Report

Stores LLM-generated financial reports as structured JSON.

| Field        | Type              | Constraints / Default      |
| ------------ | ----------------- | -------------------------- |
| `id`         | `String` (cuid)   | Primary key                |
| `title`      | `String`          | Report title               |
| `type`       | `ReportType` enum | `MONTHLY_SUMMARY`, `SPENDING_ANALYSIS`, `NET_WORTH_TREND`, `BUDGET_REVIEW` |
| `content`    | `Json`            | LLM-generated structured data |
| `period`     | `String`          | Period identifier (e.g. `"2026-03"`) |
| `generatedAt`| `DateTime`        | When the report was generated |

**Notes:**

- The `content` field stores the full structured JSON response from the configured LLM provider, allowing the SPA to render rich report visualizations without additional API calls.
- The `period` field uses an ISO-style string (e.g. `"2026-03"`) for easy filtering and sorting.

---

### 4.6 SyncLog

Tracks the status and results of each SimpleFin sync operation.

| Field              | Type              | Constraints / Default      |
| ------------------ | ----------------- | -------------------------- |
| `id`               | `String` (cuid)   | Primary key                |
| `status`           | `SyncStatus` enum | `RUNNING`, `SUCCESS`, `FAILED` |
| `accountCount`     | `Int`             | Number of accounts synced  |
| `transactionCount` | `Int`             | Number of transactions synced |
| `errorMessage`     | `String?`         | Optional error details     |
| `startedAt`        | `DateTime`        | Sync start timestamp       |
| `completedAt`      | `DateTime?`       | Sync completion timestamp  |

**Notes:**

- A `RUNNING` entry is created at the start of each sync. On completion it is updated to `SUCCESS` or `FAILED`.
- The SPA displays the latest SyncLog entry to show the user when data was last refreshed and whether it succeeded.

---

### 4.7 NetWorthSnapshot

A point-in-time snapshot of aggregate net worth, recorded daily.

| Field              | Type              | Constraints / Default      |
| ------------------ | ----------------- | -------------------------- |
| `id`               | `String` (cuid)   | Primary key                |
| `date`             | `DateTime`        | **Unique** — snapshot date |
| `totalAssets`      | `Decimal`         | Sum of asset account balances |
| `totalLiabilities` | `Decimal`         | Sum of liability account balances |
| `netWorth`         | `Decimal`         | `totalAssets - totalLiabilities` |
| `createdAt`        | `DateTime`        | Auto-set on creation       |

**Notes:**

- One snapshot per day (enforced by unique constraint on `date`).
- Assets include `CHECKING`, `SAVINGS`, and `INVESTMENT` account types.
- Liabilities include `CREDIT_CARD`, `LOAN`, and `MORTGAGE` account types.

---

### Entity Relationship Summary

```
Account 1──────▶ * Transaction
Category 1──────▶ * Transaction     (optional, SET NULL on delete)
Category 1──────▶ * Budget          (CASCADE on delete)
Category 1──────▶ * Category        (self-referential parent/children)

Report          (standalone)
SyncLog         (standalone)
NetWorthSnapshot (standalone)
```

---

## 5. Data Flow Diagrams

### 5.1 Transaction Import Flow

```
┌──────────┐    ┌───────────────┐    ┌──────────┐    ┌────────────┐
│  Cron    │    │  SimpleFin    │    │  Worker  │    │ PostgreSQL │
│ (every 6h)│──▶│  Bridge API   │──▶│  Parser  │──▶│  Database  │
└──────────┘    └───────────────┘    └──────────┘    └────────────┘
```

**Step-by-step:**

1. **Cron trigger** — the `node-cron` scheduler fires the transaction import job every 6 hours.
2. **CLI invocation** — the Worker executes `simplefin-cli transactions --start-date <last_sync>`, where `<last_sync>` is the `completedAt` timestamp of the most recent successful `SyncLog` entry.
3. **JSON output** — the CLI writes JSON to stdout containing an `accounts[]` array, each with nested `transactions[]`.
4. **Account upsert** — the Worker iterates over `accounts[]` and upserts `Account` records using `externalId` as the deduplication key. Balances and metadata are updated on each sync.
5. **Transaction upsert** — the Worker iterates over each account's `transactions[]` and upserts `Transaction` records using `externalId` as the deduplication key. New transactions are inserted; existing ones are updated if the source data changed.
6. **SyncLog entry** — a `SyncLog` record is created with status `RUNNING` at the start. On completion it is updated to `SUCCESS` (with counts) or `FAILED` (with error message).

---

### 5.2 Transaction Categorization Flow

```
┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌────────────┐
│  Cron    │    │ PostgreSQL │    │ OpenAI API   │    │ PostgreSQL │
│(15m post)│──▶│  (query)   │──▶│    API       │──▶│  (update)  │
└──────────┘    └────────────┘    └──────────────┘    └────────────┘
```

**Step-by-step:**

1. **Cron trigger** — fires 15 minutes after the transaction import job to allow imports to complete.
2. **Query uncategorized** — the Worker queries the database for transactions where `categoryId IS NULL` and `isReviewed = false`.
3. **Batch requests** — transactions are grouped into batches of **30** per OpenAI-compatible API request to stay within token limits while maximizing throughput.
4. **Build prompt** — each batch includes the list of available categories (id + name) and the transaction descriptions, amounts, and payees.
5. **Parse response** — the LLM returns a JSON array of `[{transactionId, categoryId}]` mappings.
6. **Update transactions** — the Worker updates each transaction's `categoryId` based on the LLM response.

---

### 5.3 Report Generation Flow

```
┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌────────────┐
│  Cron    │    │ PostgreSQL │    │ OpenAI API   │    │ PostgreSQL │
│(1st, 6AM)│──▶│  (query)   │──▶│    API       │──▶│  (insert)  │
└──────────┘    └────────────┘    └──────────────┘    └────────────┘
```

**Step-by-step:**

1. **Cron trigger** — fires on the 1st of each month at 6:00 AM.
2. **Query previous month** — the Worker retrieves all transactions from the previous calendar month.
3. **Aggregate data** — totals are computed: total income, total expenses, spending grouped by category, budget vs. actual comparisons.
4. **Build prompt** — the financial summary data is formatted into a structured prompt requesting analysis, insights, and recommendations.
5. **LLM response** — the LLM returns a structured JSON report containing narrative analysis, key metrics, and category breakdowns.
6. **Store report** — the Worker inserts a new `Report` record with the structured JSON in the `content` field.

---

### 5.4 User Request Flow

```
┌─────────┐    ┌───────┐    ┌──────┐    ┌────────────┐
│ Browser │──▶│ Nginx │──▶│ API  │──▶│ PostgreSQL │
│  (SPA)  │◀──│ (:80) │◀──│(:3000)│◀──│  (:5432)   │
└─────────┘    └───────┘    └──────┘    └────────────┘
```

**Step-by-step:**

1. **Browser request** — the user navigates to the Doughray URL. The browser sends the request to the **SPA container** (Nginx on port 80).
2. **Static assets** — HTML, CSS, JS, and images are served directly by Nginx from the built React application. Hashed assets receive 1-year cache headers.
3. **API calls** — any request matching `/api/*` is reverse-proxied by Nginx to the **API container** on port 3000. The browser never communicates directly with the API container.
4. **Database queries** — the API container queries **PostgreSQL** via Prisma Client, leveraging connection pooling for efficient database access.
5. **JSON response** — the API returns JSON data to the SPA, which renders interactive charts and tables using **React** and **Recharts**.

---

## 6. Security Considerations

| Area                  | Approach                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| **Authentication**    | None — single-user, self-hosted on a trusted private network             |
| **Database credentials** | Passed via environment variables in Docker Compose (never in source code) |
| **SimpleFin access**  | The SimpleFin access URL (containing embedded credentials) is stored as an environment variable (`SIMPLEFIN_ACCESS_URL`) |
| **OpenAI-compatible LLM** | API key stored as an environment variable (`OPENAI_API_KEY`)       |
| **Secrets in code**   | No secrets are committed to source control; `.env` files are `.gitignore`d |
| **Network isolation** | Docker Compose creates an internal bridge network; only the SPA container's port 80 is exposed to the host |
| **Container images**  | Alpine-based images minimize attack surface                              |

### Recommendations for Production Hardening

- Add a reverse proxy (e.g., Caddy, Traefik) with TLS termination in front of the SPA container.
- Consider adding basic authentication or a VPN if exposing to a broader network.
- Rotate SimpleFin access URLs and OpenAI-compatible API keys periodically.
- Enable PostgreSQL SSL for encrypted database connections.

---

## 7. Scalability Notes

| Component         | Scalability Characteristics                                              |
| ----------------- | ------------------------------------------------------------------------ |
| **SPA**           | Fully static — can be served from a CDN if needed. Infinitely horizontally scalable for reads. |
| **API**           | Stateless Express server. Can be horizontally scaled behind a load balancer. Prisma connection pooling manages database connections efficiently. |
| **Worker**        | Runs jobs sequentially via `node-cron` (one job at a time). This is intentional — it avoids race conditions and keeps resource usage predictable for a single-user system. |
| **PostgreSQL**    | Handles concurrent reads from both the API and Worker without contention. Write volume is low (periodic syncs). |
| **Transaction imports** | Incremental by design — each sync only fetches transactions since the last successful sync date, keeping import times short even as history grows. |

### Current Limitations (Acceptable for Single-User)

- No horizontal scaling of the Worker (only one instance should run to avoid duplicate imports).
- No read replicas for PostgreSQL (unnecessary at single-user scale).
- No message queue between services (direct database access is simpler and sufficient).

### If Scaling Were Needed

1. Replace `node-cron` with a proper job queue (e.g., BullMQ + Redis) for distributed workers.
2. Add PostgreSQL read replicas for heavy read workloads.
3. Deploy the SPA to a CDN (Cloudflare, AWS CloudFront) for global distribution.
4. Introduce connection pooling middleware (e.g., PgBouncer) between the API and PostgreSQL.
