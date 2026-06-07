# Doughray Deployment Guide

This guide covers everything needed to deploy the Doughray financial dashboard application from scratch.

Doughray consists of four services orchestrated via Docker Compose:

- **postgres** — PostgreSQL 16 database
- **api** — Node.js/Express REST API (TypeScript, Prisma ORM)
- **spa** — React single-page application served by Nginx
- **worker** — Background worker for SimpleFin account syncing and OpenAI-compatible LLM processing

---

## 1. Prerequisites

| Requirement | Minimum Version |
|---|---|
| Docker Engine | 20.10+ |
| Docker Compose | v2 (the `docker compose` CLI plugin) |

**External accounts:**

- **SimpleFin Bridge** account — sign up at <https://bridge.simplefin.org> to connect bank and financial institution data.
- OpenAI-compatible LLM access — required for AI-powered features (insights, categorization).

**Minimum system requirements:**

| Resource | Minimum |
|---|---|
| CPU | 1 vCPU |
| RAM | 1 GB |
| Disk | 2 GB free |

> For production workloads with multiple connected financial institutions, 2 CPU / 2 GB RAM is recommended.

---

## 2. Quick Start (Docker Compose)

```bash
# 1. Clone the repository
git clone <repo-url> Doughray
cd Doughray/code

# 2. Copy the example environment file
cp .env.example .env

# 3. Edit .env with your credentials (see Section 3 for details)
#    At minimum, set a strong POSTGRES_PASSWORD and matching DATABASE_URL.
nano .env

# 4. Build and start all services
docker compose up -d --build

# 5. Access the application
#    SPA:  http://localhost       (port 80 by default)
#    API:  http://localhost:3000  (port 3000 by default)

# 6. Run the initial database seed (migrations run automatically on API start)
docker compose exec api npx prisma db seed
```

> **Note:** The API service automatically runs `npx prisma migrate deploy` on startup, so you do not need to run migrations manually for the initial deployment.

---

## 3. Environment Variables Reference

All variables are defined in `.env.example`. Copy it to `.env` and fill in the values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_DB` | No | `finance` | PostgreSQL database name |
| `POSTGRES_USER` | No | `finance` | PostgreSQL username |
| `POSTGRES_PASSWORD` | **Yes** | `changeme_in_production` | PostgreSQL password — **change this in production** |
| `DATABASE_URL` | **Yes** | `postgresql://finance:changeme_in_production@postgres:5432/finance` | Full Prisma connection string. Must match the user/password/db above. |
| `SIMPLEFIN_ACCESS_URL` | **Yes** | *(empty)* | SimpleFin Bridge access URL (see Section 4) |
| `OPENAI_BASE_URL` | No | *(empty)* | Custom OpenAI-compatible base URL. Leave empty to use the default OpenAI API. |
| `OPENAI_API_KEY` | **Yes** | *(empty)* | OpenAI-compatible API key |
| `OPENAI_MODEL` | **Yes** | *(empty)* | Model or deployment name used for AI features |
| `OPENAI_TEMPERATURE` | No | `1` | Default temperature for AI jobs and reports |
| `NODE_ENV` | No | `production` | Node environment (`production` or `development`) |
| `API_PORT` | No | `3000` | Host port mapped to the API container |
| `SPA_PORT` | No | `80` | Host port mapped to the SPA/Nginx container |

> **Security:** Never commit your `.env` file to version control. The `.env` file contains secrets (database password, API keys, SimpleFin access URL).

---

## 4. SimpleFin Setup

