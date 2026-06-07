# Configuration Reference

## Overview

All configuration is done through environment variables in a `.env` file at the project root (`code/.env`). Docker Compose reads this file automatically and passes variables to containers. A template is provided in `.env.example` — copy it to get started:

```bash
cp .env.example .env
```

Edit `.env` with your values, then run:

```bash
docker compose up -d
```

No configuration is hard-coded in application source. Every tunable setting is controlled via environment variables documented below.

---

## Environment Variables

### Database Configuration

| Variable | Required | Default | Used By | Description |
|----------|----------|---------|---------|-------------|
| `POSTGRES_DB` | No | `finance` | postgres | Database name |
| `POSTGRES_USER` | No | `finance` | postgres | Database user |
| `POSTGRES_PASSWORD` | Yes | `password` | postgres | Database password (**change in production**) |
| `DATABASE_URL` | Yes | *(composed)* | api, worker | Full PostgreSQL connection string |

**Connection string format:**

```
postgresql://<user>:<password>@<host>:<port>/<database>
```

**For Docker (default):**

```env
DATABASE_URL=postgresql://finance:password@postgres:5432/finance
```

**For local development (outside Docker):**

```env
DATABASE_URL=postgresql://finance:password@localhost:5432/finance
```

> **Note:** When running inside Docker Compose, the hostname is `postgres` (the service name). When running the API or worker directly on the host, use `localhost` instead.

---

### SimpleFin Configuration

| Variable | Required | Default | Used By | Description |
|----------|----------|---------|---------|-------------|
| `SIMPLEFIN_ACCESS_URL` | Yes* | *(empty)* | worker | SimpleFin Bridge access URL with embedded credentials |

\* Required for transaction import. The worker will log errors but continue running without it.

#### How to Get Your SimpleFin Access URL

