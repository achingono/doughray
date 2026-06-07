<div align="center">

# 💰 Doughray — Personal Finance Dashboard

![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green)

![Doughray product cover showcasing dashboard, transactions, budgets, goals, and reports](docs/cover-image.png)

A self-hosted personal finance dashboard that aggregates all your bank accounts, tracks net worth, visualizes spending, and generates AI-powered financial reports while running privately on your own hardware.

[Features](#-features) · [Quick Start](#-quick-start) · [Architecture](#-architecture) · [Tech Stack](#-tech-stack) · [Configuration](#configuration)

</div>

---

## ✨ Features

- 📊 **Dashboard** — Net worth hero card, trendline charts, income vs expenses, spending by category donut chart, budget progress, and goal progress cards
- 🏦 **Holdings** — Assets vs liabilities summary, accounts grouped by type (Checking, Savings, Credit Card, Investment, Loan, Mortgage), allocation pie chart, and account detail drawer with mini transaction history
- 💳 **Transactions** — Consolidated list across all accounts with filters (account, date range, category, search), sortable table, color-coded category badges, inline category editing, and server-side pagination
- 📥 **Transaction Import** — Upload OFX/QFX/CSV exports into an existing account or a newly created account, or import multi-account Excel activity exports with automatic account detection, duplicate detection, and categorization trigger
- 📝 **Reports** — LLM-generated monthly narrative reports with financial grades, highlights, and personalized recommendations
- ⚙️ **Settings** — SimpleFin sync status, manual sync trigger, sync history, and category management
- 🔄 **Automatic Sync** — Scheduled imports every 6 hours via SimpleFin
- 🤖 **AI Categorization** — An OpenAI-compatible LLM auto-categorizes new transactions
- 🐳 **One-Command Deploy** — Full stack runs with a single `docker compose up`

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Compose                      │
│                                                         │
│  ┌──────────┐     ┌──────────┐     ┌──────────────────┐ │
│  │          │     │          │     │                  │ │
│  │   spa    │────▶│   api    │────▶│    postgres      │ │
│  │  :80     │     │  :3000   │     │    :5432         │ │
│  │  Nginx + │ /api│ Express  │     │  PostgreSQL 16   │ │
│  │  React   │     │ + Prisma │     │                  │ │
│  │          │     │          │     │                  │ │
│  └──────────┘     └──────────┘     └──────────────────┘ │
│                        ▲                    ▲           │
│                        │                    │           │
│                   ┌────┴────────────────────┴─┐         │
│                   │         worker            │         │
│                   │       Node-cron           │         │
│                   │  SimpleFin · OpenAI API   │         │
│                   └───────────────────────────┘         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

| Service      | Description                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------- |
| **spa**      | React 18 SPA built with Vite, served by Nginx. Proxies `/api/*` requests to the API container. |
| **api**      | Express.js REST API on port 3000. Uses Prisma ORM for all database access.                      |
| **worker**   | Cron job runner — imports transactions via simplefin-cli, categorizes with an OpenAI-compatible LLM, and generates monthly reports. |
| **postgres** | PostgreSQL 16 (Alpine) storing all application data.                                            |

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) v2+
- A [SimpleFin Bridge](https://beta-bridge.simplefin.org/) access URL
- Access to an OpenAI-compatible LLM API such as OpenAI or Azure OpenAI (for AI categorization & reports)

### Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd <repo-directory>

# 2. Copy the example environment file
cp .env.example .env

# 3. Configure your environment variables
#    Edit .env and set your SimpleFin access URL, OpenAI-compatible LLM credentials,
#    and PostgreSQL password (see Configuration section below).

# 4. Start everything
docker compose up -d --build

# 5. Open the dashboard
open http://localhost
```

> **Note:** On first launch, the database schema is applied automatically, and the API seeds default categories on startup when the categories table is empty. The first scheduled SimpleFin sync will run within 6 hours, or you can trigger it manually from **Settings**.

---

## 📸 Screenshots

| Dashboard | Holdings | Transactions |
| :-------: | :------: | :----------: |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Holdings](docs/screenshots/holdings.png) | ![Transactions](docs/screenshots/transactions.png) |

| Budgets | Goals | Reports |
| :-----: | :---: | :-----: |
| ![Budgets](docs/screenshots/budgets.png) | ![Goals](docs/screenshots/goals.png) | ![Reports](docs/screenshots/reports.png) |

| Settings |
| :------: |
| ![Settings](docs/screenshots/settings.png) |

---

## 🛠 Tech Stack

### Frontend (SPA)

| Technology   | Purpose                  |
| ------------ | ------------------------ |
| React 18     | UI framework             |
| Vite         | Build tool and dev server |
| Tailwind CSS | Utility-first styling    |
| shadcn/ui    | 48 pre-built UI components |
| Recharts     | Charts and data visualization |
| TypeScript   | Type safety              |

### Backend (API)

| Technology    | Purpose                   |
| ------------- | ------------------------- |
| Express.js    | HTTP server and routing   |
| Prisma        | ORM and database migrations |
| PostgreSQL 16 | Relational database       |
| TypeScript    | Type safety               |

### Worker

| Technology    | Purpose                          |
| ------------- | -------------------------------- |
| Node-cron     | Job scheduling                   |
| simplefin-cli | Bank account data import         |
| OpenAI-compatible LLM | Transaction categorization & report generation |
| TypeScript    | Type safety                      |

### Infrastructure

| Technology     | Purpose                       |
| -------------- | ----------------------------- |
| Docker Compose | Container orchestration       |
| Nginx          | Static file serving and reverse proxy |

---

## 📁 Project Structure

```
.
├── README.md
├── docker-compose.yml
├── .env.example
├── docs/                       # Project documentation
├── code/
│   ├── package.json           # Root npm workspace config
│   ├── package-lock.json
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema
│   │   └── seed.ts            # Default categories seed
│   ├── api/                   # Express.js REST API
│   ├── spa/                   # React SPA
│   └── worker/                # Cron job runner
```

### Workspace Breakdown

```text
code/api/src/
├── index.ts                   # App entry point
├── routes/                    # Route modules
├── services/                  # Service layer
├── middleware/                # Error handler, validation
└── lib/                       # Prisma client, types

code/spa/src/
├── App.tsx                    # Router and layout
├── main.tsx                   # Entry point
├── pages/                     # Page components
├── components/                # UI and feature components
├── hooks/                     # Data fetching hooks
├── lib/                       # API client, formatters, utils
└── types/                     # TypeScript interfaces

code/worker/src/
├── index.ts                   # Cron scheduler
├── jobs/                      # Import, categorize, reports
├── lib/                       # Prisma, OpenAI, SimpleFin
└── prompts/                   # LLM prompt templates
├── docker-compose.yml
├── .env.example
└── package.json                # Root workspace
```
## Configuration
---

## ⚙️ Configuration
| Variable                  | Description                                | Required | Default |
| ------------------------- | ------------------------------------------ | :------: | ------- |
| `DATABASE_URL`            | PostgreSQL connection string               | ✅       | — |
| `POSTGRES_USER`           | PostgreSQL username                        | ❌       | `finance` |
| `POSTGRES_PASSWORD`       | PostgreSQL password                        | ❌       | `changeme_in_production` |
| `POSTGRES_DB`             | PostgreSQL database name                   | ❌       | `finance` |
| `SIMPLEFIN_ACCESS_URL`    | SimpleFin Bridge access URL for bank sync  | ✅       | — |
| `OPENAI_BASE_URL`         | Custom OpenAI-compatible base URL; leave empty for the default OpenAI API | ❌ | — |
| `OPENAI_API_KEY`          | OpenAI-compatible API key                  | ✅       | — |
| `OPENAI_MODEL`            | Model or deployment name used for AI features | ✅    | — |
| `OPENAI_TEMPERATURE`      | Default temperature for AI jobs and reports | ❌     | `1` |
| `NODE_ENV`                | Environment (`development` or `production`) | ❌       | `production` |
| `API_PORT`                | API host port                              | ❌       | `3000` |
| `SPA_PORT`                | SPA host port                              | ❌       | `80` |

---

## 🧑‍💻 Development

### Local Setup (without Docker)

```bash
# Prerequisites: Node.js 20+, PostgreSQL 16

# 1. Install dependencies
cd code
npm install

# 2. Set up environment
cd ..
cp .env.example .env
# Edit .env with your local PostgreSQL credentials and service settings

# 3. Run database migrations
cd code
npm run db:migrate

# 4. Seed default categories
npm run db:seed

# 5. Start the API server
npm run dev:api

# 6. Start the SPA dev server (in a separate terminal)
npm run dev:spa

# 7. Start the worker (in a separate terminal)
npm run dev:worker
```

The SPA dev server (Vite) will proxy `/api/*` requests to the local API server automatically.

---

## ✅ Automated Testing

```bash
cd code

# Run all unit + integration tests
npm test

# Run all tests with coverage
npm run test:coverage

# Run Playwright E2E tests
npm run test:e2e
```

Coverage reports are generated per workspace:

- `code/api/coverage/lcov.info`
- `code/spa/coverage/lcov.info`
- `code/worker/coverage/lcov.info`

These LCOV files are also wired into `sonar-project.properties` for SonarQube analysis.

---

## 🗄 Database Models

| Model               | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| **Account**          | Bank accounts, credit cards, investments, loans, mortgages   |
| **Transaction**      | Individual financial transactions across all accounts        |
| **Category**         | Hierarchical spending/income categories                      |
| **Budget**           | Monthly budget targets per category                          |
| **Report**           | LLM-generated monthly financial narrative reports            |
| **SyncLog**          | History of SimpleFin sync operations                         |
| **NetWorthSnapshot** | Daily point-in-time net worth snapshots for trend tracking   |

---

## 🔌 API Endpoints

| Method   | Endpoint                               | Description |
| -------- | -------------------------------------- | ----------- |
| `GET`    | `/api/health`                          | Health check |
| `GET`    | `/api/dashboard/summary`               | Dashboard summary metrics |
| `GET`    | `/api/dashboard/trends`                | Net worth and balance trend data |
| `GET`    | `/api/dashboard/spending-by-category`  | Spending breakdown by category |
| `GET`    | `/api/accounts`                        | List all accounts |
| `GET`    | `/api/accounts/:id`                    | Get account details |
| `GET`    | `/api/transactions`                    | List transactions with filters and pagination |
| `PATCH`  | `/api/transactions/:id`                | Update a transaction, for example category |
| `GET`    | `/api/holdings`                        | Current holdings summary |
| `GET`    | `/api/holdings/history`                | Historical holdings data |
| `GET`    | `/api/budgets`                         | List all budgets |
| `POST`   | `/api/budgets`                         | Create a budget |
| `PUT`    | `/api/budgets/:id`                     | Update a budget |
| `DELETE` | `/api/budgets/:id`                     | Delete a budget |
| `GET`    | `/api/categories`                      | List all categories |
| `POST`   | `/api/categories`                      | Create a category |
| `GET`    | `/api/reports`                         | List all reports |
| `GET`    | `/api/reports/:id`                     | Get a specific report |
| `GET`    | `/api/sync/status`                     | Current sync status |
| `GET`    | `/api/sync/history`                    | Sync operation history |
| `POST`   | `/api/sync/trigger`                    | Manually trigger a sync |

---

## ⏰ Cron Jobs

| Job                     | Schedule                | Description |
| ----------------------- | ----------------------- | ----------- |
| Import Transactions     | Every 6 hours           | Pulls new transactions from SimpleFin |
| Categorize Transactions | Every 6 hours (+15 min) | AI-categorizes uncategorized transactions |
| Categorize Backfilled Transactions | Every 6 hours (+45 min) | AI-categorizes uncategorized transactions after backfill |
| Monthly Report          | 1st of month at 6:00 AM | Generates an LLM narrative report for the previous month |
| Net Worth Snapshot      | Daily at midnight       | Records point-in-time net worth for trend charts |

---

## 📖 Documentation

Additional documentation is available in the [`docs/`](./docs/) directory:

- [API Reference](./docs/api-reference.md)
- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Development Guide](./docs/development.md)
- [Deployment Guide](./docs/deployment.md)
- [SonarQube Scanning](./docs/sonarqube-scanning.md)
- [Worker Jobs](./docs/worker-jobs.md)

---

## 🤝 Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linting and tests to ensure nothing is broken
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

Please ensure your code follows the existing style and includes appropriate TypeScript types.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">

Built with ❤️ for personal finance nerds

</div>