[SimpleFin Bridge](https://bridge.simplefin.org) provides read-only access to your financial accounts.

1. **Create an account** — Go to <https://bridge.simplefin.org> and sign up.

2. **Connect your financial institutions** — Follow the SimpleFin prompts to link your bank accounts, credit cards, and investment accounts.

3. **Get a setup token** — In the SimpleFin dashboard, generate a new setup token. This is a Base64-encoded string.

4. **Convert the token to an access URL** — The worker container includes `simplefin-cli`. Run:

   ```bash
   docker compose exec worker simplefin-cli setup <your-base64-token>
   ```

   This will output an access URL in the format:
   ```
   https://user:pass@bridge.simplefin.org/simplefin
   ```

5. **Set the environment variable** — Add the access URL to your `.env` file:

   ```env
   SIMPLEFIN_ACCESS_URL=https://user:pass@bridge.simplefin.org/simplefin
   ```

6. **Restart the worker** to pick up the new variable:

   ```bash
   docker compose restart worker
   ```

---

## 5. OpenAI-Compatible LLM Setup

An OpenAI-compatible LLM powers features such as transaction categorization and financial insights.

1. Choose a provider that exposes an OpenAI-compatible chat completions API.
2. Collect the required credentials:
   - **API key**
   - **Model or deployment name**
   - **Base URL** if you are not using the default OpenAI API
3. Set the environment variables in `.env`:

   ```env
   OPENAI_BASE_URL=
   OPENAI_API_KEY=your-api-key-here
   OPENAI_MODEL=gpt-4o-mini
   OPENAI_TEMPERATURE=1
   ```

4. **Restart the API and worker** to apply changes:

   ```bash
   docker compose restart api worker
   ```

---

## 6. Database Management

Doughray uses [Prisma](https://www.prisma.io/) for database migrations and schema management against PostgreSQL 16.

### Migrations

Migrations run automatically when the API container starts. To run them manually:

```bash
docker compose exec api npx prisma migrate deploy
```

### Seed

Populate the database with initial/sample data:

```bash
docker compose exec api npx prisma db seed
```

### Reset

⚠️ **Destructive** — drops all data and re-applies migrations:

```bash
docker compose exec api npx prisma migrate reset
```

### Backup

```bash
docker compose exec postgres pg_dump -U finance finance > backup.sql
```

### Restore

```bash
docker compose exec -T postgres psql -U finance finance < backup.sql
```

> Replace `finance` with your `POSTGRES_USER` and `POSTGRES_DB` values if you changed them.

---

## 7. Production Deployment

### Use a Reverse Proxy with SSL

In production, place a reverse proxy in front of Doughray to handle TLS termination. Bind the SPA port to `127.0.0.1` only:

```env
SPA_PORT=127.0.0.1:8080:80
API_PORT=127.0.0.1:3000:3000
```

#### Caddy (Automatic HTTPS)

Caddy is the simplest option — it automatically provisions and renews Let's Encrypt certificates.

```
# /etc/caddy/Caddyfile
Doughray.example.com {
    reverse_proxy localhost:8080
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

#### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name Doughray.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name Doughray.example.com;

    ssl_certificate     /etc/letsencrypt/live/Doughray.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/Doughray.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Use [Certbot](https://certbot.eff.org/) to obtain certificates:

```bash
sudo certbot --nginx -d Doughray.example.com
```

### Firewall Recommendations

Only expose the ports your reverse proxy needs:

```bash
# Allow SSH, HTTP, and HTTPS only
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do **not** expose PostgreSQL (5432) or the API (3000) directly to the internet.

### Change Default Passwords

Before going to production, **always** change:

- `POSTGRES_PASSWORD` — use a strong, randomly generated password (32+ characters).
- Update `DATABASE_URL` to match the new password.
- Rotate your `OPENAI_API_KEY` periodically.

---

## 8. Updating

```bash
# 1. Pull the latest changes
git pull

# 2. Rebuild and restart all services
docker compose up -d --build

# 3. Migrations run automatically on API startup — no manual step needed.
```

> If a release includes breaking changes, check the release notes for any additional migration steps.

---

## 9. Monitoring & Logs

### View Logs

```bash
# Follow all service logs
docker compose logs -f

# Follow a specific service
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f spa
docker compose logs -f postgres
```

### Health Check

The API exposes a health endpoint:

```bash
curl http://localhost:3000/api/health
```

A healthy response returns HTTP 200. Use this for uptime monitoring with tools like UptimeRobot, Healthchecks.io, or your own monitoring stack.

### Sync Status

Check the SimpleFin sync status through:

- The **Settings** page in the SPA.
- Or directly via the API (check your API documentation for the sync status endpoint).

### Container Status

```bash
docker compose ps
```

Verify all four services (`postgres`, `api`, `spa`, `worker`) show as `Up` and healthy.

---

## 10. Troubleshooting

### Database connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

- Check that `postgres` is healthy: `docker compose ps postgres`
- View postgres logs: `docker compose logs postgres`
- Verify `DATABASE_URL` in `.env` uses `postgres` (the service name) as the hostname, not `localhost`.

### SimpleFin sync errors

- Verify `SIMPLEFIN_ACCESS_URL` is set and not empty: `docker compose exec worker env | grep SIMPLEFIN`
- The access URL may have expired — regenerate it (see Section 4).
- SimpleFin has rate limits — avoid triggering syncs more than once every few minutes.
- Check worker logs: `docker compose logs worker`

### OpenAI API authentication errors

- Verify `OPENAI_API_KEY` is correct and not expired.
- Confirm `OPENAI_MODEL` matches the exact model or deployment name your provider expects.
- If you set `OPENAI_BASE_URL`, verify it points at the provider's OpenAI-compatible endpoint.
- Check your provider dashboard for quota, billing, or access issues.

### SPA shows a blank page

- Check the SPA build succeeded: `docker compose logs spa`
- Verify the Nginx config is correctly proxying `/api/` requests to the API container.
- Open the browser developer console for JavaScript errors.
- Confirm the SPA container is running: `docker compose ps spa`

### Worker not importing transactions

- Confirm `SIMPLEFIN_ACCESS_URL` is set: `docker compose exec worker env | grep SIMPLEFIN`
- Check worker logs for errors: `docker compose logs -f worker`
- Restart the worker: `docker compose restart worker`

### Port conflicts

If ports 80, 3000, or 5432 are already in use, change them in `.env`:

```env
SPA_PORT=8080
API_PORT=3001
```

Then restart: `docker compose up -d`

---

## 11. Backups

### Automated Backup Script

Create a cron job to back up the database daily:

```bash
#!/usr/bin/env bash
# /opt/Doughray/backup.sh
set -euo pipefail

BACKUP_DIR="/opt/Doughray/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# Dump the database
docker compose -f /path/to/Doughray/code/docker-compose.yml \
  exec -T postgres pg_dump -U finance finance \
  | gzip > "$BACKUP_DIR/Doughray_${TIMESTAMP}.sql.gz"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "Doughray_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "Backup complete: Doughray_${TIMESTAMP}.sql.gz"
```

Add to crontab (`crontab -e`):

```cron
# Daily backup at 2:00 AM
0 2 * * * /opt/Doughray/backup.sh >> /var/log/Doughray-backup.log 2>&1
```

### Volume Backup

To back up the entire PostgreSQL data volume:

```bash
# Stop services first to ensure data consistency
docker compose down

# Find and back up the volume
docker volume inspect master-sink-trail_pgdata --format '{{ .Mountpoint }}'
sudo tar -czf Doughray-pgdata-backup.tar.gz \
  $(docker volume inspect master-sink-trail_pgdata --format '{{ .Mountpoint }}')

# Restart services
docker compose up -d
```

### Restore from Volume Backup

```bash
docker compose down
sudo tar -xzf Doughray-pgdata-backup.tar.gz -C /
docker compose up -d
```

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser    │────▶│  SPA (Nginx)│────▶│   API       │
│              │     │  :80        │/api/│  :3000      │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐     ┌──────▼──────┐
                    │   Worker    │────▶│  PostgreSQL  │
                    │             │     │  :5432       │
                    └──────┬──────┘     └─────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────▼──────┐     ┌───────────▼────────┐
    │ SimpleFin Bridge│     │ OpenAI-compatible  │
    │ (external)      │     │  (external)        │
    └────────────────┘     └────────────────────┘
```

- The **SPA** serves the React frontend and proxies `/api/` requests to the **API** via Nginx.
- The **API** handles REST endpoints and runs Prisma migrations on startup.
- The **Worker** syncs financial data from SimpleFin and processes it with an OpenAI-compatible LLM service.
- **PostgreSQL** stores all application data in a persistent Docker volume (`pgdata`).