1. Go to [https://bridge.simplefin.org](https://bridge.simplefin.org)
2. Sign up for an account
3. Connect your financial institutions (banks, credit cards, investment accounts)
4. Generate a **setup token** (a base64-encoded string)
5. Exchange the token for a permanent access URL:
   ```bash
   npx simplefin-cli setup <your-base64-token>
   ```
6. The CLI outputs your permanent access URL
7. Copy the access URL into `SIMPLEFIN_ACCESS_URL` in your `.env` file

**Example value:**

```env
SIMPLEFIN_ACCESS_URL=https://user:pass@bridge.simplefin.org/simplefin
```

> **Security warning:** The access URL contains embedded HTTP Basic Auth credentials. Anyone with this URL can read your financial data. If compromised, generate a new token from SimpleFin Bridge immediately.

---

### OpenAI-Compatible LLM Configuration

| Variable | Required | Default | Used By | Description |
|----------|----------|---------|---------|-------------|
| `OPENAI_BASE_URL` | No | *(empty)* | api, worker | Custom OpenAI-compatible base URL. Leave empty to use the default OpenAI API. |
| `OPENAI_API_KEY` | Yes* | *(empty)* | api, worker | API key for the configured OpenAI-compatible provider |
| `OPENAI_MODEL` | Yes* | *(empty)* | api, worker | Model or deployment name used for AI features |
| `OPENAI_TEMPERATURE` | No | `1` | api, worker | Default temperature for AI-powered requests |

\* Required for AI-powered transaction categorization and report generation. The app still runs without these, but AI categorization and AI-generated reports will not.

#### How to Set Up an OpenAI-Compatible Provider

1. Choose an OpenAI-compatible provider such as OpenAI or Azure OpenAI.
2. Create or deploy the model you want to use.
3. Collect:
   - **API key** → `OPENAI_API_KEY`
   - **Model or deployment name** → `OPENAI_MODEL`
   - **Base URL** → `OPENAI_BASE_URL` when your provider requires a custom endpoint
4. Set the values in your `.env` file

**Example configuration:**

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4o-mini
OPENAI_TEMPERATURE=1
```

---

### Application Settings

| Variable | Required | Default | Used By | Description |
|----------|----------|---------|---------|-------------|
| `NODE_ENV` | No | `production` | api, worker | Environment mode (`production` or `development`) |
| `API_PORT` | No | `3000` | api, docker-compose | Port the API server listens on (external mapping) |
| `SPA_PORT` | No | `80` | docker-compose | Port the SPA/Nginx container is exposed on |

---

## Docker Compose Configuration

### Service Ports

| Service | Internal Port | Default External Port | Configurable Via |
|---------|--------------|----------------------|-----------------|
| **spa** | 80 | 80 | `SPA_PORT` in `.env` |
| **api** | 3000 | 3000 | `API_PORT` in `.env` |
| **postgres** | 5432 | 5432 | Edit `docker-compose.yml` directly |
| **worker** | N/A | N/A | No ports exposed (background cron service) |

### Volumes

| Volume | Mount Point | Purpose | Persistence |
|--------|-------------|---------|-------------|
| `pgdata` | `/var/lib/postgresql/data` | PostgreSQL data files | Persists across container restarts and rebuilds |

> **Warning:** Running `docker compose down -v` will delete the `pgdata` volume and all database data.

### Startup Order and Health Checks

| Service | Depends On | Wait Condition |
|---------|-----------|----------------|
| **postgres** | — | — |
| **api** | postgres | `service_healthy` (waits for pg_isready) |
| **worker** | postgres | `service_healthy` (waits for pg_isready) |
| **spa** | api | Service started |

PostgreSQL health check configuration:
- **Command:** `pg_isready -U <POSTGRES_USER> -d <POSTGRES_DB>`
- **Interval:** 5 seconds
- **Timeout:** 5 seconds
- **Retries:** 5

The API container runs Prisma migrations on startup before starting the server. When the API boots, it also seeds default categories if the categories table is empty:

```sh
npx prisma migrate deploy --schema=prisma/schema.prisma && node dist/index.js
```

---

## Nginx Configuration

The SPA container runs Nginx with the following behavior (defined in `spa/nginx.conf`):

| Feature | Configuration |
|---------|--------------|
| **SPA fallback** | All routes serve `index.html` via `try_files $uri $uri/ /index.html` |
| **API proxy** | `/api/*` requests are proxied to `http://api:3000` |
| **WebSocket support** | Proxy passes `Upgrade` and `Connection` headers |
| **Forwarded headers** | Sets `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` |
| **Static asset caching** | JS, CSS, images, fonts: 1 year expiry with `Cache-Control: public, immutable` |
| **Gzip compression** | Enabled for text, CSS, JS, JSON, XML (min 1000 bytes) |

### Vite Dev Server (Local Development)

When developing outside Docker, the Vite dev server provides:

| Setting | Value |
|---------|-------|
| Dev server port | `5173` |
| API proxy | `/api` → `http://localhost:3000` |
| Hot Module Replacement | Enabled |

Access the SPA at `http://localhost:5173` during development.

---

## Cron Job Schedules

Configured in `worker/src/index.ts`. All times are in the container's timezone (UTC by default).

| Job | Cron Expression | Schedule | Description |
|-----|----------------|----------|-------------|
| **Import Transactions** | `0 */6 * * *` | Every 6 hours (midnight, 6 AM, noon, 6 PM) | Fetches new transactions from SimpleFin |
| **Categorize Transactions** | `15 */6 * * *` | 15 minutes after each import | AI-categorizes uncategorized transactions |
| **Backfill Transactions** | `30 */6 * * *` | Every 6 hours at minute 30 | Backfills one 90-day history window per account |
| **Categorize Backfilled Transactions** | `45 */6 * * *` | 15 minutes after each backfill | AI-categorizes uncategorized backfilled transactions |
| **Monthly Report** | `0 6 1 * *` | 1st of each month at 6:00 AM | Generates AI-powered monthly financial report |
| **Net Worth Snapshot** | `0 0 * * *` | Daily at midnight | Records current net worth across all accounts |

**Cron expression format:** `minute hour day-of-month month day-of-week`

**Initial startup behavior:** The worker also runs import, categorize, and net worth snapshot jobs 10 seconds after startup, so data is populated immediately on first deploy.

> **To modify schedules:** Edit the cron expressions in `worker/src/index.ts` and rebuild the worker container:
> ```bash
> docker compose up -d --build worker
> ```

---

## Development vs Production

| Setting | Development | Production |
|---------|------------|------------|
| `NODE_ENV` | `development` | `production` |
| `DATABASE_URL` host | `localhost:5432` | `postgres:5432` (Docker internal DNS) |
| Prisma logging | `query`, `error`, `warn` | `error` only |
| SPA | Vite dev server with HMR on port `5173` | Built static files served by Nginx |
| API | `ts-node-dev` with hot reload | Compiled JavaScript via `node dist/index.js` |
| API proxy | Vite proxies `/api` → `localhost:3000` | Nginx proxies `/api` → `api:3000` |

### Local Development Setup

1. Start only the database:
   ```bash
   docker compose up -d postgres
   ```
2. Set `DATABASE_URL` to use `localhost`:
   ```env
   DATABASE_URL=postgresql://finance:password@localhost:5432/finance
   ```
3. Run the API and worker with their dev scripts
4. Run the SPA with `npm run dev` (starts Vite on port 5173)

---

## Sample .env Files

### Minimal (Development)

The bare minimum to get started. Uses all defaults:

```env
DATABASE_URL=postgresql://finance:password@localhost:5432/finance
```

### Full (Production)

Complete configuration with all variables:

```env
# Database
POSTGRES_DB=finance
POSTGRES_USER=finance
POSTGRES_PASSWORD=your-strong-password-here-32-chars-minimum
DATABASE_URL=postgresql://finance:your-strong-password-here-32-chars-minimum@postgres:5432/finance

# SimpleFin Bridge
SIMPLEFIN_ACCESS_URL=https://user:pass@bridge.simplefin.org/simplefin

# OpenAI-compatible LLM provider
OPENAI_BASE_URL=
OPENAI_API_KEY=your-openai-compatible-api-key
OPENAI_MODEL=gpt-4o-mini
OPENAI_TEMPERATURE=1

# App Settings
NODE_ENV=production
API_PORT=3000
SPA_PORT=80
```

---

## Security Recommendations

| Recommendation | Details |
|---------------|---------|
| **Change default passwords** | Never use `password` or `changeme_in_production` in production |
| **Strong database password** | Use 32+ characters with mixed case, numbers, and symbols for `POSTGRES_PASSWORD` |
| **Restrict Docker ports** | Bind to `127.0.0.1` if behind a reverse proxy (e.g., `127.0.0.1:3000:3000`) |
| **Use HTTPS** | Terminate TLS at a reverse proxy (Nginx, Caddy, Traefik) in front of the SPA |
| **Rotate API keys** | Rotate `OPENAI_API_KEY` periodically via your LLM provider |
| **Protect SimpleFin URL** | Keep `SIMPLEFIN_ACCESS_URL` confidential — it grants read access to your financial data |
| **Docker secrets** | Use Docker secrets or a vault (e.g., HashiCorp Vault) for sensitive values in production |
| **File permissions** | Ensure `.env` is readable only by the deploying user (`chmod 600 .env`) |
| **Git ignore** | Verify `.env` is in `.gitignore` — never commit secrets to version control |

### Restricting Port Bindings

To bind ports to localhost only (recommended when behind a reverse proxy), edit `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:${SPA_PORT:-80}:80"    # SPA
  - "127.0.0.1:${API_PORT:-3000}:3000" # API
  - "127.0.0.1:5432:5432"              # PostgreSQL
```
